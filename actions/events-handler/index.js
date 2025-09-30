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
  if (!params.ims_org_id || !params.apiKey || !token) {
    throw new Error(`Missing required parameters for Events SDK: imsOrgId=${!!params.ims_org_id}, apiKey=${!!params.apiKey}, token=${!!token}`);
  }
  
  
  const eventsClient = await Events.init(
    params.ims_org_id,  // organizationId
    params.apiKey,      // apiKey
    token               // accessToken
  );
  
  
  let options = { limit: 100 };
  if (since) {
    options.since = since;
  }
  
  
  try {
    const journalling = await eventsClient.getEventsFromJournal(params.journalling_url, options);
    const eventsCount = journalling.events?.length || 0;
    
    if (eventsCount > 0) {
    }
    
    return journalling.events || [];
  } catch (error) {
    // 500 error typically means "no more events" or "end of journal"
    if (error.message && error.message.includes('500 Internal Server Error')) {
      return []; // Return empty array - no events available
    }
    // Re-throw other errors
    throw error;
  }
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
 * Generate HTML for a single SKU
 * @param {string} sku - Product SKU
 * @param {Object} context - Processing context
 * @param {Object} filesLib - Files library instance
 * @param {string} locale - Locale for the product
 * @returns {Object} Processing result with HTML path
 */
async function generateSKUHtml(sku, context, filesLib, locale = null) {
  const { logger } = context;
  const startTime = Date.now();
  
  try {
    const localeInfo = locale ? ` (locale: ${locale})` : '';
    
    // Create context with locale
    const localeContext = { ...context };
    if (locale) localeContext.locale = locale;
    
    // Generate HTML using pdp-renderer and get product data
    const result = await generateProductHtml(sku, null, localeContext);
    
    if (!result || !result.html) {
      return {
        success: false,
        error: 'HTML generation failed - product not found or invalid',
        sku: sku,
        locale: locale,
        processingTime: Date.now() - startTime
      };
    }
    
    const { html, productData } = result;
    
    // Generate path using the same logic as check-product-changes
    // getProductUrl already returns the full path according to PRODUCT_PAGE_URL_FORMAT template
    const rawPath = getProductUrl(productData, localeContext, false);
    // Keep SKU in original case, make everything else lowercase
    const productPath = rawPath.toLowerCase().replace(`/${productData.sku.toLowerCase()}`, `/${productData.sku}`);
    const htmlPath = `/public/pdps${productPath}.${PDP_FILE_EXT}`;
    
    // Save HTML file
    if (filesLib) {
      await filesLib.write(htmlPath, html);
    }
    
    
    return {
      success: true,
      sku: sku,
      locale: locale,
      htmlPath: htmlPath,
      path: productPath, // path without /public/pdps prefix for publishing
      renderedAt: new Date(),
      processingTime: Date.now() - startTime
    };
    
  } catch (error) {
    logger.error(`Error generating HTML for SKU ${sku}:`, error.message);
    return {
      success: false,
      error: error.message,
      sku: sku,
      locale: locale,
      processingTime: Date.now() - startTime
    };
  }
}

/**
 * Unpublishes products that don't exist (failed to generate HTML)
 * @param {Array} failedResults - Array of failed SKU results
 * @param {Object} context - Processing context
 * @param {Object} filesLib - Files library instance
 * @returns {Object} Unpublish result
 */
