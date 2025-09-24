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
 * Utilities and Configuration for Events Handler
 */

/**
 * Logger utility with different levels
 */
const logger = {
  info: (message, data = null) => {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`);
    if (data) console.log(`[DATA] ${JSON.stringify(data, null, 2)}`);
  },
  warn: (message, data = null) => {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`);
    if (data) console.warn(`[DATA] ${JSON.stringify(data, null, 2)}`);
  },
  error: (message, error = null) => {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`);
    if (error) {
      console.error(`[ERROR_DETAILS] Message: ${error.message}`);
      console.error(`[ERROR_STACK] ${error.stack}`);
    }
  },
  debug: (message, data = null) => {
    console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`);
    if (data) console.log(`[DEBUG_DATA] ${JSON.stringify(data, null, 2)}`);
  }
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  CLIENT_ID: 'd0e28b9a5f9e4d029531f243e5a160a8',
  
  // Authentication configuration - disabled by default for webhook compatibility
  ENABLE_SIGNATURE_VALIDATION: false, // TODO: Enable after Event Registration is updated
  
  // Rate limiting configuration (max 20 requests per second)
  RATE_LIMIT_MAX_TOKENS: 20,
  RATE_LIMIT_REFILL_RATE: 20,
  
  // Event processing configuration
  ENABLE_RATE_LIMITING: true,
  ENABLE_SKU_FILTERING: true,
  ENABLE_EVENT_QUEUE: true,
  
  // Default SKU filter preset
  SKU_FILTER_PRESET: 'PRODUCTS_ONLY', // or 'ALLOW_ALL', 'SPECIFIC_PREFIXES'
  
  // Event queue configuration
  EVENT_QUEUE_MAX_SIZE: 1000,
  EVENT_QUEUE_BATCH_SIZE: 5,
  EVENT_QUEUE_MAX_RETRIES: 3,
  EVENT_QUEUE_RETRY_DELAY: 1000,
  EVENT_QUEUE_DEDUP_WINDOW: 300000, // 5 minutes
  EVENT_QUEUE_TTL: 3600 // 1 hour
};

/**
 * Build runtime configuration from parameters
 */
function buildRuntimeConfig(params) {
  return {
    ...DEFAULT_CONFIG,
    
    // Authentication configuration
    ENABLE_SIGNATURE_VALIDATION: params.ENABLE_SIGNATURE_VALIDATION === false || 
      params.ENABLE_SIGNATURE_VALIDATION === 'false' ? false : DEFAULT_CONFIG.ENABLE_SIGNATURE_VALIDATION,
    
    // Rate limiting configuration
    ENABLE_RATE_LIMITING: params.ENABLE_RATE_LIMITING !== false && params.ENABLE_RATE_LIMITING !== 'false',
    RATE_LIMIT_MAX_TOKENS: parseInt(params.RATE_LIMIT_MAX_TOKENS) || DEFAULT_CONFIG.RATE_LIMIT_MAX_TOKENS,
    RATE_LIMIT_REFILL_RATE: parseInt(params.RATE_LIMIT_REFILL_RATE) || DEFAULT_CONFIG.RATE_LIMIT_REFILL_RATE,
    
    // Event processing configuration
    ENABLE_SKU_FILTERING: params.ENABLE_SKU_FILTERING !== false && params.ENABLE_SKU_FILTERING !== 'false',
    ENABLE_EVENT_QUEUE: params.ENABLE_EVENT_QUEUE !== false && params.ENABLE_EVENT_QUEUE !== 'false',
    SKU_FILTER_PRESET: params.SKU_FILTER_PRESET || DEFAULT_CONFIG.SKU_FILTER_PRESET,
    
    // Event queue configuration
    EVENT_QUEUE_MAX_SIZE: parseInt(params.EVENT_QUEUE_MAX_SIZE) || DEFAULT_CONFIG.EVENT_QUEUE_MAX_SIZE,
    EVENT_QUEUE_BATCH_SIZE: parseInt(params.EVENT_QUEUE_BATCH_SIZE) || DEFAULT_CONFIG.EVENT_QUEUE_BATCH_SIZE,
    EVENT_QUEUE_MAX_RETRIES: parseInt(params.EVENT_QUEUE_MAX_RETRIES) || DEFAULT_CONFIG.EVENT_QUEUE_MAX_RETRIES,
    EVENT_QUEUE_RETRY_DELAY: parseInt(params.EVENT_QUEUE_RETRY_DELAY) || DEFAULT_CONFIG.EVENT_QUEUE_RETRY_DELAY,
    EVENT_QUEUE_DEDUP_WINDOW: parseInt(params.EVENT_QUEUE_DEDUP_WINDOW) || DEFAULT_CONFIG.EVENT_QUEUE_DEDUP_WINDOW,
    EVENT_QUEUE_TTL: parseInt(params.EVENT_QUEUE_TTL) || DEFAULT_CONFIG.EVENT_QUEUE_TTL
  };
}

