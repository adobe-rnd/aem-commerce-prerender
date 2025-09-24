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
 * Control Systems Manager
 * 
 * Manages rate limiting, SKU filtering, and event queue systems
 */

const { RateLimiter } = require('./rate-limiter');
const { SKUFilter, FILTER_PRESETS } = require('./sku-filter');
const { EventQueue } = require('./event-queue');
const { logger } = require('./utils');

// System instances cache (per activation)
const systemInstances = {
  rateLimiter: null,
  skuFilter: null,
  eventQueue: null
};

/**
 * Initialize rate limiter
 */
function initRateLimiter(config) {
  if (!systemInstances.rateLimiter) {
    systemInstances.rateLimiter = new RateLimiter({
      maxTokens: config.RATE_LIMIT_MAX_TOKENS,
      refillRate: config.RATE_LIMIT_REFILL_RATE,
      logger: logger
    });
    logger.debug('Rate limiter initialized', {
      maxTokens: config.RATE_LIMIT_MAX_TOKENS,
      refillRate: config.RATE_LIMIT_REFILL_RATE
    });
  }
  return systemInstances.rateLimiter;
}

/**
 * Initialize SKU filter
 */
function initSKUFilter(config) {
  if (!systemInstances.skuFilter) {
    const filterConfig = FILTER_PRESETS[config.SKU_FILTER_PRESET] || FILTER_PRESETS.ALLOW_ALL;
    systemInstances.skuFilter = new SKUFilter({
      ...filterConfig,
      logger: logger
    });
    logger.debug('SKU filter initialized', {
      preset: config.SKU_FILTER_PRESET,
      filterConfig
    });
  }
  return systemInstances.skuFilter;
}

/**
 * Initialize event queue
 */
function initEventQueue(config) {
  if (!systemInstances.eventQueue) {
    systemInstances.eventQueue = new EventQueue({
      maxQueueSize: config.EVENT_QUEUE_MAX_SIZE,
      batchSize: config.EVENT_QUEUE_BATCH_SIZE,
      maxRetries: config.EVENT_QUEUE_MAX_RETRIES,
      retryDelay: config.EVENT_QUEUE_RETRY_DELAY,
      deduplicationWindow: config.EVENT_QUEUE_DEDUP_WINDOW,
      queueTTL: config.EVENT_QUEUE_TTL,
      logger: logger
    });
    logger.debug('Event queue initialized', {
      maxQueueSize: config.EVENT_QUEUE_MAX_SIZE,
      batchSize: config.EVENT_QUEUE_BATCH_SIZE,
      maxRetries: config.EVENT_QUEUE_MAX_RETRIES
    });
  }
  return systemInstances.eventQueue;
}

/**
 * Initialize all control systems
 */
function initControlSystems(config) {
  const systems = {};
  
  if (config.ENABLE_RATE_LIMITING) {
    systems.rateLimiter = initRateLimiter(config);
  }
  
  if (config.ENABLE_SKU_FILTERING) {
    systems.skuFilter = initSKUFilter(config);
  }
  
  if (config.ENABLE_EVENT_QUEUE) {
    systems.eventQueue = initEventQueue(config);
  }
  
  logger.info('Control systems initialized', {
    rateLimiting: !!systems.rateLimiter,
    skuFiltering: !!systems.skuFilter,
    eventQueue: !!systems.eventQueue
  });
  
  return systems;
}

/**
 * Apply SKU filtering to event
 */
function applySkuFilter(event, skuFilterInstance) {
  if (!skuFilterInstance) {
    return { allowed: true, reason: 'SKU filtering disabled' };
  }
  
  logger.debug('Applying SKU filter');
  const filterResult = skuFilterInstance.shouldProcessEvent(event);
  
  if (!filterResult.allowed) {
    logger.warn('Event filtered out by SKU filter', {
      eventId: event.id,
      sku: event.data?.sku,
      reason: filterResult.reason,
      stage: filterResult.stage
    });
  } else {
    logger.info('Event passed SKU filter', {
      eventId: event.id,
      sku: event.data?.sku,
      reason: filterResult.reason
    });
  }
  
  return filterResult;
}

/**
 * Apply rate limiting check
 */
async function applyRateLimit(event, rateLimiterInstance) {
  if (!rateLimiterInstance) {
    return { allowed: true, reason: 'Rate limiting disabled' };
  }
  
  logger.debug('Checking rate limit');
  const rateLimitResult = await rateLimiterInstance.canProcess();
  
  if (!rateLimitResult.allowed) {
    logger.warn('Event rate limited', {
      eventId: event.id,
      sku: event.data?.sku,
      tokensRemaining: rateLimitResult.tokensRemaining,
      requestsInLastSecond: rateLimitResult.requestsInLastSecond,
      retryAfterMs: rateLimitResult.retryAfterMs
    });
  } else {
    logger.info('Event passed rate limit check', {
      eventId: event.id,
      tokensRemaining: rateLimitResult.tokensRemaining,
      requestsInLastSecond: rateLimitResult.requestsInLastSecond
    });
  }
  
  return rateLimitResult;
}

/**
 * Queue event for later processing
 */
async function queueEvent(event, eventQueueInstance, priority = 'normal') {
  if (!eventQueueInstance) {
    throw new Error('Event queue not available');
  }
  
  logger.info('Adding rate-limited event to queue');
  const queueResult = await eventQueueInstance.enqueue(event, priority);
  
  return {
    success: true,
    reason: 'Event queued due to rate limit',
    details: {
      queued: true,
      queuePosition: queueResult.position,
      queueSize: queueResult.queueSize
    }
  };
}

