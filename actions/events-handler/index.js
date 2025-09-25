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
 * @returns {Array} Array of events
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
 * Processes a single SKU - generates HTML and publishes
 * @param {string} sku - Product SKU
 * @param {Object} context - Processing context
 * @param {Object} filesLib - Files library instance
 * @returns {Object} Processing result
 */
async function processSKU(sku, context, filesLib) {
  const { logger } = context;
  const startTime = Date.now();
  
  try {
    logger.info(`Processing SKU: ${sku}`);
    
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
    
    // Publish product
    const config = getRuntimeConfig(context, { validateToken: true });
    const adminApi = new AdminAPI({
      adminToken: config.AEM_ADMIN_API_AUTH_TOKEN,
      contentUrl: config.CONTENT_URL,
      logger: logger
    });
    
    const publishResult = await adminApi.publish([htmlPath]);
    
    if (publishResult && publishResult.success) {
      logger.info(`Product published: ${sku} -> ${htmlPath}`);
      return {
        success: true,
        sku: sku,
        htmlPath: htmlPath,
        publishResult: publishResult,
        processingTime: Date.now() - startTime
      };
    } else {
      throw new Error(publishResult?.error || 'Publishing failed with unknown error');
    }
    
  } catch (error) {
    logger.error(`Error processing SKU ${sku}:`, error.message);
    return {
      success: false,
      error: error.message,
      sku: sku,
      processingTime: Date.now() - startTime
    };
  }
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
  
  try {
    logger.info('Starting Adobe I/O Events Handler');
    
    // Initialize Adobe I/O SDK components
    const stateLib = await State.init(params.libInit || {});
    const filesLib = await Files.init(params.libInit || {});
    const stateManager = new StateManager(stateLib, { logger });
    
    // Use access token from environment variables or params
    const token = params.ACCESS_TOKEN || process.env.ACCESS_TOKEN;
    
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
    
    // Process events in batches
    const journallingUrl = params.journalling_url || params.JOURNAL_URL;
    const eventParams = {
      ims_org_id: params.ims_org_id || params.IMS_ORG_ID,
      apiKey: params.apiKey || params.CLIENT_ID,
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
      
      // Process each SKU with rate limiting
      const config = getRuntimeConfig(params);
      const processingContext = {
        ...config,
        logger,
        aioLibs: { filesLib }
      };
      
      for (const sku of skus) {
        await rateLimiter(); // Apply rate limiting
        
        const result = await processSKU(sku, processingContext, filesLib);
        
        if (result.success) {
          processedSKUs++;
          logger.info(`Successfully processed SKU: ${sku} (${result.processingTime}ms)`);
        } else {
          failedSKUs++;
          logger.error(`Failed to process SKU: ${sku} - ${result.error}`);
        }
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
        failed_skus: failedSKUs
      }
    };
    
    logger.info('Events processing completed', result.statistics);
    return result;
    
  } catch (error) {
    logger.error('Events handler error:', error);
    return {
      status: 'error',
      error: error.message,
      stack: error.stack
    };
  }
}

exports.main = main;