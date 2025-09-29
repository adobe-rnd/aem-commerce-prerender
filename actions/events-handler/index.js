/*
 * Adobe I/O Events Handler
 * 
 * This action consumes events from Adobe I/O Events Journaling API
 * and processes them to generate product HTML and publish to AEM.
 * 
 * Based on: https://github.com/AdobeDocs/adobeio-samples-journaling-events/
 */

const { Core, Events, State, Files } = require('@adobe/aio-sdk');
const { StateManager } = require('../lib/state');
const { TokenManager } = require('./token-manager');
const { ObservabilityClient } = require('../lib/observability');
const { getRuntimeConfig } = require('../lib/runtimeConfig');
const { generateProductHtml } = require('../pdp-renderer/render');
const { AdminAPI } = require('../lib/aem');
const { getProductUrl, PDP_FILE_EXT } = require('../utils');

/**
 * Saves events to state and updates the latest position
 * @param {Object} stateManager - State manager instance
 * @param {string} dbEventKey - Key for storing events in state
 * @param {Array} newEvents - Array of new events to save
 */
async function saveEventsToState(stateManager, dbEventKey, newEvents) {
  if (!newEvents || newEvents.length === 0) {
    return;
  }

  const existingDataString = await stateManager.get(dbEventKey);
  let eventsData = { events: [], latest: null };
  
  if (existingDataString) {
    try {
      eventsData = JSON.parse(existingDataString);
    } catch (error) {
      console.warn('Error parsing existing events data, starting fresh:', error.message);
      eventsData = { events: [], latest: null };
    }
  }
  
  // Update latest position
  eventsData.latest = newEvents[newEvents.length - 1];
  
  // Add new events (you might want to implement cleanup logic here)
  eventsData.events = eventsData.events.concat(newEvents);
  
  // Keep only last 1000 events to prevent state from growing too large
  if (eventsData.events.length > 1000) {
    eventsData.events = eventsData.events.slice(-1000);
  }
  
  await stateManager.put(dbEventKey, JSON.stringify(eventsData));
}

/**
 * Gets the latest event position from state
 * @param {Object} stateManager - State manager instance
 * @param {string} dbEventKey - Key for stored events
 * @returns {string|undefined} Last event position or undefined if none
 */
async function getLatestEventPosition(stateManager, dbEventKey) {
  const eventsDataString = await stateManager.get(dbEventKey);
  if (!eventsDataString) {
    return undefined;
  }
  
  try {
    const eventsData = JSON.parse(eventsDataString);
    return eventsData?.latest?.position;
  } catch (error) {
    console.warn('Error parsing events data from state:', error.message);
    return undefined;
  }
}

/**
 * Fetches events from Adobe I/O Events Journal
 * @param {Object} params - Action parameters
 * @param {string} token - Access token
 * @param {string} since - Position to start from
 * @returns {Promise<Array>} Array of events
 */
async function fetchEvents(params, token, since) {
  const eventsClient = await Events.init(params.ims_org_id, params.apiKey, token);
  
  let options = {};
  if (since) {
    options.since = since;
  }
  
  const journalling = await eventsClient.getEventsFromJournal(params.journalling_url, options);
  return journalling.events;
}

/**
 * Extracts unique SKUs from events
 * @param {Array} events - Array of events
 * @returns {Array} Array of unique SKUs
 */
function extractUniqueSKUs(events) {
  const skus = new Set();
  
  for (const event of events) {
    const sku = event.data?.sku;
    if (sku) {
      skus.add(sku);
    }
  }
  
  return Array.from(skus);
}

/**
 * Generate HTML for a single SKU
 * @param {string} sku - Product SKU
 * @param {Object} context - Processing context
 * @param {Object} filesLib - Files library instance
 * @returns {Object} Processing result with HTML path
 */
