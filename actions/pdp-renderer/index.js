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

const { Core } = require('@adobe/aio-sdk')
const { errorResponse } = require('../utils');
const { extractPathDetails } = require('./lib');
const { generateProductHtml } = require('./render');

/**
 * Parameters
 * @param {Object} params The parameters object
 * @param {string} params.__ow_path The path of the request
 * @param {string} params.configName Overwrite for CONFIG_NAME using query parameter
 * @param {string} params.contentUrl Overwrite for CONTENT_URL using query parameter
 * @param {string} params.productsTemplate Overwrite for PRODUCTS_TEMPLATE using query parameter
 * @param {string} params.pathFormat Overwrite for PRODUCT_PAGE_URL_FORMAT using query parameter
 * @param {string} params.CONFIG_NAME The config sheet to use (e.g. configs for prod, configs-dev for dev)
 * @param {string} params.CONTENT_URL Edge Delivery URL of the store (e.g. aem.live)
 * @param {string} params.STORE_URL Public facing URL of the store
 * @param {string} params.PRODUCTS_TEMPLATE URL to the products template page
 * @param {string} params.PRODUCT_PAGE_URL_FORMAT The path format to use for parsing
 */
async function main (params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' })

  try {
    let { sku, urlKey, locale } = params;
    const {
      __ow_path,
      STORE_URL: storeUrl,
      CONTENT_URL: contentUrl,
      CONFIG_NAME: configName,
      CONFIG_SHEET: configSheet,
      PRODUCTS_TEMPLATE: productsTemplate,
      PRODUCT_PAGE_URL_FORMAT: pathFormat,
    } = params;   
    
    if (!sku && !urlKey) {
      // try to extract sku and urlKey from path
      const result = extractPathDetails(__ow_path, pathFormat);
      logger.debug('Path parse results', JSON.stringify(result, null, 4));
      sku = result.sku;
      urlKey = result.urlKey;
      locale = result.locale;
    }

    if ((!sku && !urlKey) || !contentUrl) {
      return errorResponse(400, 'Invalid path', logger);
    }

    const context = { contentUrl, storeUrl, configName, configSheet, logger, pathFormat, productsTemplate };
    // Map locale to context
    if (locale) {
      context.locale = locale;
    }

    // Retrieve base product
    const productHtml = await generateProductHtml(sku, urlKey, context);

    const response = {
      statusCode: 200,
      body: productHtml,
    }
    logger.info(`${response.statusCode}: successful request`)
    return response;

  } catch (error) {
    logger.error(error)
    // Return appropriate status code if specified
    if (error.statusCode) {
      return errorResponse(error.statusCode, error.message, logger);
    }
    return errorResponse(500, 'server error', logger);
  }
}

exports.main = main
