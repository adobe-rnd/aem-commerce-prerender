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

const { Core, Files } = require('@adobe/aio-sdk');
const { getConfig, getSiteType, requestSaaS, SITE_TYPES, FILE_PREFIX } = require('../utils');
const { ProductsQuery, ProductCountQuery } = require('../queries');
const { Timings } = require('../lib/benchmark');
const { getRuntimeConfig } = require('../lib/runtimeConfig');
const { handleActionError } = require('../lib/errorHandler');
const { getCategorySlugsFromFamilies, getCategories, hasFamilies } = require('../categories');

const MAX_PRODUCTS_PER_CATEGORY = 10000; // page_size: 500 * 20 pages = 10000 products
const MAX_PAGES_FETCHED = 20;
const CONCURRENCY = 5;
const pLimitPromise = import('p-limit').then(({ default: pLimit }) => pLimit(CONCURRENCY));

const productMapper = ({ productView }) => ({
  urlKey: productView.urlKey,
  sku: productView.sku,
});

/**
 * Fetches all product SKUs and urlKeys for a single categoryPath via paginated productSearch.
 *
 * @param {string} categoryPath - Category path to filter by (empty string for all products).
 * @param {Object} context - Request context (config, logger, headers, etc.).
 * @returns {Promise<Array<{urlKey: string, sku: string}>>} Products in this category.
 */
async function getProductsByCategory(categoryPath, context) {
  const { logger } = context;
  const limit = await pLimitPromise;
  logger.debug('Getting products for category:', categoryPath);
  const firstPage = await requestSaaS(ProductsQuery, 'getProducts', { currentPage: 1, categoryPath }, context);
  const products = firstPage.data.productSearch.items.map(productMapper);
  let maxPage = firstPage.data.productSearch.page_info.total_pages;
  const totalCount = firstPage.data.productSearch.total_count;

  if (maxPage > MAX_PAGES_FETCHED) {
    logger.warn(
      `Category ${categoryPath || '(root)'} contains ${totalCount} products, which is more than the maximum supported of ${MAX_PRODUCTS_PER_CATEGORY}.
      Only the first ${MAX_PRODUCTS_PER_CATEGORY} products will be fetched for this category.`,
    );
    maxPage = MAX_PAGES_FETCHED;
  }

  const pages = Array.from({ length: maxPage - 1 }, (_, i) => i + 2);
  const results = await Promise.all(
    pages.map((page) =>
      limit(() => requestSaaS(ProductsQuery, 'getProducts', { currentPage: page, categoryPath }, context)),
    ),
  );
  for (const pageRes of results) {
    products.push(...pageRes.data.productSearch.items.map(productMapper));
  }

  return products;
}

/**
 * Merges batch results into the deduplication map, keyed by SKU.
 *
 * @param {Map<string, {urlKey: string, sku: string}>} productsBySku - Accumulator map.
 * @param {Array<Array<{urlKey: string, sku: string}>>} batchResults - Arrays of products from parallel fetches.
 */
function collectProducts(productsBySku, batchResults) {
  for (const products of batchResults) {
    for (const product of products) {
      productsBySku.set(product.sku, product);
    }
  }
}

/**
 * Fetches the total product count for the catalog.
 *
 * @param {Object} context - Request context.
 * @returns {Promise<number|undefined>} Total number of pages (each page = 1 product at page_size 1).
 */
async function getProductCount(context) {
  const countRes = await requestSaaS(ProductCountQuery, 'getProductCount', { categoryPath: '' }, context);
  return countRes.data.productSearch?.page_info?.total_pages;
}

/**
 * Resolves all category slugs from configured ACO category families and
 * fetches products for each slug. Deduplicates across categories since
 * products may belong to multiple slugs.
 *
 * @param {Object} context - Request context.
 * @param {string[]} categoryFamilies - Category family identifiers.
 * @returns {Promise<Array<{urlKey: string, sku: string}>>} Deduplicated product list.
 */
async function getAllProductsByCategoryFamily(context, categoryFamilies) {
  if (categoryFamilies.length === 0) {
    throw new Error('Tried to retrieve products by category family, but no category families are configured.');
  }

  const slugs = await getCategorySlugsFromFamilies(context, categoryFamilies);
  const productsBySku = new Map();

  const slugBatchSize = 50;
  for (let i = 0; i < slugs.length; i += slugBatchSize) {
    const batch = slugs.slice(i, i + slugBatchSize);
    const results = await Promise.all(batch.map((slug) => getProductsByCategory(slug, context)));
    collectProducts(productsBySku, results);
  }

  return [...productsBySku.values()];
}

