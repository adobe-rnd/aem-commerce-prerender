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
const { getRuntimeConfig } = require('../lib/runtimeConfig');
const { JobFailedError, ERROR_CODES } = require('../lib/errorHandler');

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
  const cfg = getRuntimeConfig(params);
  const logger = Core.Logger('main', { level: cfg.logLevel });

  try {
    let { sku, urlKey, locale } = params;
    const { __ow_path } = params; 
    
    if (!sku && !urlKey) {
      // try to extract sku and urlKey from path
      const result = extractPathDetails(__ow_path, cfg.pathFormat);
      logger.debug('Path parse results', JSON.stringify(result, null, 4));
      sku = result.sku;
      urlKey = result.urlKey;
      locale = result.locale;
    }

    if (!sku && !urlKey) {
      throw new JobFailedError(
        'Missing required parameters: sku or urlKey must be provided',
        ERROR_CODES.VALIDATION_ERROR,
        400
      );
    }

    const context = { ...cfg, logger };
    
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