async function unpublishNonExistentProducts(failedResults, context, filesLib) {
  const { logger } = context;
  
  if (!failedResults || failedResults.length === 0) {
    return { unpublished: 0, failed: 0 };
  }
  
  
  const config = context;
  
  if (!config.adminAuthToken) {
    logger.warn(`No AEM_ADMIN_API_AUTH_TOKEN - skipping unpublish`);
    return { unpublished: 0, failed: failedResults.length, skipped: failedResults.length };
  }
  
  try {
    const adminApi = new AdminAPI({
      org: config.org,
      site: config.site
    }, context, {
      authToken: config.adminAuthToken
    });
    
    // Prepare records for unpublishing (similar to check-product-changes)
    const records = failedResults.map(({ sku, locale }) => {
      // For unpublishing, we don't have urlKey, so we'll use a fallback path
      // This should match the pattern used when the product was originally published
      const localeContext = { ...context };
      if (locale) localeContext.locale = locale;
      
      // Try to generate path with just SKU (fallback for non-existent products)
      // getProductUrl returns the full path according to PRODUCT_PAGE_URL_FORMAT template
      const rawPath = getProductUrl({ sku }, localeContext, false);
      // Keep SKU in original case, make everything else lowercase
      const productPath = rawPath.toLowerCase().replace(`/${sku.toLowerCase()}`, `/${sku}`);
      return {
        sku,
        path: productPath,
        locale: locale || 'default'
      };
    });
    
    
    // Direct AEM Admin API calls for unpublish - simple and reliable
    const paths = records.map(record => record.path);
    let unpublishedCount = 0;
    let failedCount = 0;
    
    try {
      // Step 1: Unpublish from live
      const unpublishBody = {
        paths: paths,
        delete: true
      };
      
      const unpublishResponse = await adminApi.execAdminRequest('POST', 'live', '/*', unpublishBody);
      
      if (unpublishResponse?.job) {
        
        // Wait for unpublish job to complete
        const unpublishedPaths = await adminApi.checkJobStatus(unpublishResponse.job);
        
        // Step 2: Unpublish from preview
        const unpublishPreviewResponse = await adminApi.execAdminRequest('POST', 'preview', '/*', unpublishBody);
        
        if (unpublishPreviewResponse?.job) {
          
          // Wait for unpublish preview job to complete
          const unpublishedPreviewPaths = await adminApi.checkJobStatus(unpublishPreviewResponse.job);
          
          // Count successful unpublishes - if both live and preview succeeded
          const successfulPaths = unpublishedPaths.filter(path => unpublishedPreviewPaths.includes(path));
          unpublishedCount = successfulPaths.length;
          failedCount = records.length - unpublishedCount;
          
          // Delete HTML files for successfully unpublished products
          for (const record of records) {
            if (successfulPaths.includes(record.path)) {
              try {
                const htmlPath = `/public/pdps${record.path}.${PDP_FILE_EXT}`;
                await filesLib.delete(htmlPath);
              } catch (e) {
                logger.warn(`Error deleting HTML file for product ${record.sku}:`, e);
              }
            }
          }
          
        } else {
          logger.error(`Unpublish preview API call failed`);
          failedCount = records.length;
        }
      } else {
        logger.error(`Unpublish live API call failed`);
        failedCount = records.length;
      }
    } catch (error) {
      logger.error(`Direct unpublish API calls failed: ${error.message}`);
      console.error('Direct unpublish error:', error);
      failedCount = records.length;
    }
    
    
    return {
      unpublished: unpublishedCount,
      failed: failedCount
    };
    
  } catch (error) {
    logger.error('Error unpublishing non-existent products:', error.message);
    return {
      unpublished: 0,
      failed: failedResults.length,
      error: error.message
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
 * @param {Array} locales - Array of locales to process
 * @returns {Object} Batch processing result
 */
async function processBatch(skuBatch, context, filesLib, rateLimiter, batchNumber, locales, adminApi) {
  const { logger } = context;
  const batchStart = Date.now();
  
  
  try {
    // Step 1: Process each locale in parallel
    const localeResults = await Promise.all(locales.map(async (locale) => {
      
      const htmlResults = [];
      
      for (const sku of skuBatch) {
        await rateLimiter(); // Rate limit GraphQL requests
        const htmlResult = await generateSKUHtml(sku, context, filesLib, locale);
        htmlResults.push(htmlResult);
      }
      
      return {
        locale: locale,
        htmlResults: htmlResults
      };
    }));
    
    // Flatten all HTML results from all locales
    const allHtmlResults = localeResults.flatMap(result => result.htmlResults);
    
    // Step 2: Filter successful HTML generations across all locales
    const successfulResults = allHtmlResults.filter(result => result.success);
    const failedResults = allHtmlResults.filter(result => !result.success);
    
    // Step 2.1: Unpublish non-existent products (failed results)
    let unpublishResult = { unpublished: 0, failed: 0 };
    if (failedResults.length > 0) {
      unpublishResult = await unpublishNonExistentProducts(failedResults, context, filesLib);
    }
    
    if (successfulResults.length === 0) {
      return {
        success: false,
        batchNumber,
        error: 'No successful HTML generations in batch',
        failed: failedResults.length,
        unpublished: unpublishResult.unpublished,
        unpublish_failed: unpublishResult.failed,
        processingTime: Date.now() - batchStart
      };
    }
    
    // Step 3: Publish all successful results in one batch
    const config = context; // Context already contains the runtime config
    
    if (!config.adminAuthToken) {
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
    
    // AdminAPI is now passed as parameter
    
    // Prepare records for batch publishing (like check-product-changes)
    const records = successfulResults.map(({ sku, path, renderedAt, locale }) => ({
      sku,
      path,
      renderedAt,
      locale // Include locale for publishing
    }));
    
    
    // Skip publishing if no records, like check-product-changes
    if (records.length === 0) {
      return Promise.resolve({
        success: true,
        batchNumber,
        processed: successfulResults.length,
        failed: failedResults.length,
        published: 0,
        publishFailed: 0,
        unpublished: unpublishResult.unpublished,
        unpublishFailed: unpublishResult.failed,
        processingTime: Date.now() - batchStart
      });
    }
    
    // Use the first locale from records, or null if no locale specified (like check-product-changes)
    const batchLocale = records.length > 0 && records[0].locale ? records[0].locale : null;
    
    // Direct AEM Admin API calls - simple and reliable
    
    const paths = records.map(record => record.path);
    let publishedCount = 0;
    let failedPublishCount = 0;
    
    
    try {
      // Step 1: Preview
      const previewBody = {
        forceUpdate: true,
        paths: paths,
        delete: false
      };
      
      const previewResponse = await adminApi.execAdminRequest('POST', 'preview', '/*', previewBody);
      
      if (previewResponse?.job) {
        
        // Wait for preview job to complete
        const successPaths = await adminApi.checkJobStatus(previewResponse.job);
        
        // Check if preview was successful (even if no changes were needed)
        if (successPaths.length > 0) {
          // Step 2: Publish only paths that were actually previewed
          const publishBody = {
            forceUpdate: true,
            paths: successPaths,
            delete: false
          };
          
          const publishResponse = await adminApi.execAdminRequest('POST', 'live', '/*', publishBody);
          
          if (publishResponse?.job) {
            
            // Wait for publish job to complete
            const publishedPaths = await adminApi.checkJobStatus(publishResponse.job);
            
            publishedCount = publishedPaths.length;
            failedPublishCount = records.length - publishedCount;
            
          } else {
            logger.error(`Publish API call failed for batch ${batchNumber}`);
            failedPublishCount = records.length;
          }
        } else {
          // Preview completed but no changes were needed - this is actually success!
          publishedCount = records.length; // Consider this as successful - content is already published
          failedPublishCount = 0;
        }
      } else {
        logger.error(`Preview API call failed for batch ${batchNumber}`);
        failedPublishCount = records.length;
      }
      
      
      return {
        success: true,
        batchNumber,
        processed: records.length,
        failed: 0,
        published: publishedCount,
        publishFailed: failedPublishCount,
        unpublished: 0,
        unpublishFailed: 0,
        processingTime: Date.now() - batchStart
      };
      
    } catch (error) {
      logger.error(`Batch ${batchNumber} direct API calls failed: ${error.message}`);
      console.error('Direct API error:', error);
      
      return {
        success: false,
        batchNumber,
        processed: 0,
        failed: records.length,
        published: 0,
        publishFailed: records.length,
        unpublished: 0,
        unpublishFailed: 0,
        error: error.message,
        processingTime: Date.now() - batchStart
      };
    }
    
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
  
  logger.info('Starting Adobe I/O Events Handler');
  
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
    
    
    // Configuration
    const dbEventKey = params.db_event_key || 'events_position';
    const maxEventsInBatch = parseInt(params.max_events_in_batch || '5', 10);
    const rateLimiter = createRateLimiter(10); // 10 requests per second
    
    // Normalize locales: accept array or "en,fr" string; default to [null]
    const rawLocales = params.locales;
    let locales;
    
    if (Array.isArray(rawLocales) && rawLocales.length > 0) {
      locales = rawLocales;
    } else if (typeof rawLocales === 'string' && rawLocales.trim()) {
      const parsed = rawLocales.split(',').map(s => s.trim()).filter(Boolean);
      locales = parsed.length > 0 ? parsed : [null];
    } else {
      // Default case: no locales specified or empty
      locales = [null];
    }
    
    
    // Get the latest event position
    const latestEventPos = await getLatestEventPosition(stateManager, dbEventKey);
    
    if (latestEventPos) {
    } else {
    }
    
    // Processing statistics
    let fetchCount = 0;
    let totalEventsNum = 0;
    let processedSKUs = 0;
    let failedSKUs = 0;
    let publishedSKUs = 0;
    let publishFailedSKUs = 0;
    let unpublishedSKUs = 0;
    let unpublishFailedSKUs = 0;
    
    // Process events in batches
    const journallingUrl = params.journalling_url || params.JOURNAL_URL;
    const eventParams = {
      ims_org_id: params.ims_org_id || params.IMS_ORG_ID,
      apiKey: params.CLIENT_ID,
      journalling_url: journallingUrl
    };
    
    let events = await fetchEvents(eventParams, token, latestEventPos);
    
    if (events && events.length > 0) {
      
      // Save events to state
      await saveEventsToState(stateManager, dbEventKey, events);
      
      // Extract unique SKUs from events
      const skus = extractUniqueSKUs(events);
      
      // Process SKUs in batches like check-product-changes
      if (skus.length > 0) {
        const config = getRuntimeConfig(params);
        const processingContext = {
          ...config,
          logger,
          aioLibs: { filesLib }
        };
        
        // Create AdminAPI instance like check-product-changes
        const adminApi = new AdminAPI({
          org: config.org,
          site: config.site
        }, processingContext, {
          authToken: config.adminAuthToken
        });

        let batchResults = [];
        try {
          // Create batches of SKUs
          const skuBatches = createBatches(skus);
          
          // Process batches with Promise chains like check-product-changes
          
          const pendingBatches = skuBatches.map((skuBatch, batchIndex) => {
            const batchNumber = batchIndex + 1;
            return processBatch(skuBatch, processingContext, filesLib, rateLimiter, batchNumber, locales, adminApi);
          });
          
          batchResults = await Promise.all(pendingBatches);
          
          // Process results
          batchResults.forEach((batchResult, index) => {
            const batchNumber = index + 1;
            if (batchResult.success) {
              processedSKUs += batchResult.processed || 0;
              failedSKUs += batchResult.failed || 0;
              publishedSKUs += batchResult.published || 0;
              publishFailedSKUs += batchResult.publishFailed || 0;
              unpublishedSKUs += batchResult.unpublished || 0;
              unpublishFailedSKUs += batchResult.unpublishFailed || 0;
            } else {
              failedSKUs += batchResult.failed || skuBatches[index].length;
              unpublishedSKUs += batchResult.unpublished || 0;
              unpublishFailedSKUs += batchResult.unpublish_failed || 0;
              logger.error(`Batch ${batchNumber} failed: ${batchResult.error}`);
            }
          });
        } catch (error) {
          logger.error(`Error during batch processing: ${error.message}`);
          console.error('Batch processing error:', error);
        }
        
        // Log batch summary
        const successfulBatches = batchResults.filter(r => r.success).length;
        const failedBatches = batchResults.filter(r => !r.success).length;
      }
      
      totalEventsNum += events.length;
      fetchCount++;
      
      
    }
    
    const result = {
      status: 'completed',
      statistics: {
        events_fetched: totalEventsNum,
        fetch_batches: fetchCount,
        processed_skus: processedSKUs,
        failed_skus: failedSKUs,
        published_skus: publishedSKUs,
        publish_failed_skus: publishFailedSKUs,
        unpublished_skus: unpublishedSKUs,
        unpublish_failed_skus: unpublishFailedSKUs
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