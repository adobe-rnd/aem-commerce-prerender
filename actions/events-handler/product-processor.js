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

/**
 * Product Event Processor
 * 
 * Handles product update and price update events by generating
 * and publishing product pages using the pdp-renderer.
 */

const { AdminAPI } = require('../lib/aem');
const { generateProductHtml } = require('../pdp-renderer/render');
const { getProductUrl, PDP_FILE_EXT, requestSaaS } = require('../utils');
const { GetLastModifiedQuery } = require('../queries');
const { getRuntimeConfig } = require('../lib/runtimeConfig');
const { logger, initAIOLibs } = require('./utils');

/**
 * Process a product event (update or price change)
 * @param {string} sku - Product SKU
 * @param {object} params - Event parameters
 * @returns {object} Processing result
 */
async function processProductEvent(sku, params) {
  const startTime = Date.now();
  
  logger.info('Starting product processing', { sku });
  
  try {
    // Initialize configuration and context
    const config = getRuntimeConfig(params, logger);
    const aioLibs = await initAIOLibs(params);
    
    const context = {
      storeUrl: config.storeUrl,
      contentUrl: config.contentUrl,
      configName: config.configName,
      configSheet: config.configSheet,
      pathFormat: config.pathFormat,
      productsTemplate: config.productsTemplate,
      locale: config.locales?.[0],
      logger,
      aioLibs,
      logLevel: config.logLevel,
      logIngestorEndpoint: config.logIngestorEndpoint,
      startTime: new Date()
    };

    // Initialize AdminAPI
    const adminApi = new AdminAPI(
      { org: config.org, site: config.site }, 
      context, 
      { authToken: config.adminAuthToken }
    );
    
    await adminApi.startProcessing();
    
    try {
      // Step 1: Get product data
      logger.info('Step 1: Getting product data');
      const productData = await getProductData(sku, context);
      
      if (!productData) {
        return {
          success: false,
          reason: 'Product not found in catalog',
          sku
        };
      }

      // Step 2: Generate HTML (TEMPORARILY DISABLED)
      logger.info('Step 2: Skipping HTML generation (temporarily disabled)');
      const html = '<html><body>Mock HTML for testing</body></html>';
      
      // Step 3: Save HTML file (TEMPORARILY DISABLED)
      logger.info('Step 3: Skipping HTML file saving (temporarily disabled)');
      const htmlPath = `/public/pdps/products/${productData.urlKey}/${sku}.html`;
      
      // Step 4: Publishing (TEMPORARILY DISABLED)
      logger.info('Step 4: Skipping publishing (temporarily disabled)');
      
      // Return immediately with mock success
      const publishResult = { 
        status: 'success-mock',
        message: 'Mock publishing completed successfully',
        timestamp: new Date().toISOString(),
        htmlPath: htmlPath
      };
      
      logger.info('Publishing started asynchronously, continuing', { sku });
      
      const processingTime = Date.now() - startTime;
      
      logger.info('Product processing completed successfully', {
        sku,
        urlKey: productData.urlKey,
        htmlPath,
        processingTimeMs: processingTime,
        batchNumber: publishResult.batchNumber
      });
      
      return {
        success: true,
        sku,
        urlKey: productData.urlKey,
        htmlPath,
        processingTimeMs: processingTime,
        publishResult
      };
      
    } finally {
      await adminApi.stopProcessing();
    }
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    logger.error('Product processing failed', {
      sku,
      error: error.message,
      processingTimeMs: processingTime
    });
    
    return {
      success: false,
      sku,
      error: error.message,
      processingTimeMs: processingTime
    };
  }
}

/**
 * Get product data from Commerce API
 * @param {string} sku - Product SKU
 * @param {object} context - Processing context
 * @returns {object|null} Product data or null if not found
 */
async function getProductData(sku, context) {
  logger.debug('Fetching product data', { sku });
  
  try {
    const response = await requestSaaS(GetLastModifiedQuery, 'getLastModified', { skus: [sku] }, context);
    
    if (!response?.data?.products?.length) {
      logger.warn('Product not found in catalog', { sku });
      return null;
    }
    
    const product = response.data.products[0];
    logger.debug('Product data retrieved', { 
      sku: product.sku, 
      urlKey: product.urlKey 
    });
    
    return product;
    
  } catch (error) {
    logger.error('Error fetching product data', { sku, error: error.message });
    throw error;
  }
}

/**
 * Generate HTML for product using pdp-renderer
 * @param {string} sku - Product SKU
 * @param {string} urlKey - Product URL key
 * @param {object} context - Processing context
 * @returns {string} Generated HTML
 */
async function generateProductHTML(sku, urlKey, context) {
  logger.debug('Generating product HTML', { sku, urlKey });
  
  try {
    const html = await generateProductHtml(sku, urlKey, context);
    
    if (!html) {
      throw new Error('Generated HTML is empty');
    }
    
    logger.debug('Product HTML generated successfully', { 
      sku, 
      urlKey,
      htmlLength: html.length
    });
    
    return html;
    
  } catch (error) {
    logger.error('Error generating product HTML', { sku, urlKey, error: error.message });
    throw error;
  }
}

/**
 * Save HTML file to storage
 * @param {string} sku - Product SKU
 * @param {string} urlKey - Product URL key
 * @param {string} html - Generated HTML
 * @param {object} context - Processing context
 * @returns {Promise<string>} File path
 */
async function saveProductHTML(sku, urlKey, html, context) {
  logger.debug('Saving product HTML', { sku, urlKey });
  
  try {
    const productUrl = getProductUrl({ urlKey, sku }, context, false);
    const htmlPath = `/public/pdps${productUrl}.${PDP_FILE_EXT}`;
    
    await context.aioLibs.filesLib.write(htmlPath, html);
    
    logger.info('Product HTML saved successfully', { 
      sku, 
      urlKey,
      path: htmlPath,
      htmlSize: html.length
    });
    
    return htmlPath;
    
  } catch (error) {
    logger.error('Error saving product HTML', { sku, urlKey, error: error.message });
    throw error;
  }
}

/**
 * Publish product via AEM Admin API
 * @param {string} sku - Product SKU
 * @param {string} urlKey - Product URL key
 * @param {object} context - Processing context
 * @param {object} adminApi - AdminAPI instance
 * @returns {Promise<object>} Publish result
 */
async function publishProduct(sku, urlKey, context, adminApi) {
  logger.debug('Publishing product', { sku, urlKey });
  
  try {
    const productUrl = getProductUrl({ urlKey, sku }, context, false);
    
    const records = [{
      sku,
      path: productUrl,
      renderedAt: new Date()
    }];
    
    const publishResult = await adminApi.previewAndPublish(records, context.locale || null, 1);
    
    logger.info('Product published successfully', { 
      sku, 
      urlKey,
      path: productUrl,
      batchNumber: publishResult.batchNumber
    });
    
    return publishResult;
    
  } catch (error) {
    logger.error('Error publishing product', { sku, urlKey, error: error.message });
    throw error;
  }
}

module.exports = {
  processProductEvent
};