/**
 * Discovers all product SKUs for an ACCS or PaaS storefront by category.
 * Iterates categories shallowest-first in batches of 50 with an early exit
 * once the expected product count is reached.
 *
 * @param {Object} context - Request context.
 * @param {number} productCount - Total expected product count.
 * @returns {Promise<Array<{urlKey: string, sku: string}>>} Deduplicated product list.
 */
async function getAllProductsByCategory(context, productCount) {
  const { logger } = context;
  const productsBySku = new Map();
  const categories = await getCategories(context);

  outer: for (const levelGroup of categories) {
    if (!levelGroup) continue;
    while (levelGroup.length) {
      const batch = levelGroup.splice(0, 50);
      const results = await Promise.all(batch.map((urlPath) => getProductsByCategory(urlPath, context)));
      collectProducts(productsBySku, results);
      if (productsBySku.size >= productCount) {
        // All products collected, break out of the outer loop
        break outer;
      }
    }
  }

  if (productsBySku.size !== productCount) {
    logger.warn(`Expected ${productCount} products, but got ${productsBySku.size}.`);
  }

  return [...productsBySku.values()];
}

/**
 * Retrieves all product SKUs for a given site type.
 *
 * @param {string} siteType - One of SITE_TYPES.ACO or SITE_TYPES.ACCS.
 * @param {Object} context - Request context.
 * @param {string[]} categoryFamilies - Configured ACO category families.
 * @returns {Promise<Array<{urlKey: string, sku: string}>>}
 */
async function getAllProducts(siteType, context, categoryFamilies) {
  const { logger } = context;
  const productCount = await getProductCount(context);

  if (!productCount) {
    throw new Error('Could not fetch product count from catalog.');
  }

  if (productCount <= MAX_PRODUCTS_PER_CATEGORY) {
    logger.info(
      `Catalog has less than ${MAX_PRODUCTS_PER_CATEGORY} products. Fetching all products from the default category.`,
    );
    return getProductsByCategory('', context);
  }

  if (siteType === SITE_TYPES.ACO) {
    logger.info(`Fetching the first ${MAX_PRODUCTS_PER_CATEGORY} products from the catalog.`);
    const defaultProducts = await getProductsByCategory('', context);
    if (!hasFamilies(categoryFamilies)) {
      return defaultProducts;
    }
    logger.info('Category families are configured. Fetching additional products by category family.');
    const familyProducts = await getAllProductsByCategoryFamily(context, categoryFamilies);
    const productsBySku = new Map();
    collectProducts(productsBySku, [defaultProducts, familyProducts]);
    return [...productsBySku.values()];
  }

  // ACCS or PaaS with > MAX_PRODUCTS_PER_CATEGORY products
  return getAllProductsByCategory(context, productCount);
}

/**
 * App Builder action entry point. Discovers all product SKUs for each configured
 * locale and writes them to a state file for the check-product-changes action.
 *
 * @param {Object} params - App Builder action parameters.
 * @returns {Promise<Object>} Action response with status and timings.
 */
async function main(params) {
  try {
    const cfg = getRuntimeConfig(params);
    const logger = Core.Logger('main', { level: cfg.logLevel });

    const sharedContext = { ...cfg, logger };
    logger.info(`Fetching all products for locales ${cfg.locales.join(', ')}`);

    const results = await Promise.all(
      cfg.locales.map(async (locale) => {
        logger.info(`Fetching all products for locale ${locale}`);
        const context = { ...sharedContext };
        if (locale) {
          context.locale = locale;
        }
        const timings = new Timings();
        const stateFilePrefix = locale || 'default';

        const siteConfig = await getConfig(context);
        const siteType = getSiteType(siteConfig);
        logger.debug(`Detected site type: ${siteType}`);
        const allProducts = await getAllProducts(siteType, context, cfg.categoryFamilies);

        timings.sample('getAllProducts');
        const filesLib = await Files.init(params.libInit || {});
        timings.sample('saveFile');
        const productsFileName = `${FILE_PREFIX}/${stateFilePrefix}-products.json`;
        logger.debug(`Saving products to ${productsFileName}`);
        await filesLib.write(productsFileName, JSON.stringify(allProducts));
        logger.debug(`${allProducts.length} total products saved to ${productsFileName}`);
        return timings.measures;
      }),
    );

    return {
      statusCode: 200,
      body: { status: 'completed', timings: results },
    };
  } catch (error) {
    const logger = Core.Logger('main', { level: 'error' });

    return handleActionError(error, {
      logger,
      actionName: 'Fetch all products',
    });
  }
}

exports.main = main;
