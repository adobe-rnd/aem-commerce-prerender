/*
Copyright 2026 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

const crypto = require('crypto');
const { Timings, aggregate } = require('../lib/benchmark');
const { AdminAPI } = require('../lib/aem');
const {
  requestSaaS,
  getCategoryUrl,
  getConfig,
  getSiteType,
  formatMemoryUsage,
  createBatches,
  PLP_FILE_PREFIX,
  SITE_TYPES,
} = require('../utils');
const {
  getHtmlFilePath,
  getFileLocation,
  loadState,
  saveState,
  shouldPreviewAndPublish,
  processPublishedBatch,
  validateRequiredParams,
} = require('../renderUtils');
const { PlpProductSearchQuery } = require('../queries');
const { getCategoryMapFromFamilies, getCategoryMap } = require('../categories');
const { generateCategoryHtml } = require('../plp-renderer/render');
const { JobFailedError, ERROR_CODES } = require('../lib/errorHandler');
const DATA_KEY = 'categories';

function checkParams(params) {
  validateRequiredParams(params, [
    'site',
    'org',
    'pathFormat',
    'adminAuthToken',
    'configName',
    'contentUrl',
    'storeUrl',
  ]);
}

/**
 * Renders a single category and returns enriched data with hash.
 */
let renderLimit$;
async function renderCategory(categoryData, categoryMap, context) {
  const { logger } = context;

  if (!renderLimit$) {
    renderLimit$ = import('p-limit').then(({ default: pLimit }) => pLimit(50));
  }

  return (await renderLimit$)(async () => {
    const slug = categoryData.slug;
    const result = {
      slug,
      path: getCategoryUrl(slug, context, false).toLowerCase(),
      currentHash: context.state.categories[slug]?.hash || null,
    };

    try {
      // Fetch first page of products for this category
      const productsRes = await requestSaaS(
        PlpProductSearchQuery,
        'plpProductSearch',
        {
          categoryPath: slug,
          pageSize: context.plpProductsPerPage,
          currentPage: 1,
        },
        context,
      );

      const products = productsRes.data.productSearch.items.map((item) => item.productView);

      // Render HTML
      const html = generateCategoryHtml(categoryData, products, categoryMap, context);
      result.renderedAt = new Date();
      result.newHash = crypto.createHash('sha256').update(html).digest('hex');

      // Save HTML if changed
      if (shouldPreviewAndPublish(result) && html) {
        try {
          const { filesLib } = context.aioLibs;
          const htmlPath = getHtmlFilePath(result.path);
          await filesLib.write(htmlPath, html);
          logger.debug(`Saved HTML for category ${slug} to ${htmlPath}`);
        } catch (e) {
          result.newHash = null;
          logger.error(`Error saving HTML for category ${slug}:`, e);
        }
      }
    } catch (e) {
      logger.error(`Error rendering category ${slug}:`, e);
    }

    return result;
  });
}

/**
 * Unpublishes and deletes categories that are no longer in the category tree.
 */
async function processRemovedCategories(discoveredSlugs, state, context, adminApi) {
  const { locale, counts, logger, aioLibs } = context;
  const { filesLib } = aioLibs;
  const stateSlugs = Object.keys(state.categories);
  const removedSlugs = stateSlugs.filter((slug) => !discoveredSlugs.has(slug));

  if (!removedSlugs.length) return;

  logger.info(`Found ${removedSlugs.length} categories to unpublish for locale ${locale}`);

  try {
    const records = removedSlugs.map((slug) => ({
      slug,
      path: getCategoryUrl(slug, context, false).toLowerCase(),
    }));

    const batches = createBatches(records);
    const pendingBatches = [];
    for (let batchNumber = 0; batchNumber < batches.length; batchNumber++) {
      const batchRecords = batches[batchNumber];
      const pendingBatch = adminApi.unpublishAndDelete(batchRecords, locale, batchNumber + 1).then(({ records }) => {
        records.forEach((record) => {
          if (record.liveUnpublishedAt && record.previewUnpublishedAt) {
            try {
              const htmlPath = getHtmlFilePath(record.path);
              filesLib.delete(htmlPath);
              logger.debug(`Deleted HTML file for category ${record.slug} from ${htmlPath}`);
            } catch (e) {
              logger.warn(`Error deleting HTML file for category ${record.slug}:`, e);
            }

            delete state.categories[record.slug];
            counts.unpublished++;
          } else {
            counts.failed++;
          }
        });
      });
      pendingBatches.push(pendingBatch);
    }
    await Promise.all(pendingBatches);
    await saveState(state, aioLibs, PLP_FILE_PREFIX, DATA_KEY);
  } catch (e) {
    logger.error('Error processing removed categories:', e);
  }
}