async function generateSKUHtml(sku, context, filesLib) {
  const { logger } = context;
  const startTime = Date.now();
  
  try {
    logger.info(`Generating HTML for SKU: ${sku}`);
    
    // Generate HTML using pdp-renderer
    const html = await generateProductHtml(sku, null, context);
    
    if (!html) {
      return {
        success: false,
        error: 'HTML generation failed - product not found or invalid',
        sku: sku,
        processingTime: Date.now() - startTime
      };
    }
    
    // Generate path using the same logic as check-product-changes
    const productUrl = getProductUrl({ sku }, context, false).toLowerCase();
    const htmlPath = `/public/pdps${productUrl}.${PDP_FILE_EXT}`;
    
    // Save HTML file
    if (filesLib) {
      await filesLib.write(htmlPath, html);
    }
    
    logger.info(`HTML generated and saved: ${htmlPath}`);
    
    return {
      success: true,
      sku: sku,
      htmlPath: htmlPath,
      path: productUrl, // path without /public/pdps prefix for publishing
      renderedAt: new Date(),
      processingTime: Date.now() - startTime
    };
    
  } catch (error) {
    logger.error(`Error generating HTML for SKU ${sku}:`, error.message);
    return {
      success: false,
      error: error.message,
      sku: sku,
      processingTime: Date.now() - startTime
    };
  }
}

/**
 * Process a batch of SKUs - generates HTML and publishes in batch
 * @param {Array} skuBatch - Array of SKUs to process
 * @param {Object} context - Processing context
 * @param {Object} filesLib - Files library instance
 * @param {Object} rateLimiter - Rate limiter for GraphQL requests
 * @param {number} batchNumber - Batch number for logging
 * @returns {Object} Batch processing result
 */
async function processBatch(skuBatch, context, filesLib, rateLimiter, batchNumber) {
  const { logger } = context;
  const batchStart = Date.now();
  
  logger.info(`Processing batch ${batchNumber} with ${skuBatch.length} SKUs: [${skuBatch.join(', ')}]`);
  
  try {
    // Step 1: Generate HTML for all SKUs with rate limiting
    const htmlResults = [];
    
    for (const sku of skuBatch) {
      await rateLimiter(); // Rate limit GraphQL requests
      const htmlResult = await generateSKUHtml(sku, context, filesLib);
      htmlResults.push(htmlResult);
    }
    
    // Step 2: Filter successful HTML generations
    const successfulResults = htmlResults.filter(result => result.success);
    const failedResults = htmlResults.filter(result => !result.success);
    
    if (successfulResults.length === 0) {
      return {
        success: false,
        batchNumber,
        error: 'No successful HTML generations in batch',
        failed: failedResults.length,
        processingTime: Date.now() - batchStart
      };
    }
    
    // Step 3: Publish all successful results in one batch
    const config = getRuntimeConfig(context, { validateToken: true });
    
    if (!config.AEM_ADMIN_API_AUTH_TOKEN) {
      logger.warn(`No AEM_ADMIN_API_AUTH_TOKEN - skipping batch publish`);
      return {
        success: true,
        batchNumber,
        processed: successfulResults.length,
        failed: failedResults.length,
        skipped: successfulResults.length,
        reason: 'No auth token',
        processingTime: Date.now() - batchStart
      };
    }
    
    const adminApi = new AdminAPI({
      adminToken: config.AEM_ADMIN_API_AUTH_TOKEN,
      contentUrl: config.CONTENT_URL,
      logger: logger
    });
    
    // Prepare records for batch publishing (like check-product-changes)
    const records = successfulResults.map(({ sku, path, renderedAt }) => ({
      sku,
      path,
      renderedAt
    }));
    
    logger.info(`Publishing batch ${batchNumber} with ${records.length} records`);
    
    // Start admin API processing
    await adminApi.startProcessing();
    
    const publishedBatch = await adminApi.previewAndPublish(records, null, batchNumber);
    
    // Stop admin API processing
    await adminApi.stopProcessing();
    
    // Process the published batch result (like check-product-changes)
    const { records: publishedRecords } = publishedBatch;
    let publishedCount = 0;
    let failedPublishCount = 0;
    
    publishedRecords.forEach((record) => {
      if (record.previewedAt && record.publishedAt) {
        publishedCount++;
        logger.debug(`Successfully published: ${record.sku} -> ${record.path}`);
      } else {
        failedPublishCount++;
        logger.warn(`Failed to publish: ${record.sku} -> ${record.path}`);
      }
    });
    
    logger.info(`Batch ${batchNumber} published: ${publishedCount} successful, ${failedPublishCount} failed`);
    
    return {
      success: true,
      batchNumber,
      processed: successfulResults.length,
      failed: failedResults.length,
      published: publishedCount,
      publishFailed: failedPublishCount,
      publishedBatch: publishedBatch,
      processingTime: Date.now() - batchStart
    };
    
  } catch (error) {
    logger.error(`Error processing batch ${batchNumber}:`, error.message);
    return {
      success: false,
      batchNumber,
      error: error.message,
      failed: skuBatch.length,
      processingTime: Date.now() - batchStart
    };
  }
}

