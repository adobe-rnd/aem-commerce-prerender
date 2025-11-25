/*
 * Adobe I/O Events Handler - Simplified Version
 * 
 * This action consumes events from Adobe I/O Events Journaling API,
 * extracts unique SKUs, generates HTML and publishes to AEM.
 */

const { Core, Events, State, Files } = require('@adobe/aio-sdk');
const { StateManager } = require('../lib/state');
const { TokenManager } = require('./token-manager');
const { getRuntimeConfig } = require('../lib/runtimeConfig');
const { generateProductHtml } = require('../pdp-renderer/render');
const { AdminAPI } = require('../lib/aem');
const { getProductUrl, PDP_FILE_EXT, FILE_PREFIX, STATE_FILE_EXT } = require('../utils');
const crypto = require('crypto');

/**
 * Gets file location for state storage
 */
function getFileLocation(stateKey, extension) {
  return `${FILE_PREFIX}/${stateKey}.${extension}`;
}

/**
 * Loads SKU state (hash + timestamp + path) from filesLib
 * @param {string} locale - The locale
 * @param {Object} filesLib - Files library instance
 * @returns {Promise<Object>} State object with skus
 */
async function loadSkuState(locale, filesLib, logger) {
  const stateObj = { locale, skus: {} };
  try {
    const stateKey = locale || 'default';
    const fileLocation = getFileLocation(stateKey, STATE_FILE_EXT);
    const buffer = await filesLib.read(fileLocation);
    const stateData = buffer?.toString();
    if (stateData) {
      const lines = stateData.split('\n');
      stateObj.skus = lines.reduce((acc, line) => {
        // Format: <sku>,<timestamp>,<hash>,<path>
        const [sku, time, hash, path] = line.split(',');
        const timestamp = parseInt(time);
        // Only load entries with valid SKU and timestamp > 0
        if (sku && time && timestamp > 0) {
          acc[sku] = { 
            lastRenderedAt: new Date(timestamp), 
            hash: hash || null,
            path: path || null
          };
        }
        return acc;
      }, {});
      logger.debug(`Loaded state for ${Object.keys(stateObj.skus).length} SKUs (locale: ${locale || 'default'})`);
    }
  } catch (e) {
    logger.debug(`No previous state found for locale ${locale || 'default'}`);
  }
  return stateObj;
}

/**
 * Saves SKU state to filesLib
 * @param {Object} state - State object with skus
 * @param {Object} filesLib - Files library instance
 */
async function saveSkuState(state, filesLib, logger) {
  const { locale, skus } = state;
  const stateKey = locale || 'default';
  const fileLocation = getFileLocation(stateKey, STATE_FILE_EXT);
  const csvData = [
    ...Object.entries(skus)
      .filter(([, { lastRenderedAt }]) => {
        // Only save entries with valid timestamp (not null, undefined, or 0)
        return lastRenderedAt && lastRenderedAt.getTime() > 0;
      })
      .map(([sku, { lastRenderedAt, hash, path }]) => {
        return `${sku},${lastRenderedAt.getTime()},${hash || ''},${path || ''}`;
      }),
  ].join('\n');
  await filesLib.write(fileLocation, csvData);
  logger.debug(`Saved state for ${Object.keys(skus).length} SKUs (locale: ${locale || 'default'})`);
}

/**
 * Checks if a product should be previewed & published
 */
function shouldPreviewAndPublish({ currentHash, newHash }) {
  return newHash && currentHash !== newHash;
}

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
 * @param {number} limit - Maximum number of events to fetch (default: 50)
 * @returns {Promise<Object>} Object with events and last position
 */
