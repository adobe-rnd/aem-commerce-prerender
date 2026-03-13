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

const crypto = require("crypto");
const { Timings, aggregate } = require("../lib/benchmark");
const { AdminAPI } = require("../lib/aem");
const {
  requestSaaS,
  isValidUrl,
  getCategoryUrl,
  formatMemoryUsage,
  PLP_FILE_PREFIX,
  STATE_FILE_EXT,
} = require("../utils");
const { PlpProductSearchQuery } = require("../queries");
const { getCategoryDataFromFamilies } = require("../categories");
const { generateCategoryHtml } = require("../plp-renderer/render");
const { JobFailedError, ERROR_CODES } = require("../lib/errorHandler");

const BATCH_SIZE = 50;
const PLP_FILE_EXT = "html";

function getFileLocation(stateKey, extension) {
  return `${PLP_FILE_PREFIX}/${stateKey}.${extension}`;
}

/**
 * Loads the PLP state from the cloud file system.
 *
 * @param {string} locale - The locale.
 * @param {Object} aioLibs - { filesLib, stateLib }.
 * @returns {Promise<Object>} State object with { locale, categories: { [slug]: { lastRenderedAt, hash } } }.
 */
async function loadState(locale, aioLibs) {
  const { filesLib } = aioLibs;
  const stateObj = { locale, categories: {} };
  try {
    const stateKey = locale || "default";
    const fileLocation = getFileLocation(stateKey, STATE_FILE_EXT);
    const buffer = await filesLib.read(fileLocation);
    const stateData = buffer?.toString();
    if (stateData) {
      const lines = stateData.split("\n");
      stateObj.categories = lines.reduce((acc, line) => {
        // format: <categorySlug>,<timestamp>,<hash>
        const [slug, time, hash] = line.split(",");
        if (slug) {
          acc[slug] = { lastRenderedAt: new Date(parseInt(time)), hash };
        }
        return acc;
      }, {});
    }
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    stateObj.categories = {};
  }
  return stateObj;
}

/**
 * Saves the PLP state to the cloud file system.
 *
 * @param {Object} state - State object with { locale, categories }.
 * @param {Object} aioLibs - { filesLib, stateLib }.
 * @returns {Promise<void>}
 */
async function saveState(state, aioLibs) {
  const { filesLib } = aioLibs;
  const stateKey = state.locale || "default";
  const fileLocation = getFileLocation(stateKey, STATE_FILE_EXT);
  const csvData = Object.entries(state.categories)
    .filter(([, { lastRenderedAt }]) => Boolean(lastRenderedAt))
    .map(
      ([slug, { lastRenderedAt, hash }]) =>
        `${slug},${lastRenderedAt.getTime()},${hash || ""}`,
    )
    .join("\n");
  return await filesLib.write(fileLocation, csvData);
}

function shouldPreviewAndPublish({ currentHash, newHash }) {
  return newHash && currentHash !== newHash;
}

function createBatches(items) {
  return items.reduce((acc, item) => {
    if (!acc.length || acc[acc.length - 1].length === BATCH_SIZE) {
      acc.push([]);
    }
    acc[acc.length - 1].push(item);
    return acc;
  }, []);
}

function checkParams(params) {
  const requiredParams = [
    "site",
    "org",
    "adminAuthToken",
    "configName",
    "contentUrl",
    "storeUrl",
  ];
  const missingParams = requiredParams.filter((param) => !params[param]);
  if (missingParams.length > 0) {
    throw new JobFailedError(
      `Missing required parameters: ${missingParams.join(", ")}`,
      ERROR_CODES.VALIDATION_ERROR,
      400,
      { missingParams },
    );
  }

  if (params.storeUrl && !isValidUrl(params.storeUrl)) {
    throw new JobFailedError(
      "Invalid storeUrl",
      ERROR_CODES.VALIDATION_ERROR,
      400,
    );
  }

  if (!params.categoryFamilies?.length) {
    throw new JobFailedError(
      "Missing ACO_CATEGORY_FAMILIES configuration",
      ERROR_CODES.VALIDATION_ERROR,
      400,
    );
  }
}

/**
 * Renders a single category and returns enriched data with hash.
 */