/**
 * Process event through all control systems
 */
async function processEventThroughControls(event, config) {
  const processingStart = Date.now();
  
  logger.info('Processing event with control systems', {
    eventId: event.id,
    eventType: event.type,
    sku: event.data?.sku
  });

  try {
    // Initialize control systems
    const systems = initControlSystems(config);

    // Step 1: SKU Filtering
    const filterResult = applySkuFilter(event, systems.skuFilter);
    if (!filterResult.allowed) {
      return {
        success: false,
        reason: 'Event filtered by SKU filter',
        details: filterResult,
        processingTimeMs: Date.now() - processingStart,
        stage: 'sku_filter'
      };
    }

    // Step 2: Rate Limiting Check
    const rateLimitResult = await applyRateLimit(event, systems.rateLimiter);
    if (!rateLimitResult.allowed) {
      // If we have a queue and rate limit is hit, queue the event
      if (systems.eventQueue) {
        const queueResult = await queueEvent(event, systems.eventQueue);
        
        return {
          ...queueResult,
          details: {
            ...queueResult.details,
            retryAfterMs: rateLimitResult.retryAfterMs
          },
          processingTimeMs: Date.now() - processingStart,
          stage: 'rate_limited_queued'
        };
      } else {
        // No queue available, reject the event
        return {
          success: false,
          reason: 'Rate limit exceeded',
          details: rateLimitResult,
          processingTimeMs: Date.now() - processingStart,
          stage: 'rate_limited'
        };
      }
    }

    // All controls passed - event can be processed immediately
    logger.info('Event passed all control systems', {
      eventId: event.id,
      eventType: event.type,
      sku: event.data?.sku
    });

    return {
      success: true,
      reason: 'All control systems passed',
      processingTimeMs: Date.now() - processingStart,
      stage: 'controls_passed'
    };

  } catch (error) {
    logger.error('Error in control systems processing', {
      eventId: event.id,
      sku: event.data?.sku,
      error: error.message,
      processingTimeMs: Date.now() - processingStart
    });

    return {
      success: false,
      reason: 'Control systems error',
      error: error.message,
      processingTimeMs: Date.now() - processingStart,
      stage: 'controls_error'
    };
  }
}

/**
 * Process queued events (background processing)
 */
async function processQueuedEvents(params, aioLibs) {
  if (!systemInstances.eventQueue) {
    return { processed: 0, message: 'Event queue not initialized' };
  }

  try {
    logger.info('Processing queued events');
    
    // Get events from queue
    const queueResult = await systemInstances.eventQueue.dequeue();
    
    if (queueResult.events.length === 0) {
      logger.debug('No queued events to process');
      return { 
        processed: 0, 
        queueSize: queueResult.queueSize,
        message: 'No events in queue' 
      };
    }

    logger.info('Processing batch of queued events', {
      batchSize: queueResult.events.length,
      queueSize: queueResult.queueSize
    });

    const processedEventIds = [];
    const failedEventIds = [];

    // Process each event
    for (const event of queueResult.events) {
      try {
        // Import here to avoid circular dependency
        const { routeEventToProcessor } = require('./event-processor');
        
        logger.info('Processing queued event', {
          eventId: event.id,
          eventType: event.type,
          sku: event.data?.sku
        });

        const result = await routeEventToProcessor(event, params, aioLibs);
        
        if (result.success) {
          processedEventIds.push(event.id);
          logger.info('Queued event processed successfully', {
            eventId: event.id,
            sku: result.sku
          });
        } else {
          failedEventIds.push(event.id);
          logger.warn('Queued event processing failed', {
            eventId: event.id,
            error: result.error || result.reason
          });
        }
      } catch (error) {
        failedEventIds.push(event.id);
        logger.error('Error processing queued event', {
          eventId: event.id,
          error: error.message
        });
      }
    }

    // Mark events as processed or failed
    if (processedEventIds.length > 0) {
      await systemInstances.eventQueue.markProcessed(processedEventIds, true);
    }
    
    if (failedEventIds.length > 0) {
      await systemInstances.eventQueue.markProcessed(failedEventIds, false);
    }

    logger.info('Queued events processing completed', {
      processed: processedEventIds.length,
      failed: failedEventIds.length,
      totalProcessed: processedEventIds.length + failedEventIds.length
    });

    return {
      processed: processedEventIds.length,
      failed: failedEventIds.length,
      queueSize: queueResult.queueSize - processedEventIds.length - failedEventIds.length,
      processedEventIds,
      failedEventIds
    };

  } catch (error) {
    logger.error('Error processing queued events', error);
    throw error;
  }
}

/**
 * Get status of all control systems
 */
async function getControlSystemsStatus() {
  const status = {
    rateLimiter: null,
    skuFilter: null,
    eventQueue: null
  };
  
  try {
    if (systemInstances.rateLimiter) {
      status.rateLimiter = await systemInstances.rateLimiter.getStatus();
    }
    
    if (systemInstances.skuFilter) {
      status.skuFilter = systemInstances.skuFilter.getStatistics();
    }
    
    if (systemInstances.eventQueue) {
      status.eventQueue = await systemInstances.eventQueue.getStatus();
    }
    
    return status;
    
  } catch (error) {
    logger.error('Error getting control systems status', error);
    return { error: error.message };
  }
}

module.exports = {
  initRateLimiter,
  initSKUFilter,
  initEventQueue,
  initControlSystems,
  applySkuFilter,
  applyRateLimit,
  queueEvent,
  processEventThroughControls,
  processQueuedEvents,
  getControlSystemsStatus
};
