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
 * Utilities for Events Handler
 */

/**
 * Logger utility with structured logging
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
      if (typeof error === 'object' && error.message) {
        console.error(`[ERROR_DETAILS] ${error.message}`);
        if (error.stack) console.error(`[STACK] ${error.stack}`);
      } else {
        console.error(`[ERROR_DATA] ${JSON.stringify(error, null, 2)}`);
      }
    }
  },
  
  debug: (message, data = null) => {
    console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`);
    if (data) console.log(`[DEBUG_DATA] ${JSON.stringify(data, null, 2)}`);
  }
};

/**
 * Validate CloudEvent structure according to CloudEvents specification
 * @param {object} event - The event to validate
 * @returns {object} Validation result
 */
function validateCloudEvent(event) {
  const requiredFields = ['type', 'source', 'id', 'specversion'];
  const missingFields = requiredFields.filter(field => !event[field]);
  
  if (missingFields.length > 0) {
    return { 
      valid: false, 
      missingFields,
      message: `Missing required CloudEvent fields: ${missingFields.join(', ')}`
    };
  }
  
  return { valid: true };
}

/**
 * Create standardized response for Adobe I/O Events
 * @param {object} event - Original event
 * @param {object} result - Processing result
 * @param {number} processingTime - Processing time in milliseconds
 * @returns {object} Standardized response
 */
function createResponse(event, result, processingTime) {
  const response = {
    success: result.success,
    message: result.success ? 'Event processed successfully' : 'Event processing failed',
    eventId: event.id,
    eventType: event.type,
    processingTimeMs: processingTime,
    timestamp: new Date().toISOString(),
    
    // Event details
    sku: event.data?.sku || result.sku,
    
    // Processing details
    result: result,
    
    // Runtime information
    handler: 'events-handler',
    namespace: process.env.__OW_NAMESPACE || 'unknown',
    activationId: process.env.__OW_ACTIVATION_ID || 'unknown',
    
    // HTTP status
    statusCode: result.success ? 200 : 500
  };
  
  return response;
}

/**
 * Initialize AIO Files library
 * @param {object} params - Action parameters
 * @returns {object} AIO libraries
 */
async function initAIOLibs(params) {
  try {
    const Files = require('@adobe/aio-lib-files');
    const filesLib = await Files.init(params.libInit || {});
    
    logger.debug('AIO Files library initialized');
    return { filesLib };
    
  } catch (error) {
    logger.error('Failed to initialize AIO Files library', error);
    throw new Error(`Failed to initialize file storage: ${error.message}`);
  }
}

module.exports = {
  logger,
  validateCloudEvent,
  createResponse,
  initAIOLibs
};