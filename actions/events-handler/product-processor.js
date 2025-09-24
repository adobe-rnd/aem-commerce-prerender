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
 * Product Processor - Event-driven product publishing
 * 
 * Adapted logic from check-product-changes/poller.js for 
 * processing individual products based on Adobe Commerce events.
 */

const crypto = require('crypto');
const { AdminAPI } = require('../lib/aem');
const { generateProductHtml } = require('../pdp-renderer/render');
const { 
  getProductUrl,
    PDP_FILE_EXT,
  requestSaaS 
} = require('../utils');
const { GetLastModifiedQuery } = require('../queries');
const { getRuntimeConfig } = require('../lib/runtimeConfig');

/**
 * Gets product information by SKU
 */
async function getProductData(sku, context) {
  const { logger } = context;
  
  try {
    logger.debug('Fetching product data', { sku });
    
    const query = GetLastModifiedQuery([sku]);
    const response = await requestSaaS(query, context);
    
    if (!response?.data?.products?.length) {
      logger.warn('Product not found in catalog', { sku });
      return null;
    }
    
    const product = response.data.products[0];
    logger.debug('Product data fetched', { 
      sku: product.sku, 
      urlKey: product.urlKey,
      lastModifiedAt: product.lastModifiedAt
    });
    
    return product;
    
  } catch (error) {
    logger.error('Error fetching product data', { sku, error: error.message });
    throw error;
  }
}

/**
 * Generates HTML for product
 */
async function generateProductHTML(sku, urlKey, context) {
  const { logger } = context;
  
  try {
    logger.debug('Generating product HTML', { sku, urlKey });
    
    const productHtml = await generateProductHtml(sku, urlKey, context);
    
    if (!productHtml) {
      throw new Error('Generated HTML is empty');
    }
    
    // Create hash for tracking changes
    const contentHash = crypto.createHash('sha256').update(productHtml).digest('hex');
    
    logger.debug('Product HTML generated', { 
      sku, 
      htmlLength: productHtml.length,
      contentHash: contentHash.substring(0, 8) + '...'
    });
    
    return { html: productHtml, hash: contentHash };
    
  } catch (error) {
    logger.error('Error generating product HTML', { sku, urlKey, error: error.message });
    throw error;
  }
}

/**
 * Saves HTML file to public storage
 */
async function saveProductHTML(sku, urlKey, html, context) {
  const { logger, aioLibs } = context;
  const { filesLib } = aioLibs;
  
  try {
    const productUrl = getProductUrl({ urlKey, sku }, context, false).toLowerCase();
    const htmlPath = `/public/pdps${productUrl}.${PDP_FILE_EXT}`;
    
    logger.debug('Saving product HTML', { sku, htmlPath });
    
    await filesLib.write(htmlPath, html);
    
    logger.info('Product HTML saved successfully', { 
      sku, 
      path: htmlPath,
      htmlSize: html.length
    });
    
    return { path: htmlPath, url: productUrl };
    
  } catch (error) {
    logger.error('Error saving product HTML', { sku, urlKey, error: error.message });
    throw error;
  }
}

/**
 * Publishes product via AEM Admin API
 */
async function publishProduct(sku, productPath, context, adminApi) {
  const { logger } = context;
  
  try {
    logger.debug('Publishing product', { sku, path: productPath });
    
    const records = [{
      sku,
      path: productPath,
      renderedAt: new Date()
    }];
    
    // Use the same process as in poller.js
    const publishResult = await adminApi.previewAndPublish(records, context.locale || null, 1);
    
    logger.info('Product published successfully', { 
      sku, 
      path: productPath,
      batchNumber: publishResult.batchNumber
    });
    
    return publishResult;
    
  } catch (error) {
    logger.error('Error publishing product', { sku, path: productPath, error: error.message });
    throw error;
  }
}

/**
 * Main function for processing product based on event
 */
async function processProductEvent(sku, params, aioLibs, logger) {
  const processingStart = Date.now();
  
  logger.info('Starting product processing', { sku });
  
  try {
    // Initialize configuration and context (similar to poller.js)
    const runtimeConfig = getRuntimeConfig(params, logger);
    
    const {
      org, site, pathFormat: PRODUCT_PAGE_URL_FORMAT,
      configName, configSheet,
      adminAuthToken: AEM_ADMIN_API_AUTH_TOKEN,
      productsTemplate: PRODUCTS_TEMPLATE, 
      storeUrl: STORE_URL, 
      contentUrl: CONTENT_URL,
      logLevel, logIngestorEndpoint,
      locales
    } = runtimeConfig;
    
    // Create context like in poller.js
    const context = {
      storeUrl: STORE_URL,
      contentUrl: CONTENT_URL,
      configName,
      configSheet,
      logger,
      pathFormat: PRODUCT_PAGE_URL_FORMAT,
      productsTemplate: PRODUCTS_TEMPLATE,
      aioLibs,
      logLevel,
      logIngestorEndpoint,
      startTime: new Date()
    };
    
    // Add locale if available
    if (locales && Array.isArray(locales) && locales.length > 0) {
      context.locale = locales[0]; // Use first locale
    }
    
    // Initialize AdminAPI (similar to poller.js)
    const adminApi = new AdminAPI(
      { org, site }, 
      context, 
      { authToken: AEM_ADMIN_API_AUTH_TOKEN }
    );
    
    // Start queue processing
    await adminApi.startProcessing();
    
    try {
      // 1. Get product data
      logger.info('Step 1: Fetching product data', { sku });
      const productData = await getProductData(sku, context);
      
      if (!productData) {
        logger.warn('Product not found, skipping processing', { sku });
        return {
          success: false,
          reason: 'Product not found in catalog',
          sku,
          processingTimeMs: Date.now() - processingStart
        };
      }
      
      const { urlKey } = productData;
      
      // 2. Generate HTML
      logger.info('Step 2: Generating product HTML', { sku, urlKey });
      const { html, hash } = await generateProductHTML(sku, urlKey, context);
      
      // 3. Save HTML file
      logger.info('Step 3: Saving product HTML', { sku });
      const { path: htmlPath, url: productUrl } = await saveProductHTML(sku, urlKey, html, context);
      
      // 4. Publish via AEM
      logger.info('Step 4: Publishing product', { sku, path: productUrl });
      const publishResult = await publishProduct(sku, productUrl, context, adminApi);
      
      const processingTime = Date.now() - processingStart;
      
      logger.info('Product processing completed successfully', {
        sku,
        urlKey,
        htmlPath,
        productUrl,
        contentHash: hash.substring(0, 8) + '...',
        processingTimeMs: processingTime,
        batchNumber: publishResult.batchNumber
      });
      
      return {
        success: true,
        sku,
        urlKey,
        productUrl,
        htmlPath,
        contentHash: hash,
        processingTimeMs: processingTime,
        publishResult
      };
      
    } finally {
      // Always stop queue processing
      await adminApi.stopProcessing();
    }
    
  } catch (error) {
    const processingTime = Date.now() - processingStart;
    
    logger.error('Product processing failed', {
      sku,
      error: error.message,
      stack: error.stack,
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

module.exports = {
  processProductEvent,
  getProductData,
  generateProductHTML,
  saveProductHTML,
  publishProduct
};
