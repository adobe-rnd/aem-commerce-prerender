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
 * Event Processor Module
 * 
 * Handles processing of different Adobe Commerce event types
 */

const { processProductEvent } = require('./product-processor');
const { processEventThroughControls } = require('./control-systems');
const { logger } = require('./utils');

/**
 * Process Adobe Commerce event (product update or price update)
 * Both event types result in the same action: extract SKU, generate markup, and publish product
 */
async function processCommerceEvent(event, params, aioLibs) {
  logger.info('Processing Adobe Commerce event', { 
    eventId: event.id, 
    eventType: event.type 
  });
  
  try {
    const eventData = event.data || {};
    const sku = eventData.sku;
    
    if (!sku) {
      throw new Error('Product SKU is missing from event data');
    }
    
    // Log event details (same logging for both product and price events)
    logger.info('Commerce event details', {
      sku: sku,
      eventType: event.type,
      instanceId: eventData.instanceId,
      hasLinks: !!(eventData.links && eventData.links.length > 0),
      scopes: eventData.scope?.map(s => s.storeViewCode || s.websiteCode) || []
    });
    
    // Log additional data if present
    if (eventData.links && eventData.links.length > 0) {
      logger.debug('Event links', { links: eventData.links });
    }
    
    if (eventData.scope && eventData.scope.length > 0) {
      logger.debug('Event scopes', { 
        scopeCount: eventData.scope.length,
        scopes: eventData.scope 
      });
    }
    
    // Both product and price updates require the same action: regenerate HTML and publish
    logger.info('Starting product markup regeneration and publishing', { 
      sku: sku,
      triggerEvent: event.type
    });
    
    const processingResult = await processProductEvent(sku, params, aioLibs, logger);
    
    if (processingResult.success) {
      logger.info('Commerce event processing completed successfully', { 
        sku: sku,
        eventType: event.type,
        productUrl: processingResult.productUrl,
        processingTimeMs: processingResult.processingTimeMs
      });
      
      return { 
        success: true, 
        sku: sku,
        eventType: event.type,
        productUrl: processingResult.productUrl,
        htmlPath: processingResult.htmlPath,
        processingTimeMs: processingResult.processingTimeMs
      };
    } else {
      logger.error('Commerce event processing failed', {
        sku: sku,
        eventType: event.type,
        error: processingResult.error,
        processingTimeMs: processingResult.processingTimeMs
      });
      
      throw new Error(`Product processing failed: ${processingResult.error}`);
    }
    
  } catch (error) {
    logger.error('Error processing commerce event', error);
    throw error;
  }
}

/**
 * Route event to appropriate processor
 */
function routeEventToProcessor(event, params, aioLibs) {
  switch (event.type) {
    case 'com.adobe.commerce.storefront.events.product.update':
    case 'com.adobe.commerce.storefront.events.price.update':
      // Both product and price updates use the same processing logic
      return processCommerceEvent(event, params, aioLibs);
      
    default:
      logger.warn('Unknown event type received', { 
        eventType: event.type,
        supportedTypes: [
          'com.adobe.commerce.storefront.events.product.update',
          'com.adobe.commerce.storefront.events.price.update'
        ]
      });
      
      return Promise.resolve({
        success: false,
        reason: 'Unsupported event type',
        eventType: event.type
      });
  }
}

/**
 * Process event with all controls (rate limiting, filtering, queuing)
 */
async function processEventWithControls(event, params, aioLibs, config) {
  const processingStart = Date.now();
  
  logger.info('Processing event with rate limiting and filtering', {
    eventId: event.id,
    eventType: event.type,
    sku: event.data?.sku
  });

  try {
    // Step 1: Apply control systems (rate limiting, filtering, queuing)
    const controlResult = await processEventThroughControls(event, config);
    
    if (!controlResult.success) {
      // Event was filtered, rate limited, or queued
      return {
        ...controlResult,
        processingTimeMs: Date.now() - processingStart
      };
    }

    // Step 2: Process event immediately (controls passed)
    logger.info('Processing event immediately', {
      eventId: event.id,
      eventType: event.type,
      sku: event.data?.sku
    });

    const processingResult = await routeEventToProcessor(event, params, aioLibs);

    logger.info('Event processing completed', {
      eventId: event.id,
      eventType: event.type,
      sku: event.data?.sku,
      success: processingResult.success,
      processingTimeMs: Date.now() - processingStart
    });

    return {
      ...processingResult,
      processingTimeMs: Date.now() - processingStart,
      stage: 'processed_immediately'
    };

  } catch (error) {
    logger.error('Error in controlled event processing', {
      eventId: event.id,
      sku: event.data?.sku,
      error: error.message,
      processingTimeMs: Date.now() - processingStart
    });

    return {
      success: false,
      reason: 'Processing error',
      error: error.message,
      processingTimeMs: Date.now() - processingStart,
      stage: 'error'
    };
  }
}

module.exports = {
  processCommerceEvent,
  routeEventToProcessor,
  processEventWithControls
};