// Batch processing configuration
const BATCH_SIZE = 10; // Smaller batches for events processing

/**
 * Creates batches of SKUs for processing
 * @param {Array} skus - Array of SKUs to batch
 * @returns {Array} Array of batches
 */
function createBatches(skus) {
  return skus.reduce((acc, sku) => {
    if (!acc.length || acc[acc.length - 1].length === BATCH_SIZE) {
      acc.push([]);
    }
    acc[acc.length - 1].push(sku);
    return acc;
  }, []);
}

/**
 * Rate limiter using simple delay
 * @param {number} requestsPerSecond - Max requests per second
 */
function createRateLimiter(requestsPerSecond = 10) {
  const delayMs = 1000 / requestsPerSecond;
  let lastRequest = 0;
  
  return async function() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequest;
    
    if (timeSinceLastRequest < delayMs) {
      const waitTime = delayMs - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    lastRequest = Date.now();
  };
}

/**
 * Main action function
 * @param {Object} params - Action parameters
 * @returns {Object} Action result
 */
async function main(params) {
  const logger = Core.Logger('events-handler', { level: params.LOG_LEVEL || 'info' });
  
  // Load runtime configuration
  const cfg = getRuntimeConfig(params);
  
  // Initialize observability (best-effort usage later)
  const observabilityClient = new ObservabilityClient(logger, {
    token: cfg.AEM_ADMIN_API_AUTH_TOKEN,
    endpoint: cfg.logIngestorEndpoint,
    org: cfg.ORG,
    site: cfg.SITE
  });
  
  try {
    logger.info('Starting Adobe I/O Events Handler');
    
    // Initialize Adobe I/O SDK components
    const stateLib = await State.init(params.libInit || {});
    const filesLib = await Files.init(params.libInit || {});
    const stateManager = new StateManager(stateLib, { logger });
    
    // Initialize token manager for automatic token refresh
    const tokenManager = new TokenManager(params, stateManager, logger);
    
    // Get access token (will be refreshed automatically if expired)
    const token = await tokenManager.getAccessToken();
    
    if (!token) {
      throw new Error('Failed to obtain Adobe I/O access token');
    }
    
    logger.info('Adobe I/O access token obtained successfully');
    
    // Configuration
    const dbEventKey = params.db_event_key || 'events_position';
    const maxEventsInBatch = parseInt(params.max_events_in_batch || '5', 10);
    const rateLimiter = createRateLimiter(10); // 10 requests per second
    
    // Get the latest event position
    const latestEventPos = await getLatestEventPosition(stateManager, dbEventKey);
    
    if (latestEventPos) {
      logger.info(`Fetching events since position: ${latestEventPos}`);
    } else {
      logger.info('Fetching events from the beginning');
    }
    
    // Processing statistics
    let fetchCount = 0;
    let totalEventsNum = 0;
    let processedSKUs = 0;
    let failedSKUs = 0;
    let publishedSKUs = 0;
    let publishFailedSKUs = 0;
    
    // Process events in batches
    const journallingUrl = params.journalling_url || params.JOURNAL_URL;
    const eventParams = {
      ims_org_id: params.IMS_ORG_ID,
      apiKey: params.CLIENT_ID,
      journalling_url: journallingUrl
    };
    
    let events = await fetchEvents(eventParams, token, latestEventPos);
    
    while (events && events.length > 0) {
      logger.info(`Got ${events.length} events, processing...`);
      
      // Save events to state
      await saveEventsToState(stateManager, dbEventKey, events);
      
      // Extract unique SKUs from events
      const skus = extractUniqueSKUs(events);
      logger.info(`Found ${skus.length} unique SKUs: ${skus.join(', ')}`);
      
      // Process SKUs in batches like check-product-changes
      if (skus.length > 0) {
        const config = getRuntimeConfig(params);
        const processingContext = {
          ...config,
          logger,
          aioLibs: { filesLib }
        };
        
        // Create batches of SKUs
        const skuBatches = createBatches(skus);
        logger.info(`Processing ${skus.length} SKUs in ${skuBatches.length} batches (batch size: ${BATCH_SIZE})`);
        
        // Process each batch
        const batchResults = [];
        
        for (let i = 0; i < skuBatches.length; i++) {
          const batchNumber = i + 1;
          const skuBatch = skuBatches[i];
          
          const batchResult = await processBatch(skuBatch, processingContext, filesLib, rateLimiter, batchNumber);
          batchResults.push(batchResult);
          
          if (batchResult.success) {
            processedSKUs += batchResult.processed || 0;
            failedSKUs += batchResult.failed || 0;
            publishedSKUs += batchResult.published || 0;
            publishFailedSKUs += batchResult.publishFailed || 0;
            logger.info(`Batch ${batchNumber} completed: ${batchResult.processed} processed, ${batchResult.failed} failed, ${batchResult.published} published (${batchResult.processingTime}ms)`);
          } else {
            failedSKUs += batchResult.failed || skuBatch.length;
            logger.error(`Batch ${batchNumber} failed: ${batchResult.error}`);
          }
        }
        
        // Log batch summary
        const successfulBatches = batchResults.filter(r => r.success).length;
        const failedBatches = batchResults.filter(r => !r.success).length;
        logger.info(`Batch processing summary: ${successfulBatches} successful, ${failedBatches} failed batches`);
      }
      
      totalEventsNum += events.length;
      fetchCount++;
      
      // Check if we should continue fetching
      if (fetchCount >= maxEventsInBatch) {
        logger.info(`Reached max batch limit (${maxEventsInBatch}), stopping`);
        break;
      }
      
      // Fetch next batch
      const lastEventPosition = events[events.length - 1].position;
      events = await fetchEvents(eventParams, token, lastEventPosition);
    }
    
    const result = {
      status: 'completed',
      statistics: {
        events_fetched: totalEventsNum,
        fetch_batches: fetchCount,
        processed_skus: processedSKUs,
        failed_skus: failedSKUs,
        published_skus: publishedSKUs,
        publish_failed_skus: publishFailedSKUs
      }
    };
    
    logger.info('Events processing completed', result.statistics);
    
    // Send observability data (best-effort)
    try {
      await observabilityClient.sendActivationResult(result);
    } catch (obsErr) {
      logger.warn('Failed to send activation result.', obsErr);
    }
    
    return result;
    
  } catch (error) {
    logger.error('Events handler error:', error);
    
    const errorResult = {
      status: 'error',
      error: error.message,
      stack: error.stack
    };
    
    // Send error observability data (best-effort)
    try {
      await observabilityClient.sendActivationResult(errorResult);
    } catch (obsErr) {
      logger.warn('Failed to send error activation result.', obsErr);
    }
    
    return errorResult;
  }
}

exports.main = main;