async function fetchEvents(eventsClient, journallingUrl, since, limit = 50) {
  const options = { limit };
  
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
 * Generate HTML for a single SKU and compute hash
 * @param {string} sku - Product SKU
 * @param {Object} context - Processing context
 * @param {Object} filesLib - Files library instance
 * @param {string} currentHash - Current hash from state
 * @returns {Object} Processing result with hash
 */
async function generateSKUHtml(sku, context, filesLib, currentHash) {
  const { logger } = context;
  
  try {
    // Generate HTML using pdp-renderer
    logger.debug(`Generating HTML for SKU ${sku}...`);
    const result = await generateProductHtml(sku, null, context);
    
    if (!result || !result.html) {
      logger.error(`HTML generation failed for SKU ${sku}: no HTML returned`);
      return {
        success: false,
        sku: sku,
        error: 'HTML generation failed - no HTML returned'
      };
    }
    
    const { html, productData } = result;
    
    logger.debug(`HTML generated successfully for SKU ${sku}, length: ${html.length} bytes`);
    
    // Generate path using productData
    const rawPath = getProductUrl(productData, context, false);
    const productPath = rawPath.toLowerCase();
    const htmlPath = `/public/pdps${productPath}.${PDP_FILE_EXT}`;
    
    // Compute hash of HTML
    const newHash = crypto.createHash('sha256').update(html).digest('hex');
    const changed = shouldPreviewAndPublish({ currentHash, newHash });
    
    logger.debug(`Hash computed for SKU ${sku}: ${newHash.substring(0, 8)}... (changed: ${changed})`);
    
    // Save HTML file only if changed
    if (changed && filesLib) {
      try {
      await filesLib.write(htmlPath, html);
        logger.debug(`HTML saved successfully to ${htmlPath}`);
      } catch (error) {
        logger.warn(`Failed to save HTML to Files storage: ${error.message}`);
      }
    } else if (!changed) {
      logger.debug(`Skipping HTML save for SKU ${sku} - no changes detected`);
    }
    
    return {
      success: true,
      sku: sku,
      path: productPath,
      htmlPath: htmlPath,
      newHash: newHash,
      currentHash: currentHash,
      changed: changed,
      renderedAt: new Date()
    };
    
  } catch (error) {
    logger.error(`Error generating HTML for SKU ${sku}: ${error.message}`);
    
    // Check if product was not found (404)
    const isNotFound = error.statusCode === 404 || error.message.includes('Product not found');
    
    return {
      success: false,
      sku: sku,
      error: error.message,
      notFound: isNotFound
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
    
    // Normalize locales: accept array or "en,fr" string; default to [null]
    const rawLocales = params.locales;
    const locales = Array.isArray(rawLocales)
      ? rawLocales
      : (typeof rawLocales === 'string' && rawLocales.trim()
        ? rawLocales.split(',').map(s => s.trim()).filter(Boolean)
        : [null]);
    
    // Get max events limit from params (default: 50)
    const maxEventsInBatch = parseInt(params.max_events_in_batch) || 50;
    
    logger.info(`Processing for locales: ${locales.join(', ') || 'default'}`);
    logger.info(`Max events per batch: ${maxEventsInBatch}`);
    
    // Initialize Adobe I/O SDK components
    const stateLib = await State.init(params.libInit || {});
    const filesLib = await Files.init(params.libInit || {});
    const stateManager = new StateManager(stateLib, { logger });
    
    
    
    await stateManager.put('running', 'false');
    
    
    // Check if previous run is still running (prevent parallel executions)
    const running = await stateManager.get('running');
    if (running?.value === 'true' || running === 'true') {
      logger.warn('Previous run is still marked as running. Skipping this execution.');
      return {
        status: 'skipped',
        message: 'Previous run is still running'
      };
    }
    
    try {
      // Mark as running with TTL (1 hour) to avoid permanent lock on unexpected failures
      await stateManager.put('running', 'true', { ttl: 3600 });
      
      // Initialize token manager for automatic token refresh
      const tokenManager = new TokenManager(params, stateManager, logger);
      
      // Get access token (will be automatically refreshed if expired)
      const accessToken = await tokenManager.getAccessToken();
      
      logger.info('Access token obtained successfully');
      
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
    const storedPosition = await stateManager.get(dbEventKey);
    
    // Handle both string and object responses from State
    let lastPosition = null;
    if (storedPosition) {
      if (typeof storedPosition === 'string') {
        lastPosition = storedPosition;
      } else if (typeof storedPosition === 'object' && storedPosition.value) {
        lastPosition = storedPosition.value;
      } else if (typeof storedPosition === 'object') {
        // If it's an object without value property, try to stringify and use
        lastPosition = null; // Will start from beginning
      }
    }
    
    logger.info(`Fetching events from position: ${lastPosition || 'start'}`);
    
    // Fetch events
    const { events, lastPosition: newPosition } = await fetchEvents(
      eventsClient,
      journallingUrl,
      lastPosition,
      maxEventsInBatch
    );
    
    // let events = [
    //     {
    //         "position": "rabbit:4fa3a62b-dab4-4f40-9531-18bde21cacff.camel:33576bee-0f8b-4ca6-af7d-8e9ec00cffce.0044bbbd-8f4a-4c58-b1d6-dc64a46869e8.0.1763487532.172cm-iqvllu5ntio5mx",
    //         "event": {
    //             "specversion": "1.0",
    //             "id": "3b2f9749-b4d6-437b-9073-c93872ec0080",
    //             "source": "1f131648-b696-4bd1-af57-2021c7080b56",
    //             "type": "com.adobe.commerce.storefront.events.price.update",
    //             "datacontenttype": "application/json",
    //             "time": "2025-11-18T17:38:49.273Z",
    //             "eventid": "0044bbbd-8f4a-4c58-b1d6-dc64a46869e8",
    //             "event_id": "0044bbbd-8f4a-4c58-b1d6-dc64a46869e8",
    //             "recipient_client_id": "339224a1649b4533bdafcefc62e17b8c",
    //             "recipientclientid": "339224a1649b4533bdafcefc62e17b8c",
    //             "data": {
    //                 "sku": "test-aio-1120202       3",
    //                 "instanceId": "1f131648-b696-4bd1-af57-2021c7080b56",
    //                 "scope": [
    //                     {
    //                         "websiteCode": "base",
    //                         "customerGroupCode": "0"
    //                     }
    //                 ]
    //             }
    //         }
    //     },
    //     {
    //         "position": "rabbit:4fa3a62b-dab4-4f40-9531-18bde21cacff.camel:33576bee-0f8b-4ca6-af7d-8e9ec00cffce.0044bbbd-8f4a-4c58-b1d6-dc64a46869e9.0.1763487533.172cm-iqvllu5ntio5my",
    //         "event": {
    //             "specversion": "1.0",
    //             "id": "4c3f9749-b4d6-437b-9073-c93872ec0081",
    //             "source": "1f131648-b696-4bd1-af57-2021c7080b56",
    //             "type": "com.adobe.commerce.storefront.events.product.update",
    //             "datacontenttype": "application/json",
    //             "time": "2025-11-18T17:39:15.500Z",
    //             "eventid": "0044bbbd-8f4a-4c58-b1d6-dc64a46869e9",
    //             "event_id": "0044bbbd-8f4a-4c58-b1d6-dc64a46869e9",
    //             "recipient_client_id": "339224a1649b4533bdafcefc62e17b8c",
    //             "recipientclientid": "339224a1649b4533bdafcefc62e17b8c",
    //             "data": {
    //                 "sku": "test-aio-1107",
    //                 "instanceId": "1f131648-b696-4bd1-af57-2021c7080b56",
    //                 "scope": [
    //                     {
    //                         "websiteCode": "base",
    //                         "customerGroupCode": "0"
    //                     }
    //                 ]
    //             }
    //         }
    //     },
    //     {
    //         "position": "rabbit:4fa3a62b-dab4-4f40-9531-18bde21cacff.camel:33576bee-0f8b-4ca6-af7d-8e9ec00cffce.0044bbbd-8f4a-4c58-b1d6-dc64a46869ea.0.1763487534.172cm-iqvllu5ntio5mz",
    //         "event": {
    //             "specversion": "1.0",
    //             "id": "5d4f9749-b4d6-437b-9073-c93872ec0082",
    //             "source": "1f131648-b696-4bd1-af57-2021c7080b56",
    //             "type": "com.adobe.commerce.storefront.events.inventory.update",
    //             "datacontenttype": "application/json",
    //             "time": "2025-11-18T17:39:42.820Z",
    //             "eventid": "0044bbbd-8f4a-4c58-b1d6-dc64a46869ea",
    //             "event_id": "0044bbbd-8f4a-4c58-b1d6-dc64a46869ea",
    //             "recipient_client_id": "339224a1649b4533bdafcefc62e17b8c",
    //             "recipientclientid": "339224a1649b4533bdafcefc62e17b8c",
    //             "data": {
    //                 "sku": "test-aio-1106",
    //                 "instanceId": "1f131648-b696-4bd1-af57-2021c7080b56",
    //                 "scope": [
    //                     {
    //                         "websiteCode": "base",
    //                         "customerGroupCode": "0"
    //                     }
    //                 ]
    //             }
    //         }
    //     }
    // ];
    // let newPosition = 'rabbit:4fa3a62b-dab4-4f40-9531-18bde21cacff.camel:33576bee-0f8b-4ca6-af7d-8e9ec00cffce.0044bbbd-8f4a-4c58-b1d6-dc64a46869e8.0.1763487532.172cm-iqvllu5ntio5mx';
    // logger.info(`Fetched ${events.length} events`);
    
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
      
      // Initialize AdminAPI once for all locales
      const adminApi = cfg.adminAuthToken ? new AdminAPI(
        { org: cfg.org, site: cfg.site },
        { ...cfg, logger, aioLibs: { filesLib } },
        { authToken: cfg.adminAuthToken }
      ) : null;
      
      if (adminApi) {
        await adminApi.startProcessing();
        logger.debug('AdminAPI processing started');
      }
      
      // Process each locale in parallel
      const localeResults = await Promise.all(locales.map(async (locale) => {
        logger.info(`Processing locale: ${locale || 'default'}`);
        
        // Load SKU state for this locale
        const skuState = await loadSkuState(locale, filesLib, logger);
        
        // Create processing context with locale
        const processingContext = {
          ...cfg,
          logger,
          aioLibs: { filesLib }
        };
        
        if (locale) {
          processingContext.locale = locale;
        }
        
        // Generate HTML for all SKUs with hash checking
        logger.info(`[${locale || 'default'}] Generating HTML for ${skus.length} SKUs...`);
        const htmlResults = [];
        
        for (const sku of skus) {
          const currentHash = skuState.skus[sku]?.hash || null;
          const htmlResult = await generateSKUHtml(sku, processingContext, filesLib, currentHash);
          htmlResults.push(htmlResult);
        }
        
        // Filter successful results
        const successfulResults = htmlResults.filter(r => r.success);
        const failedResults = htmlResults.filter(r => !r.success);
        const notFoundResults = failedResults.filter(r => r.notFound);
        
        // Filter changed results (only publish if hash changed)
        const changedResults = successfulResults.filter(r => r.changed);
        const unchangedResults = successfulResults.filter(r => !r.changed);
        
        logger.info(`[${locale || 'default'}] HTML generation: ${successfulResults.length} succeeded (${changedResults.length} changed, ${unchangedResults.length} unchanged), ${failedResults.length} failed (${notFoundResults.length} not found)`);
        
        // Update state for unchanged products (keep them in state with updated timestamp)
        for (const result of unchangedResults) {
          skuState.skus[result.sku] = {
            lastRenderedAt: result.renderedAt,
            hash: result.newHash,
            path: result.path
          };
        }
        
        // Publish using AdminAPI (only changed products)
        let previewedCount = 0;
        let publishedCount = 0;
        let failedCount = 0;
        
        if (changedResults.length > 0 && adminApi) {
          logger.info(`[${locale || 'default'}] Publishing ${changedResults.length} changed products to AEM...`);
          
          // Prepare records for publishing
          const records = changedResults.map(r => ({
            sku: r.sku,
            path: r.path,
            renderedAt: r.renderedAt
          }));
          
          logger.info(`[${locale || 'default'}] Prepared ${records.length} records for publishing`);
          records.forEach(r => logger.debug(`  - SKU: ${r.sku}, path: ${r.path}`));
          
          // Add to preview and publish queue
          logger.debug(`[${locale || 'default'}] Calling previewAndPublish...`);
          await adminApi.previewAndPublish(records, locale, 1);
          logger.debug(`[${locale || 'default'}] previewAndPublish completed`);
          
          // Count results and update state for published products
          for (const record of records) {
            if (record.previewedAt) previewedCount++;
            if (record.publishedAt) publishedCount++;
            if (record.failed) {
              failedCount++;
            } else if (record.previewedAt && record.publishedAt) {
              // Update state only for successfully published products
              const result = changedResults.find(r => r.sku === record.sku);
              if (result) {
                skuState.skus[record.sku] = {
                  lastRenderedAt: record.renderedAt,
                  hash: result.newHash,
                  path: result.path
                };
              }
            }
          }
          
          logger.info(`[${locale || 'default'}] Results: previewed=${previewedCount}, published=${publishedCount}, failed=${failedCount}`);
          
          if (failedCount > 0) {
            logger.warn(`[${locale || 'default'}] Failed records:`);
            records.filter(r => r.failed).forEach(r => {
              logger.warn(`  - SKU: ${r.sku}, path: ${r.path}, error: ${r.error || 'unknown'}`);
            });
          }
        } else if (!adminApi) {
          logger.warn(`[${locale || 'default'}] Skipping publish: no auth token`);
        } else if (changedResults.length === 0) {
          logger.info(`[${locale || 'default'}] No changed products to publish`);
        }
        
        // Unpublish products that were not found (deleted from catalog)
        let unpublishedCount = 0;
        
        if (notFoundResults.length > 0 && adminApi) {
          logger.info(`[${locale || 'default'}] Unpublishing ${notFoundResults.length} not found products...`);
          
          // Prepare records for unpublishing - use path from state (only unpublish previously published products)
          const unpublishRecords = notFoundResults
            .filter(r => {
              const hasPath = skuState.skus[r.sku]?.path;
              if (!hasPath) {
                logger.debug(`[${locale || 'default'}] Skipping unpublish for ${r.sku} - no path in state (was never published)`);
              }
              return hasPath;
            })
            .map(r => {
              const productPath = skuState.skus[r.sku].path;
              return {
                sku: r.sku,
                path: productPath
              };
            });
          
          if (unpublishRecords.length === 0) {
            logger.info(`[${locale || 'default'}] No products to unpublish (none were previously published)`);
            } else {
            logger.info(`[${locale || 'default'}] Prepared ${unpublishRecords.length} records for unpublishing`);
            unpublishRecords.forEach(r => logger.debug(`  - SKU: ${r.sku}, path: ${r.path}`));
            
            // Unpublish from live and preview
            logger.debug(`[${locale || 'default'}] Calling unpublishAndDelete...`);
            await adminApi.unpublishAndDelete(unpublishRecords, locale, 1);
            logger.debug(`[${locale || 'default'}] unpublishAndDelete completed`);
            
            // Delete HTML files and remove from state for unpublished products
            // Check only liveUnpublishedAt since preview unpublish happens after and may not complete in time
            for (const record of unpublishRecords) {
              if (record.liveUnpublishedAt) {
                try {
                  const htmlPath = `/public/pdps${record.path}.${PDP_FILE_EXT}`;
                  await filesLib.delete(htmlPath);
                  logger.debug(`[${locale || 'default'}] Deleted HTML file: ${htmlPath}`);
                } catch (error) {
                  logger.warn(`[${locale || 'default'}] Failed to delete HTML file for ${record.sku}: ${error.message}`);
                }
                
                // Remove from state (whether file delete succeeded or not)
                delete skuState.skus[record.sku];
                unpublishedCount++;
                
                logger.debug(`[${locale || 'default'}] Removed ${record.sku} from state (unpublished from live)`);
              } else {
                logger.warn(`[${locale || 'default'}] Product ${record.sku} was not unpublished from live, keeping in state`);
              }
            }
            
            logger.info(`[${locale || 'default'}] Unpublished and deleted ${unpublishedCount} products`);
          }
        } else if (notFoundResults.length > 0) {
          logger.warn(`[${locale || 'default'}] Found ${notFoundResults.length} deleted products but no AdminAPI to unpublish them`);
        }
        
        // Save updated state
        try {
          await saveSkuState(skuState, filesLib, logger);
        } catch (error) {
          logger.warn(`[${locale || 'default'}] Failed to save state: ${error.message}`);
        }
        
        return {
          locale,
          processed: successfulResults.length,
          changed: changedResults.length,
          unchanged: unchangedResults.length,
          failed: failedResults.length,
          previewed: previewedCount,
          published: publishedCount,
          unpublished: unpublishedCount
        };
      }));
      
      // Stop AdminAPI processing
      if (adminApi) {
        logger.debug('Stopping AdminAPI processing...');
        await adminApi.stopProcessing();
        logger.debug('AdminAPI processing stopped');
      }
      
      // Aggregate results from all locales
      const totalProcessed = localeResults.reduce((sum, r) => sum + r.processed, 0);
      const totalChanged = localeResults.reduce((sum, r) => sum + (r.changed || 0), 0);
      const totalUnchanged = localeResults.reduce((sum, r) => sum + (r.unchanged || 0), 0);
      const totalFailed = localeResults.reduce((sum, r) => sum + r.failed, 0);
      const publishedCount = localeResults.reduce((sum, r) => sum + r.published, 0);
      const unpublishedCount = localeResults.reduce((sum, r) => sum + (r.unpublished || 0), 0);
      
      // Save new position to state
      await stateManager.put(dbEventKey, newPosition);
      logger.info(`Saved new position: ${newPosition}`);
    
    const result = {
      status: 'completed',
      statistics: {
          events_fetched: events.length,
          unique_skus: skus.length,
          locales: locales.length,
          processed: totalProcessed,
          changed: totalChanged,
          unchanged: totalUnchanged,
          failed: totalFailed,
          published: publishedCount,
          unpublished: unpublishedCount,
          by_locale: localeResults
      }
    };
    
    logger.info('Events processing completed', result.statistics);
    
      return result;
      
    } finally {
      // Always reset running flag
      try {
        await stateManager.put('running', 'false');
        logger.debug('Reset running flag');
      } catch (stateErr) {
        logger.error('Failed to reset running state:', stateErr);
      }
    }
    
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

