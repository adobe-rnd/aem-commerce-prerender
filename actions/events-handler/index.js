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
 * Events Handler - Adobe I/O Events Integration
 * 
 * Simple Runtime Action for Adobe I/O Events integration.
 * According to Adobe App Builder documentation:
 * https://developer.adobe.com/app-builder/docs/intro_and_overview/
 * 
 * This is a NON-WEB action designed to receive events directly from Adobe I/O Events.
 */

// Import modules
const { 
  logger, 
  buildRuntimeConfig, 
  initAIOLibs, 
  validateCloudEvent, 
  logConfiguration, 
  logEnvironmentVariables, 
  createEventResponse 
} = require('./utils');

const { authenticateEvent } = require('./adobe-auth');
const { processEventWithControls } = require('./event-processor');
const { processQueuedEvents } = require('./control-systems');

/**
 * Main action function
 * @param {object} params - Action parameters from Adobe I/O Events
 * @returns {object} Processing result
 */
async function main(params) {
  const startTime = Date.now();
  
  logger.info('=== Events Handler Started ===');
  logger.info('Action invocation details', {
    timestamp: new Date().toISOString(),
    activationId: process.env.__OW_ACTIVATION_ID || 'unknown',
    namespace: process.env.__OW_NAMESPACE || 'unknown'
  });
  
  try {
    // Step 1: Build runtime configuration from parameters
    const runtimeConfig = buildRuntimeConfig(params);
    logConfiguration(runtimeConfig);
    logEnvironmentVariables();
    
    // Step 2: Initialize AIO libraries for file operations
    const aioLibs = await initAIOLibs(params);
    if (!aioLibs) {
      throw new Error('AIO Files library not available - cannot process events');
    }
    
    // Step 3: Log received parameters (with filtering for sensitive data)
    const filteredParams = { ...params };
    delete filteredParams.STORE_URL;
    delete filteredParams.CONTENT_URL;
    delete filteredParams.AEM_ADMIN_API_AUTH_TOKEN;
    
    logger.info('Received parameters', {
      parameterCount: Object.keys(params).length,
      hasData: !!(params.data),
      eventType: params.type
    });
    logger.debug('Parameter details', filteredParams);
    
    // Step 4: Check if this is a queue processing trigger or a real event
    if (params.__OW_TRIGGER_NAME === 'queueProcessorTrigger') {
      logger.info('Queue processing trigger activated');
      
      // Only process queued events, no main event processing
      try {
        const queueProcessingResult = await processQueuedEvents(params, aioLibs);
        
        logger.info('Scheduled queue processing completed', {
          processed: queueProcessingResult.processed,
          failed: queueProcessingResult.failed,
          remainingInQueue: queueProcessingResult.queueSize
        });
        
        return {
          success: true,
          message: 'Queue processing completed',
          processed: queueProcessingResult.processed,
          failed: queueProcessingResult.failed,
          queueSize: queueProcessingResult.queueSize,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        logger.error('Scheduled queue processing failed', error);
        return {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }
    
    // Step 5: Validate CloudEvent structure for normal events
    // According to Adobe I/O Events documentation, events are passed in the action parameters
    const event = params;
    
    const validation = validateCloudEvent(event);
    if (!validation.valid) {
      logger.error('Invalid CloudEvent received', { 
        missingFields: validation.missingFields,
        receivedFields: Object.keys(event)
      });
      
      const errorResult = {
        success: false,
        error: 'Invalid CloudEvent format',
        details: `Missing required fields: ${validation.missingFields.join(', ')}`
      };
      
      return createEventResponse(event, errorResult, Date.now() - startTime, false);
    }

    // Step 6: Adobe digital signature validation
    const authResult = await authenticateEvent(event, params, runtimeConfig);
    if (!authResult.authenticated) {
      logger.error('Authentication failed', {
        reason: authResult.reason,
        eventId: event.id
      });
      
      const errorResult = {
        error: 'Authentication failed',
        details: authResult.reason
      };
      
      return createEventResponse(event, errorResult, Date.now() - startTime, false);
    }
    
    logger.info('Authentication passed', { reason: authResult.reason });

    // Step 7: Log event details
    logger.info('CloudEvent details', {
      type: event.type,
      id: event.id,
      source: event.source,
      time: event.time,
      specversion: event.specversion,
      datacontenttype: event.datacontenttype
    });
    
    // Step 8: Process event with all controls (rate limiting, filtering, queuing)
    logger.info('Processing event with control systems');
    const processingResult = await processEventWithControls(event, params, aioLibs, runtimeConfig);
    
    const processingTime = Date.now() - startTime;
    
    logger.info('Event processing completed', {
      success: processingResult.success,
      eventId: event.id,
      eventType: event.type,
      processingTimeMs: processingTime,
      sku: processingResult.sku || null,
      stage: processingResult.stage
    });
    
    // Step 9: Process any queued events (background processing)
    try {
      const queueProcessingResult = await processQueuedEvents(params, aioLibs);
      if (queueProcessingResult.processed > 0) {
        logger.info('Background queue processing completed', {
          processed: queueProcessingResult.processed,
          failed: queueProcessingResult.failed,
          remainingInQueue: queueProcessingResult.queueSize
        });
      }
    } catch (queueError) {
      logger.warn('Background queue processing failed', { error: queueError.message });
      // Don't fail the main event processing because of queue processing errors
    }
    
    logger.info('=== Events Handler Finished ===');
    
    // Step 10: Return detailed response for Adobe I/O Events
    return createEventResponse(event, processingResult, processingTime, processingResult.success);
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    logger.error('Unexpected error in events handler', error);
    logger.error('Action execution details', {
      processingTimeMs: processingTime,
      paramsReceived: Object.keys(params).length > 0,
      timestamp: new Date().toISOString()
    });
    
    logger.info('=== Events Handler Failed ===');
    
    const errorResult = {
      error: error.message,
      stack: error.stack
    };
    
    const event = params; // Use params as event for error response
    return createEventResponse(event, errorResult, processingTime, false);
  }
}

exports.main = main;