let renderLimit$;
async function renderCategory(categoryData, categoryMap, context) {
  const { logger } = context;

  if (!renderLimit$) {
    renderLimit$ = import("p-limit").then(({ default: pLimit }) => pLimit(50));
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
        "plpProductSearch",
        {
          categoryPath: slug,
          pageSize: context.plpProductsPerPage,
          currentPage: 1,
        },
        context,
      );

      const products = productsRes.data.productSearch.items.map(
        (item) => item.productView,
      );

      // Render HTML
      const html = generateCategoryHtml(
        categoryData,
        products,
        categoryMap,
        context,
      );
      result.renderedAt = new Date();
      result.newHash = crypto.createHash("sha256").update(html).digest("hex");

      // Save HTML if changed
      if (shouldPreviewAndPublish(result) && html) {
        try {
          const { filesLib } = context.aioLibs;
          const htmlPath = `/public/plps${result.path}.${PLP_FILE_EXT}`;
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
 * Processes a published batch and updates state.
 */
async function processPublishedBatch(
  publishedBatch,
  state,
  counts,
  renderedCategories,
  aioLibs,
) {
  const { records } = publishedBatch;
  records.forEach((record) => {
    if (record.previewedAt && record.publishedAt) {
      const category = renderedCategories.find((c) => c.slug === record.slug);
      state.categories[record.slug] = {
        lastRenderedAt: record.renderedAt,
        hash: category?.newHash,
      };
      counts.published++;
    } else {
      counts.failed++;
    }
  });
  await saveState(state, aioLibs);
}

/**
 * Main poll function for category rendering.
 */
async function poll(params, aioLibs, logger) {
  try {
    checkParams(params);

    const counts = { published: 0, ignored: 0, failed: 0 };
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
      : typeof rawLocales === "string" && rawLocales.trim()
        ? rawLocales
            .split(",")
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

    let stateText = "completed";

    try {
      await adminApi.startProcessing();

      const results = await Promise.all(
        locales.map(async (locale) => {
          const timings = new Timings();
          const context = { ...sharedContext, startTime: new Date() };
          if (locale) context.locale = locale;

          logger.info(`PLP polling for locale ${locale}`);

          // Discover all categories
          const categoryMap = await getCategoryDataFromFamilies(
            context,
            categoryFamilies,
          );
          timings.sample("discover-categories");

          // Save category list for reference
          const { filesLib } = aioLibs;
          const categoriesFileName = getFileLocation(
            `${locale || "default"}-categories`,
            "json",
          );
          const categoryList = [...categoryMap.entries()]
            .filter(([, data]) => data != null)
            .map(([slug, data]) => ({
              slug,
              name: data.name,
              level: data.level,
            }));
          await filesLib.write(
            categoriesFileName,
            JSON.stringify(categoryList),
          );

          // Load state
          const state = await loadState(locale, aioLibs);
          context.state = state;

          logger.info(
            `Discovered ${categoryMap.size} categories for locale ${locale}`,
          );

          // Render all categories in batches
          const categorySlugs = [...categoryMap.keys()].filter(
            (slug) => categoryMap.get(slug) != null,
          );
          const batches = createBatches(categorySlugs);
          const pendingBatches = batches.map((batch, batchNumber) => {
            return Promise.all(
              batch.map((slug) =>
                renderCategory(categoryMap.get(slug), categoryMap, context),
              ),
            )
              .then(async (renderedCategories) => {
                // Filter to only those that changed
                const toPublish = [];
                const toIgnore = [];
                for (const category of renderedCategories) {
                  if (shouldPreviewAndPublish(category)) {
                    toPublish.push(category);
                  } else {
                    counts.ignored++;
                    // Update lastRenderedAt even if hash unchanged
                    if (category.renderedAt) {
                      state.categories[category.slug] = {
                        lastRenderedAt: category.renderedAt,
                        hash: category.currentHash,
                      };
                    }
                    toIgnore.push(category);
                  }
                }

                if (toIgnore.length) {
                  await saveState(state, aioLibs);
                }

                return toPublish;
              })
              .then((categories) => {
                if (categories.length) {
                  const records = categories.map(
                    ({ slug, path, renderedAt }) => ({
                      slug,
                      path,
                      renderedAt,
                    }),
                  );
                  return adminApi
                    .previewAndPublish(records, locale, batchNumber + 1)
                    .then((publishedBatch) =>
                      processPublishedBatch(
                        publishedBatch,
                        state,
                        counts,
                        categories,
                        aioLibs,
                      ),
                    )
                    .catch((error) => {
                      if (error.code === ERROR_CODES.BATCH_ERROR) {
                        logger.warn(
                          `Batch ${batchNumber + 1} failed, continuing:`,
                          {
                            error: error.message,
                            details: error.details,
                          },
                        );
                        counts.failed += categories.length;
                        return {
                          failed: true,
                          batchNumber: batchNumber + 1,
                          error: error.message,
                        };
                      } else {
                        throw error;
                      }
                    });
                }
                return Promise.resolve();
              });
          });
          await Promise.all(pendingBatches);
          timings.sample("rendered-categories");

          return timings.measures;
        }),
      );

      await adminApi.stopProcessing();

      // Aggregate timings
      for (const measure of results) {
        for (const [name, value] of Object.entries(measure)) {
          if (!timings.measures[name]) timings.measures[name] = [];
          if (!Array.isArray(timings.measures[name]))
            timings.measures[name] = [timings.measures[name]];
          timings.measures[name].push(value);
        }
      }
      for (const [name, values] of Object.entries(timings.measures)) {
        timings.measures[name] = aggregate(values);
      }
      timings.measures.previewDuration = aggregate(adminApi.previewDurations);
    } catch (e) {
      logger.error("Error during PLP poll processing:", {
        message: e.message,
        code: e.code,
        stack: e.stack,
      });
      await adminApi.stopProcessing();
      stateText = "failure";

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
    logger.error("PLP poll failed with error:", {
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

module.exports = {
  poll,
  loadState,
  saveState,
  getFileLocation,
};
