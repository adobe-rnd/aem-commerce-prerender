/*
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

const { Timings, aggregate } = require('../lib/benchmark');
const { AdminAPI } = require('../lib/aem');
const {
  requestSaaS,
  getProductUrl,
  formatMemoryUsage,
  createBatches,
  FILE_PREFIX,
  requestPublishedProductsIndex,
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
const { GetLastModifiedQuery } = require('../queries');
const { generateProductHtml } = require('../pdp-renderer/render');
const { JobFailedError, ERROR_CODES } = require('../lib/errorHandler');
const crypto = require('crypto');
const BATCH_SIZE = 50;
const DATA_KEY = 'skus';
// If no render has completed in this window the action is frozen — exit rather than burning the full timeout.
const WATCHDOG_TIMEOUT_MS = 5 * 60 * 1000;
const WATCHDOG_CHECK_INTERVAL_MS = 30 * 1000;

function checkParams(params) {
  validateRequiredParams(params, [
    'site',
    'org',
    'pathFormat',
    'adminAuthToken',
    'configName',
    'contentUrl',
    'storeUrl',
    'productsTemplate',
  ]);
}

/**
 * Checks if a product should be (re)rendered.
 *
 * @param {*} param0
 * @returns
 */
function shouldRender({ urlKey, lastModifiedDate, lastRenderedDate }) {
  return urlKey?.match(/^[a-zA-Z0-9-]+$/) && lastModifiedDate >= lastRenderedDate;
}

/**
 * Enrich the product data with metadata from state and context.
 *
 * @param {Object} product - The product to process
 * @param {Object} state - The current state
 * @param {Object} context - The context object with logger and other utilities
 * @returns {Object} Enhanced product with additional metadata
 */
function enrichProductWithMetadata(product, state, context) {
  const { sku, urlKey, lastModifiedAt } = product;
  const lastRenderedDate = state.skus[sku]?.lastRenderedAt || new Date(0);
  const lastModifiedDate = new Date(lastModifiedAt);
  const productUrl = getProductUrl({ urlKey, sku }, context, false);
  const currentHash = state.skus[sku]?.hash || null;

  return {
    sku,
    urlKey,
    path: productUrl,
    lastModifiedDate,
    lastRenderedDate,
    currentHash,
  };
}

/**
 * Generates the HTML for a product, saves it to the public storage and include the new hash in the product object.
 *
 * @param {*} param0
 * @returns
 */
let renderLimit$;
async function enrichProductWithRenderedHash(product, context) {
  const { logger } = context;
  const { sku, urlKey, path } = product;

  if (!renderLimit$) {
    renderLimit$ = import('p-limit').then(({ default: pLimit }) => pLimit(20));
  }

  return (await renderLimit$)(async () => {
    try {
      const productHtml = await generateProductHtml(sku, urlKey, context);
      product.renderedAt = new Date();
      product.newHash = crypto.createHash('sha256').update(productHtml).digest('hex');

      // Save HTML immediately if product should be processed
      if (shouldPreviewAndPublish(product) && productHtml) {
        try {
          const { filesLib } = context.aioLibs;
          const htmlPath = getHtmlFilePath(path);
          await filesLib.write(htmlPath, productHtml);
          logger.debug(`Saved HTML for product ${sku} to ${htmlPath}`);
        } catch (e) {
          // Reset newHash if saving fails
          product.newHash = null;
          logger.error(`Error saving HTML for product ${sku}:`, e);
        }
      }
    } catch (e) {
      logger.error(`Error generating product HTML for SKU ${sku}:`, e);
    }

    context.recordActivity?.();
    return product;
  });
}

/**
 * Identifies and processes products that need to be deleted
 */
async function processDeletedProducts(remainingSkus, state, context, adminApi) {
  if (!remainingSkus.length) return;
  const { locale, counts, logger, aioLibs } = context;
  const { filesLib } = aioLibs;

  try {
    const deletedProducts = (await requestPublishedProductsIndex(context)).data.filter(({ sku }) =>
      remainingSkus.includes(sku),
    );

    // Process in batches
    if (deletedProducts.length) {
      // delete in batches of BATCH_SIZE, then save state in case we get interrupted
      const batches = createBatches(deletedProducts, context);
      const pendingBatches = [];
      for (let batchNumber = 0; batchNumber < batches.length; batchNumber++) {
        const records = batches[batchNumber];
        const pendingBatch = adminApi.unpublishAndDelete(records, locale, batchNumber + 1).then(({ records }) => {
          records.forEach((record) => {
            if (record.liveUnpublishedAt && record.previewUnpublishedAt) {
              // Delete the HTML file from public storage
              try {
                const htmlPath = getHtmlFilePath(record.path);
                filesLib.delete(htmlPath);
                logger.debug(`Deleted HTML file for product ${record.sku} from ${htmlPath}`);
              } catch (e) {
                logger.warn(`Error deleting HTML file for product ${record.sku}:`, e);
              }

              delete state.skus[record.sku];
              counts.unpublished++;
            } else {
              counts.failed++;
            }
          });
        });
        pendingBatches.push(pendingBatch);
      }
      await Promise.all(pendingBatches);
      await saveState(state, aioLibs, FILE_PREFIX, DATA_KEY);
    }
  } catch (e) {
    logger.error('Error processing deleted products:', e);
  }
}

