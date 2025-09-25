/**
 * Adobe Commerce Events Handler - Main Entry Point
 * 
 * Processes Adobe Commerce events from Adobe I/O Events Journal.
 * Runs as a scheduled action (cron) to pull events, generate HTML markup,
 * and publish products.
 * 
 * Features:
 * - Pull-based event consumption from Adobe I/O Events Journal
 * - Automatic access token management
 * - Rate-limited processing (10 req/sec)
 * - Cursor-based position tracking
 * - Batch processing with error handling
 * - Comprehensive logging and statistics
 * 
 * Scheduled to run every 5 minutes via Adobe I/O Runtime triggers.
 */

const { Core, State, Files } = require('@adobe/aio-sdk');
const { StateManager } = require('../lib/state');
const { TokenManager } = require('./token-manager');
const { JournalReader } = require('./journal-reader');
const { RateLimiterManager } = require('./rate-limiter');
const { EventProcessor } = require('./event-processor');

/**
 * Main entry point for Adobe I/O Runtime action
 * @param {Object} params - Action parameters from Adobe I/O Runtime
 * @returns {Object} Action result
 */
async function main(params) {
  const executionStart = Date.now();
  console.log('Events Handler started');
  console.log('========================');
  
  // Initialize result object
  const result = {
    success: false,
    timestamp: new Date().toISOString(),
    executionTime: 0,
    eventsRead: 0,
    eventsProcessed: 0,
    errors: [],
    stats: {}
  };

  try {
    // Step 1: Initialize Adobe I/O SDK and components
    console.log('Initializing components...');
    
    const logger = Core.Logger('events-handler', { level: params.LOG_LEVEL || 'info' });
    const stateLib = await State.init(params.libInit || {});
    const filesLib = await Files.init(params.libInit || {});
    const stateManager = new StateManager(stateLib, { logger });
    
    const tokenManager = new TokenManager(params, stateManager, logger);
    const journalReader = new JournalReader(params, stateManager, logger);
    const rateLimiterManager = new RateLimiterManager();
    const eventProcessor = new EventProcessor(params, filesLib);
    
    // Set up dependencies
    journalReader.setTokenManager(tokenManager);
    eventProcessor.setRateLimiterManager(rateLimiterManager);
    eventProcessor.setFilesLib(filesLib);
    
    console.log('Components initialized');
    
    // Step 2: Verify token access
    console.log('Verifying access token...');
    const tokenInfo = await tokenManager.getTokenInfo();
    console.log(`Token status: ${tokenInfo.status}`);
    
    if (tokenInfo.status === 'expired') {
      console.log('Refreshing expired token...');
      await tokenManager.refreshToken();
    }
    
    // Step 3: Read events from journal
    console.log('Reading events from journal...');
    const batchResult = await journalReader.processBatch({
      limit: 100 // Read up to 100 events per execution
    });
    
    if (!batchResult.success) {
      throw new Error(`Failed to read events: ${batchResult.error}`);
    }
    
    result.eventsRead = batchResult.totalRead;
    console.log(`Read ${batchResult.totalRead} events from journal`);
    
    // If no events, we're done
    if (batchResult.totalRead === 0) {
      console.log('No new events to process');
      result.success = true;
      result.message = 'No new events found';
      result.executionTime = Date.now() - executionStart;
      return result;
    }
    
    // Step 4: Process events
    console.log('Processing events...');
    const processingResult = await eventProcessor.processBatch(batchResult.events, {
      maxConcurrency: 1 // Process sequentially to respect rate limits
    });
    
    result.eventsProcessed = processingResult.processedEvents;
    result.errors = processingResult.errors;
    
    if (processingResult.failedEvents > 0) {
      console.warn(`Warning: ${processingResult.failedEvents} events failed to process`);
    }
    
    // Step 5: Collect statistics
    result.stats = {
      journal: await journalReader.getStatus(),
      processor: eventProcessor.getStats(),
      rateLimiter: rateLimiterManager.getStatus(),
      token: tokenInfo
    };
    
    // Determine overall success
    result.success = batchResult.success && (processingResult.failedEvents === 0);
    result.executionTime = Date.now() - executionStart;
    
    // Log summary
    console.log('Execution Summary:');
    console.log(`   Events read: ${result.eventsRead}`);
    console.log(`   Events processed: ${result.eventsProcessed}`);
    console.log(`   Events failed: ${processingResult.failedEvents}`);
    console.log(`   Execution time: ${result.executionTime}ms`);
    console.log(`   Success rate: ${eventProcessor.getStats().successRate}%`);
    
    if (result.success) {
      console.log('Events Handler completed successfully');
    } else {
      console.log('Warning: Events Handler completed with errors');
    }
    
    return result;
    
  } catch (error) {
    console.error('Events Handler failed:', error.message);
    
    result.success = false;
    result.error = error.message;
    result.executionTime = Date.now() - executionStart;
    result.errors.push({
      type: 'system_error',
      message: error.message,
      stack: error.stack
    });
    
    return result;
  }
}

/**
 * Health check function for debugging
 * @param {Object} params - Action parameters
 * @returns {Object} Health check result
 */
async function healthCheck(params) {
  console.log('Events Handler Health Check');
  
  try {
    const logger = Core.Logger('events-handler-health', { level: 'info' });
    const stateLib = await State.init(params.libInit || {});
    const filesLib = await Files.init(params.libInit || {});
    const stateManager = new StateManager(stateLib, { logger });
    
    const tokenManager = new TokenManager(params, stateManager, logger);
    const journalReader = new JournalReader(params, stateManager, logger);
    const rateLimiterManager = new RateLimiterManager();
    const eventProcessor = new EventProcessor(params, filesLib);
    
    // Set up dependencies
    journalReader.setTokenManager(tokenManager);
    eventProcessor.setRateLimiterManager(rateLimiterManager);
    eventProcessor.setFilesLib(filesLib);
    
    const health = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      components: {
        tokenManager: await tokenManager.getTokenInfo(),
        journalReader: await journalReader.getStatus(),
        rateLimiterManager: rateLimiterManager.getStatus(),
        eventProcessor: eventProcessor.getStats()
      },
      configuration: {
        journalUrl: params.JOURNAL_URL || 'not_configured',
        clientId: params.CLIENT_ID ? 'configured' : 'not_configured',
        runtimeConfig: 'available'
      }
    };
    
    console.log('Health check completed');
    return health;
    
  } catch (error) {
    console.error('Health check failed:', error.message);
    return {
      timestamp: new Date().toISOString(),
      status: 'unhealthy',
      error: error.message
    };
  }
}

/**
 * Adobe I/O Runtime action exports
 */
module.exports = {
  main,
  healthCheck
};
