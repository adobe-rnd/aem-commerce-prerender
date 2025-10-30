/*
 * Adobe I/O Events Handler - Simplified Version
 * 
 * This action consumes events from Adobe I/O Events Journaling API,
 * extracts unique SKUs, generates HTML and publishes to AEM.
 */

const { Core, Events, State, Files } = require('@adobe/aio-sdk');
const { StateManager } = require('../lib/state');
const { getRuntimeConfig } = require('../lib/runtimeConfig');
const { generateProductHtml } = require('../pdp-renderer/render');
const { AdminAPI } = require('../lib/aem');
const { getProductUrl, PDP_FILE_EXT } = require('../utils');

/**
 * Extracts unique SKUs from events
 * @param {Array} events - Array of events
 * @returns {Array} Array of unique SKUs
 */
function extractUniqueSKUs(events) {
  const skus = new Set();
  
  for (const event of events) {
    const sku = event.event?.data?.sku;
    if (sku) {
      skus.add(sku);
    }
  }
  
  return Array.from(skus);
}

/**
 * Fetches events from Adobe I/O Events Journal
 * @param {Object} eventsClient - Events SDK client
 * @param {string} journallingUrl - Journalling URL
 * @param {string} since - Position to start from
 * @returns {Promise<Object>} Object with events and last position
 */
async function fetchEvents(eventsClient, journallingUrl, since) {
  const options = { limit: 50 };
  
  if (since && since !== 'END' && since !== 'BEGINNING') {
    options.since = since;
  }
  
  try {
    const journalling = await eventsClient.getEventsFromJournal(journallingUrl, options);
    const events = journalling.events || [];
    const lastPosition = events.length > 0 ? events[events.length - 1].position : since;
    
    return { events, lastPosition };
  } catch (error) {
    // 500/404/400 typically means "no more events"
    if (error.message && (
      error.message.includes('500') || 
      error.message.includes('404') || 
      error.message.includes('400')
    )) {
      return { events: [], lastPosition: since };
    }
    throw error;
  }
}

/**
 * Generate HTML for a single SKU
 * @param {string} sku - Product SKU
 * @param {Object} context - Processing context
 * @param {Object} filesLib - Files library instance
 * @returns {Object} Processing result
 */
async function generateSKUHtml(sku, context, filesLib) {
  const { logger } = context;
  
  try {
    // Generate HTML using pdp-renderer
    const result = await generateProductHtml(sku, null, context);
    
    if (!result || !result.html) {
      return {
        success: false,
        sku: sku,
        error: 'HTML generation failed'
      };
    }
    
    const { html, productData } = result;
    
    // Generate path
    const rawPath = getProductUrl(productData, context, false);
    const productPath = rawPath.toLowerCase();
    const htmlPath = `/public/pdps${productPath}.${PDP_FILE_EXT}`;
    
    // Save HTML file
    if (filesLib) {
      await filesLib.write(htmlPath, html);
    }
    
    return {
      success: true,
      sku: sku,
      path: productPath,
      htmlPath: htmlPath
    };
    
  } catch (error) {
    logger.error(`Error generating HTML for SKU ${sku}: ${error.message}`);
    return {
      success: false,
      sku: sku,
      error: error.message
    };
  }
}

/**
 * Main action function
 * @param {Object} params - Action parameters
 * @returns {Object} Action result
 */
async function main(params) {
  const logger = Core.Logger('events-handler', { level: params.LOG_LEVEL || 'info' });
  
  logger.info('Starting Adobe I/O Events Handler (Simplified)');
  
  try {
    // Initialize runtime config
    const cfg = getRuntimeConfig(params);
    
    // Initialize Adobe I/O SDK components
    const stateLib = await State.init(params.libInit || {});
    const filesLib = await Files.init(params.libInit || {});
    const stateManager = new StateManager(stateLib, { logger });
    
    // Get access token from params
    const accessToken = params.ACCESS_TOKEN || params.access_token;
    if (!accessToken) {
      throw new Error('ACCESS_TOKEN is required');
    }
    
    // Initialize Events client
    const eventsClient = await Events.init(
      params.IMS_ORG_ID || params.ims_org_id,
      params.CLIENT_ID || params.apiKey,
      accessToken
    );
    
    const journallingUrl = params.JOURNALLING_URL || params.journalling_url;
    if (!journallingUrl) {
      throw new Error('JOURNALLING_URL is required');
    }
    
    // Get last position from state
    const dbEventKey = params.db_event_key || 'events_position';
    const lastPosition = await stateManager.get(dbEventKey);
    
    logger.info(`Fetching events from position: ${lastPosition || 'start'}`);
    
    // Fetch events (up to 50)
    const { events, lastPosition: newPosition } = await fetchEvents(
      eventsClient,
      journallingUrl,
      lastPosition
    );
    
    logger.info(`Fetched ${events.length} events`);
    
    if (events.length === 0) {
      return {
        status: 'completed',
        message: 'No new events to process',
        statistics: {
          events_fetched: 0,
          unique_skus: 0,
          processed: 0,
          published: 0
        }
      };
    }
    
    // Extract unique SKUs
    const skus = extractUniqueSKUs(events);
    logger.info(`Extracted ${skus.length} unique SKUs: ${skus.join(', ')}`);
    
    if (skus.length === 0) {
      // Save position even if no SKUs
      await stateManager.put(dbEventKey, newPosition);
      return {
        status: 'completed',
        message: 'No SKUs found in events',
        statistics: {
          events_fetched: events.length,
          unique_skus: 0,
          processed: 0,
          published: 0
        }
      };
    }
    
    // Create processing context
    const processingContext = {
      ...cfg,
      logger,
      aioLibs: { filesLib }
    };
    
    // Generate HTML for all SKUs
    logger.info('Generating HTML for SKUs...');
    const htmlResults = [];
    
    for (const sku of skus) {
      const htmlResult = await generateSKUHtml(sku, processingContext, filesLib);
      htmlResults.push(htmlResult);
    }
    
    // Filter successful results
    const successfulResults = htmlResults.filter(r => r.success);
    const failedResults = htmlResults.filter(r => !r.success);
    
    logger.info(`HTML generation: ${successfulResults.length} succeeded, ${failedResults.length} failed`);
    
    // Publish using AdminAPI
    let publishedCount = 0;
    
    if (successfulResults.length > 0 && cfg.adminAuthToken) {
      logger.info('Publishing to AEM...');
      
      // Initialize AdminAPI
      const adminApi = new AdminAPI(
        { org: cfg.org, site: cfg.site },
        processingContext,
        { authToken: cfg.adminAuthToken }
      );
      
      // Prepare records for publishing
      const records = successfulResults.map(r => ({
        sku: r.sku,
        path: r.path
      }));
      
      // Start processing queues
      await adminApi.startProcessing();
      
      // Add to preview and publish queue
      await adminApi.previewAndPublish(records, null, 1);
      
      // Stop and wait for completion
      await adminApi.stopProcessing();
      
      // Count published records
      publishedCount = records.filter(r => r.publishedAt).length;
      
      logger.info(`Published ${publishedCount} products`);
    } else {
      logger.warn('Skipping publish: no successful results or no auth token');
    }
    
    // Save new position to state
    await stateManager.put(dbEventKey, newPosition);
    logger.info(`Saved new position: ${newPosition}`);
    
    const result = {
      status: 'completed',
      statistics: {
        events_fetched: events.length,
        unique_skus: skus.length,
        processed: successfulResults.length,
        failed: failedResults.length,
        published: publishedCount
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