/**
 * Filters the given products based on the given condition, increments the ignored count if the
 * condition is not met and removes the sku from the given list of remaining skus.
 * Returns an object with included and ignored product lists.
 *
 * @param {*} condition - the condition to filter the products by
 * @param {*} products - the products to filter
 * @param {*} remainingSkus - the list of remaining, known skus the filter logic will splice for every given product
 * @param {*} context - the context object
 * @returns {{ included: Array, ignored: Array }}
 */
function filterProducts(condition, products, remainingSkus, context) {
  const { counts } = context;
  const included = [];
  const ignored = [];
  for (const product of products) {
    const { sku } = product;
    // remove the sku from the given list of known skus
    const index = remainingSkus.indexOf(sku);
    if (index !== -1) remainingSkus.splice(index, 1);
    // increment count of ignored products if condition is not met
    if (condition(product)) {
      included.push(product);
    } else {
      counts.ignored += 1;
      ignored.push(product);
    }
  }
  return { included, ignored };
}

let getLastModifiedDatesLimit$;
async function getLastModifiedDates(skus, context) {
  if (skus.length > BATCH_SIZE) {
    const reqs = [];
    for (let i = 0; i < skus.length; i += BATCH_SIZE) {
      const batch = skus.slice(i, i + BATCH_SIZE);
      reqs.push(getLastModifiedDates(batch, context));
    }
    const results = await Promise.all(reqs);
    return results.flat();
  }

  if (!getLastModifiedDatesLimit$) {
    getLastModifiedDatesLimit$ = import('p-limit').then(({ default: pLimit }) => pLimit(50));
  }

  return (await getLastModifiedDatesLimit$)(async () => {
    return requestSaaS(GetLastModifiedQuery, 'getLastModified', { skus }, context).then((resp) => resp.data.products);
  });
}

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
      productsTemplate,
      storeUrl,
      contentUrl,
      logLevel,
      logIngestorEndpoint,
      locales: rawLocales,
    } = params;

    // Normalize locales: accept array or "en,fr" string; default to [null]
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
      productsTemplate,
      aioLibs,
      logLevel,
      logIngestorEndpoint,
    };

    const timings = new Timings();

    // Pass the token under the "authToken" key (expected by AdminAPI)
    const adminApi = new AdminAPI({ org, site }, sharedContext, { authToken: adminAuthToken });

    const { filesLib } = aioLibs;

    logger.info(`Starting poll from ${storeUrl} for locales ${locales}`);

    let stateText = 'completed';

    // Watchdog: if no render completes for WATCHDOG_TIMEOUT_MS the event loop is frozen.
    // recordActivity is called after every render (success or failure) to reset the timer.
    let lastActivityAt = Date.now();
    let watchdogIntervalId;
    const watchdogPromise = new Promise((_, reject) => {
      watchdogIntervalId = setInterval(() => {
        const idleMs = Date.now() - lastActivityAt;
        if (idleMs > WATCHDOG_TIMEOUT_MS) {
          clearInterval(watchdogIntervalId);
          const err = Object.assign(
            new Error(`Watchdog: no render activity for ${Math.floor(idleMs / 60000)} minutes — aborting`),
            { isWatchdog: true },
          );
          logger.error(err.message);
          reject(err);
        }
      }, WATCHDOG_CHECK_INTERVAL_MS);
    });
    sharedContext.recordActivity = () => { lastActivityAt = Date.now(); };

    try {
      // start processing preview and publish queues
      await adminApi.startProcessing();

      const localeProcessing = Promise.all(
        locales.map(async (locale) => {
          const timings = new Timings();
          const context = { ...sharedContext, startTime: new Date() };
          if (locale) context.locale = locale;

          logger.info(`Polling for locale ${locale}`);

          // load state
          const state = await loadState(locale, aioLibs, FILE_PREFIX, DATA_KEY);

          // add newly discovered produts to the state if necessary
          const productsFileName = getFileLocation(FILE_PREFIX, `${locale || 'default'}-products`, 'json');
          JSON.parse((await filesLib.read(productsFileName)).toString()).forEach(({ sku }) => {
            if (!state.skus[sku]) {
              state.skus[sku] = { lastRenderedAt: new Date(0), hash: null };
            }
          });
          timings.sample('get-discovered-products');

          // get last modified dates, filter out products that don't need to be (re)rendered
          const knownSkus = Object.keys(state.skus);
          let products = await getLastModifiedDates(knownSkus, context);
          logger.info(`Fetched last modified date for ${products.length} skus, total ${knownSkus.length}`);
          products = products.map((product) => enrichProductWithMetadata(product, state, context));
          ({ included: products } = filterProducts(shouldRender, products, knownSkus, context));
          timings.sample('get-changed-products');

          // create batches of products to preview and publish
          const pendingBatches = createBatches(products).map((batch, batchNumber) => {
            return Promise.all(batch.map((product) => enrichProductWithRenderedHash(product, context)))
              .then(async (enrichedProducts) => {
                const { included: productsToPublish, ignored: productsToIgnore } = filterProducts(
                  shouldPreviewAndPublish,
                  enrichedProducts,
                  knownSkus,
                  context,
                );

                // update the lastRenderedAt for the products to ignore anyway, to avoid re-rendering them everytime after
                // the lastModifiedAt changed once
                if (productsToIgnore.length) {
                  productsToIgnore.forEach((product) => {
                    state.skus[product.sku].lastRenderedAt = product.renderedAt;
                  });
                  await saveState(state, aioLibs, FILE_PREFIX, DATA_KEY);
                }

                return productsToPublish;
              })
              .then((products) => {
                if (products.length) {
                  const records = products.map(({ sku, path, renderedAt }) => ({ sku, path, renderedAt }));
                  return adminApi
                    .previewAndPublish(records, locale, batchNumber + 1)
                    .then((publishedBatch) =>
                      processPublishedBatch(publishedBatch, state, counts, products, aioLibs, {
                        dataKey: DATA_KEY,
                        keyField: 'sku',
                        filePrefix: FILE_PREFIX,
                      }),
                    )
                    .catch((error) => {
                      // Handle batch errors gracefully - don't fail the entire job
                      if (error.code === ERROR_CODES.BATCH_ERROR) {
                        logger.warn(`Batch ${batchNumber + 1} failed, continuing with other batches:`, {
                          error: error.message,
                          details: error.details,
                        });
                        // Update counts to reflect failed batch
                        counts.failed += products.length;
                        return { failed: true, batchNumber: batchNumber + 1, error: error.message };
                      } else {
                        // Re-throw global errors
                        throw error;
                      }
                    });
                } else {
                  return Promise.resolve();
                }
              });
          });
          products = null;
          await Promise.all(pendingBatches);
          timings.sample('published-products');

          // if there are still knownSkus left, they were not in Catalog Service anymore and may have been disabled/deleted
          if (knownSkus.length) {
            await processDeletedProducts(knownSkus, state, context, adminApi);
            timings.sample('unpublished-products');
          } else {
            timings.sample('unpublished-products', 0);
          }

          return timings.measures;
        }),
      );

      const results = await Promise.race([localeProcessing, watchdogPromise]);

      await adminApi.stopProcessing();

      // aggregate timings
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
      logger.error('Error during poll processing:', {
        message: e.message,
        code: e.code,
        stack: e.stack,
      });
      if (e.isWatchdog) {
        // Don't drain queues — the action is frozen. Abort immediately so the mutex is
        // cleared promptly and the next scheduled run can start.
        adminApi.abortProcessing();
      } else {
        // wait for queues to finish, even in error case
        await adminApi.stopProcessing();
      }
      stateText = 'failure';

      // If it's a JobFailedError, re-throw it
      if (e.isJobFailed) {
        throw e;
      }

      // For other errors, wrap them as JobFailedError
      throw new JobFailedError(
        `Poll processing failed: ${e.message}`,
        e.code || ERROR_CODES.PROCESSING_ERROR,
        e.statusCode || 500,
        { originalError: e.message },
      );
    } finally {
      clearInterval(watchdogIntervalId);
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

    logger.info(`Finished polling, elapsed: ${elapsed}ms`);

    return {
      state: stateText,
      elapsed,
      status: { ...counts },
      timings: timings.measures,
      memoryUsage,
    };
  } catch (error) {
    logger.error('Poll failed with error:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });

    // If it's a JobFailedError, re-throw it
    if (error.isJobFailed) {
      throw error;
    }

    // For other errors, wrap them as JobFailedError
    throw new JobFailedError(
      `Poll operation failed: ${error.message}`,
      error.code || ERROR_CODES.PROCESSING_ERROR,
      error.statusCode || 500,
      { originalError: error.message },
    );
  }
}

module.exports = { poll };
