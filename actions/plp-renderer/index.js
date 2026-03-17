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

const { Core } = require('@adobe/aio-sdk');
const { errorResponse, getConfig, getSiteType, requestSaaS, SITE_TYPES } = require('../utils');
const { getCategoryDataFromFamilies } = require('../categories');
const { generateCategoryHtml } = require('./render');
const { getRuntimeConfig } = require('../lib/runtimeConfig');
const { JobFailedError, ERROR_CODES } = require('../lib/errorHandler');
const { PlpProductSearchQuery } = require('../queries');

/**
 * One-off action to render a single category listing page by slug.
 *
 * @param {Object} params The parameters object
 * @param {string} params.slug The category slug to render (e.g. "electronics/computers-tablets")
 * @param {string} [params.locale] Optional locale override
 * @param {string} params.CONFIG_NAME The config sheet to use
 * @param {string} params.CONTENT_URL Edge Delivery URL of the store
 * @param {string} params.STORE_URL Public facing URL of the store
 * @param {string} params.ACO_CATEGORY_FAMILIES Comma-separated ACO category families
 */
async function main(params) {
  const cfg = getRuntimeConfig(params);
  const logger = Core.Logger('main', { level: cfg.logLevel });

  try {
    const { slug, locale } = params;
    const context = { ...cfg, logger };
    if (locale) {
      context.locale = locale;
    }
    const siteConfig = await getConfig(context);
    const siteType = getSiteType(siteConfig);

    if (siteType === SITE_TYPES.ACO) {
      if (!cfg.categoryFamilies?.length) {
        throw new JobFailedError('Missing ACO_CATEGORY_FAMILIES configuration', ERROR_CODES.VALIDATION_ERROR, 400);
      }
    } else {
      throw new JobFailedError('ACCS is not yet supported for PLP pre-rendering', ERROR_CODES.VALIDATION_ERROR, 400);
    }

    if (!slug) {
      throw new JobFailedError('Missing required parameter: slug must be provided', ERROR_CODES.VALIDATION_ERROR, 400);
    }

    logger.info(`Rendering category slug: ${slug} for locale: ${locale || 'default'}`);

    // Fetch full category tree (needed for breadcrumb resolution)
    logger.info(`Fetching category tree for families: ${cfg.categoryFamilies}`);
    const categoryMap = await getCategoryDataFromFamilies(context, cfg.categoryFamilies);
    logger.debug(`Category tree resolved with ${categoryMap.size} categories`);

    const categoryData = categoryMap.get(slug);
    if (!categoryData) {
      logger.info(`Slug "${slug}" not found. Available slugs: ${[...categoryMap.keys()].join(', ')}`);
      throw new JobFailedError(`Category not found: ${slug}`, ERROR_CODES.VALIDATION_ERROR, 404);
    }
    logger.debug(`Found category: ${categoryData.name} (level: ${categoryData.level})`);

    // Fetch products for this category
    logger.info(`Fetching products for category "${slug}" (pageSize: ${cfg.plpProductsPerPage})`);
    const productsRes = await requestSaaS(
      PlpProductSearchQuery,
      'plpProductSearch',
      {
        categoryPath: slug,
        pageSize: cfg.plpProductsPerPage,
        currentPage: 1,
      },
      context,
    );

    const products = productsRes.data.productSearch.items.map((item) => item.productView);
    logger.debug(`Retrieved ${products.length} products for category "${slug}"`);

    const categoryHtml = generateCategoryHtml(categoryData, products, categoryMap, context);

    const response = {
      statusCode: 200,
      body: categoryHtml,
    };
    logger.info(`${response.statusCode}: category "${slug}" rendered successfully`);
    return response;
  } catch (error) {
    logger.error(error);
    if (error.statusCode) {
      return errorResponse(error.statusCode, error.message, logger);
    }
    return errorResponse(500, 'server error', logger);
  }
}

exports.main = main;
