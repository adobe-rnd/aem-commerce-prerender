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
 * Adobe Commerce Events Handler
 * 
 * Processes product update and price update events from Adobe Commerce
 * and generates/publishes corresponding product pages.
 */

const { logger, validateCloudEvent, createResponse } = require('./utils');
const { processProductEvent } = require('./product-processor');
// const { validateSignature } = require('./authentication'); // Disabled for now

/**
 * Main action function
 * @param {object} params - Action parameters from Adobe I/O Events
 * @returns {object} Processing result
 */
async function main(params) {
  const startTime = Date.now();
  
  logger.info('=== Adobe Commerce Events Handler Started ===');
  
  try {
    // Step 1: Validate CloudEvent structure
    const validation = validateCloudEvent(params);
    if (!validation.valid) {
      logger.error('Invalid CloudEvent structure', validation);
      return createResponse(params, {
        success: false,
        error: 'Invalid CloudEvent structure',
        details: validation.missingFields
      }, Date.now() - startTime);
    }

    // Step 2: Skip authentication for now (RSA signatures need special handling)
    logger.info('Skipping authentication - RSA signature validation not implemented yet');

    // Step 3: Check event type
    const supportedTypes = [
      'com.adobe.commerce.storefront.events.product.update',
      'com.adobe.commerce.storefront.events.price.update'
    ];

    if (!supportedTypes.includes(params.type)) {
      logger.warn('Unsupported event type', { 
        eventType: params.type,
        supportedTypes 
      });
      return createResponse(params, {
        success: false,
        error: 'Unsupported event type',
        eventType: params.type
      }, Date.now() - startTime);
    }

    // Step 4: Extract SKU from event data
    const sku = params.data?.sku;
    if (!sku) {
      logger.error('Missing SKU in event data', { eventId: params.id });
      return createResponse(params, {
        success: false,
        error: 'Missing SKU in event data'
      }, Date.now() - startTime);
    }

    logger.info('Processing Commerce event', {
      eventId: params.id,
      eventType: params.type,
      sku: sku,
      source: params.source
    });

    // Step 5: Process the product event
    const result = await processProductEvent(sku, params);

    const processingTime = Date.now() - startTime;
    
    logger.info('Event processing completed', {
      success: result.success,
      eventId: params.id,
      sku: sku,
      processingTimeMs: processingTime
    });

    logger.info('=== Adobe Commerce Events Handler Finished ===');

    return createResponse(params, result, processingTime);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    logger.error('Event processing failed', {
      error: error.message,
      stack: error.stack,
      eventId: params.id,
      processingTimeMs: processingTime
    });

    return createResponse(params, {
      success: false,
      error: error.message
    }, processingTime);
  }
}

exports.main = main;