/**
 * Main poll function for category rendering.
 */
async function poll(params, aioLibs, logger) {
  try {
    checkParams(params);

    const counts = { published: 0, unpublished: 0, ignored: 0, failed: 0 };
    const {
      org,
      site,
      pathFormat,
      siteToken,
      configName,
      configSheet,
      adminAuthToken,
      storeUrl,
      contentUrl,
      logLevel,
      logIngestorEndpoint,
      locales: rawLocales,
      categoryFamilies,
      plpProductsPerPage,
    } = params;

    const locales = Array.isArray(rawLocales)
      ? rawLocales
      : typeof rawLocales === 'string' && rawLocales.trim()
        ? rawLocales
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [null];

    const sharedContext = {
      siteToken,
      storeUrl,
      contentUrl,
      configName,
      configSheet,
      logger,
      counts,
      pathFormat,
      aioLibs,
      logLevel,
      logIngestorEndpoint,
      plpProductsPerPage: plpProductsPerPage || 9,
    };

    const timings = new Timings();

    const adminApi = new AdminAPI({ org, site }, sharedContext, {
      authToken: adminAuthToken,
    });

    logger.info(`Starting PLP poll from ${storeUrl} for locales ${locales}`);

    let stateText = 'completed';

    try {
      await adminApi.startProcessing();

      const results = await Promise.all(
        locales.map(async (locale) => {
          const timings = new Timings();
          const context = { ...sharedContext, startTime: new Date() };
          const siteConfig = await getConfig(context);
          const siteType = getSiteType(siteConfig);
          logger.debug(`Detected site type: ${siteType}`);

          if (locale) context.locale = locale;

          logger.info(`PLP polling for locale ${locale}`);

          // Discover all categories
          let categoryMap;
          if (siteType === SITE_TYPES.ACO) {
            if (!categoryFamilies?.length) {
              throw new JobFailedError(
                'Missing ACO_CATEGORY_FAMILIES configuration',
                ERROR_CODES.VALIDATION_ERROR,
                400,
              );
            }
            categoryMap = await getCategoryMapFromFamilies(context, categoryFamilies);
          } else {
            categoryMap = await getCategoryMap(context);
          }
          timings.sample('discover-categories');

          // Save category list for reference
          const { filesLib } = aioLibs;
          const categoriesFileName = getFileLocation(PLP_FILE_PREFIX, `${locale || 'default'}-categories`, 'json');
          const categoryList = [...categoryMap.entries()]
            .filter(([, data]) => data != null)
            .map(([slug, data]) => ({
              slug,
              name: data.name,
              level: data.level,
            }));
          await filesLib.write(categoriesFileName, JSON.stringify(categoryList));

          // Load state
          const state = await loadState(locale, aioLibs, PLP_FILE_PREFIX, DATA_KEY);
          context.state = state;

          logger.info(`Discovered ${categoryMap.size} categories for locale ${locale}`);

          // Render all categories in batches
          const categorySlugs = [...categoryMap.keys()].filter((slug) => categoryMap.get(slug) != null);
          const batches = createBatches(categorySlugs);
          const pendingBatches = batches.map((batch, batchNumber) => {
            return Promise.all(batch.map((slug) => renderCategory(categoryMap.get(slug), categoryMap, context)))
              .then(async (renderedCategories) => {
                // Filter to only those that changed
                const toPublish = [];
                const toIgnore = [];
                for (const category of renderedCategories) {
                  if (shouldPreviewAndPublish(category)) {
                    toPublish.push(category);
                  } else if (!category.renderedAt) {
                    logger.warn(`Category ${category.slug} failed to render`);
                    counts.failed++;
                  } else {
                    logger.debug(`Category ${category.slug} has not changed. Ignoring...`);
                    counts.ignored++;
                    state.categories[category.slug] = {
                      lastRenderedAt: category.renderedAt,
                      hash: category.currentHash,
                    };
                    toIgnore.push(category);
                  }
                }

                // Update lastRenderedAt for the categories to ignore to avoid re-rendering unnecessarily
                if (toIgnore.length) {
                  await saveState(state, aioLibs, PLP_FILE_PREFIX, DATA_KEY);
                }

                return toPublish;
              })
              .then((categories) => {
                if (categories.length) {
                  const records = categories.map(({ slug, path, renderedAt }) => ({
                    slug,
                    path,
                    renderedAt,
                  }));
                  // Preview and publish the categories
                  logger.debug(`Previewing and publishing ${categories.length} categories in batch ${batchNumber + 1}`);
                  return adminApi
                    .previewAndPublish(records, locale, batchNumber + 1)
                    .then((publishedBatch) =>
                      // Process the published batch and update the state
                      processPublishedBatch(publishedBatch, state, counts, categories, aioLibs, {
                        dataKey: DATA_KEY,
                        keyField: 'slug',
                        filePrefix: PLP_FILE_PREFIX,
                      }),
                    )
                    .catch((error) => {
                      // Handle batch errors gracefully - don't fail the entire job
                      if (error.code === ERROR_CODES.BATCH_ERROR) {
                        logger.warn(`Batch ${batchNumber + 1} failed, continuing:`, {
                          error: error.message,
                          details: error.details,
                        });
                        // Update counts to reflect failed batch
                        counts.failed += categories.length;
                        return {
                          failed: true,
                          batchNumber: batchNumber + 1,
                          error: error.message,
                        };
                      } else {
                        // Re-throw global errors
                        throw error;
                      }
                    });
                }
                return Promise.resolve();
              });
          });
          await Promise.all(pendingBatches);
          timings.sample('rendered-categories');

          // Unpublish categories that are no longer in the tree
          const discoveredSlugs = new Set(categorySlugs);
          if (Object.keys(state.categories).some((slug) => !discoveredSlugs.has(slug))) {
            logger.debug(`Unpublishing categories that are no longer in the tree`);
            await processRemovedCategories(discoveredSlugs, state, context, adminApi);
            timings.sample('unpublished-categories');
          } else {
            timings.sample('unpublished-categories', 0);
          }

          return timings.measures;
        }),
      );

      await adminApi.stopProcessing();

      // Aggregate timings
      for (const measure of results) {
        for (const [name, value] of Object.entries(measure)) {
          if (!timings.measures[name]) timings.measures[name] = [];
          if (!Array.isArray(timings.measures[name])) timings.measures[name] = [timings.measures[name]];
          timings.measures[name].push(value);
        }
      }
      for (const [name, values] of Object.entries(timings.measures)) {
        timings.measures[name] = aggregate(values);
      }
      timings.measures.previewDuration = aggregate(adminApi.previewDurations);
    } catch (e) {
      logger.error('Error during PLP poll processing:', {
        message: e.message,
        code: e.code,
        stack: e.stack,
      });
      await adminApi.stopProcessing();
      stateText = 'failure';

      if (e.isJobFailed) {
        throw e;
      }

      throw new JobFailedError(
        `PLP poll processing failed: ${e.message}`,
        e.code || ERROR_CODES.PROCESSING_ERROR,
        e.statusCode || 500,
        { originalError: e.message },
      );
    }

    // get memory usage
    const memoryData = process.memoryUsage();
    const memoryUsage = {
      rss: `${formatMemoryUsage(memoryData.rss)}`,
      heapTotal: `${formatMemoryUsage(memoryData.heapTotal)}`,
      heapUsed: `${formatMemoryUsage(memoryData.heapUsed)}`,
      external: `${formatMemoryUsage(memoryData.external)}`,
    };
    logger.info(`Memory usage: ${JSON.stringify(memoryUsage)}`);

    const elapsed = new Date() - timings.now;
    logger.info(`Finished PLP polling, elapsed: ${elapsed}ms`);

    return {
      state: stateText,
      elapsed,
      status: { ...counts },
      timings: timings.measures,
      memoryUsage,
    };
  } catch (error) {
    logger.error('PLP poll failed with error:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });

    if (error.isJobFailed) {
      throw error;
    }

    throw new JobFailedError(
      `PLP poll operation failed: ${error.message}`,
      error.code || ERROR_CODES.PROCESSING_ERROR,
      error.statusCode || 500,
      { originalError: error.message },
    );
  }
}

module.exports = { poll };