/**
 * Initialize AIO libraries for file operations
 */
async function initAIOLibs(params) {
  try {
    const Files = require('@adobe/aio-lib-files');
    const filesLib = await Files.init(params.libInit || {});
    
    logger.debug('AIO Files library initialized successfully');
    return { filesLib };
    
  } catch (error) {
    logger.warn('Failed to initialize AIO Files library, product processing will be limited', { 
      error: error.message 
    });
    return null;
  }
}

/**
 * Validate CloudEvent structure
 */
function validateCloudEvent(event) {
  logger.debug('Validating CloudEvent structure');
  
  const requiredFields = ['type', 'source', 'id'];
  const missingFields = requiredFields.filter(field => !event[field]);
  
  if (missingFields.length > 0) {
    logger.warn('CloudEvent validation failed', { missingFields });
    return { valid: false, missingFields };
  }
  
  logger.info('CloudEvent validation passed');
  return { valid: true };
}

/**
 * Log configuration for debugging
 */
function logConfiguration(config) {
  logger.info('Runtime configuration', {
    authEnabled: config.ENABLE_SIGNATURE_VALIDATION,
    rateLimitingEnabled: config.ENABLE_RATE_LIMITING,
    skuFilteringEnabled: config.ENABLE_SKU_FILTERING,
    eventQueueEnabled: config.ENABLE_EVENT_QUEUE,
    maxTokensPerSecond: config.RATE_LIMIT_MAX_TOKENS,
    skuFilterPreset: config.SKU_FILTER_PRESET,
    queueMaxSize: config.EVENT_QUEUE_MAX_SIZE,
    queueBatchSize: config.EVENT_QUEUE_BATCH_SIZE,
    nodeEnv: process.env.NODE_ENV || 'development'
  });
}

/**
 * Log environment variables (filtered for security)
 */
function logEnvironmentVariables() {
  const envVars = Object.keys(process.env)
    .filter(key => key.startsWith('__OW_') || ['LOG_LEVEL', 'CONFIG_NAME'].includes(key))
    .reduce((obj, key) => {
      obj[key] = process.env[key];
      return obj;
    }, {});
  
  logger.debug('Environment variables', envVars);
}

/**
 * Create detailed response for Adobe I/O Events
 */
function createEventResponse(event, processingResult, processingTime, success = true) {
  const response = {
    success: success,
    message: success ? 'Event processed successfully' : 'Event processing failed',
    eventId: event.id,
    eventType: event.type,
    processingTimeMs: processingTime,
    timestamp: new Date().toISOString(),
    result: processingResult,
    
    // Additional information for processing confirmation
    handler: 'events-handler',
    namespace: process.env.__OW_NAMESPACE || 'unknown',
    activationId: process.env.__OW_ACTIVATION_ID || 'unknown',
    
    // Status for Adobe I/O Events
    statusCode: success ? 200 : 500,
    body: {
      status: success ? 'PROCESSED' : 'ERROR',
      eventId: event.id,
      message: success ? 
        `Successfully processed ${event.type} event` : 
        `Failed to process event: ${processingResult.error || processingResult.reason || 'Unknown error'}`,
      details: success ? {
        sku: event.data?.sku || 'unknown',
        instanceId: event.data?.instanceId || 'unknown',
        processingTime: `${processingTime}ms`
      } : {
        error: processingResult.error || processingResult.reason || 'Unknown error',
        processingTime: `${processingTime}ms`
      }
    }
  };
  
  logger.info(`Returning ${success ? 'success' : 'error'} response to Adobe I/O Events`, {
    statusCode: response.statusCode,
    eventId: response.eventId,
    eventType: response.eventType,
    success: response.success
  });
  
  return response;
}

module.exports = {
  logger,
  DEFAULT_CONFIG,
  buildRuntimeConfig,
  initAIOLibs,
  validateCloudEvent,
  logConfiguration,
  logEnvironmentVariables,
  createEventResponse
};
