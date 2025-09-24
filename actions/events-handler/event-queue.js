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
 * Event Queue Manager
 * 
 * Manages queuing and processing of events with rate limiting,
 * deduplication, and priority handling.
 */

const { State } = require('@adobe/aio-lib-state');

/**
 * Event Queue Manager
 * Handles queuing, prioritization, and controlled processing of events
 */
class EventQueue {
  constructor(config = {}) {
    this.config = {
      // Queue settings
      maxQueueSize: 1000,
      keyPrefix: 'event_queue_',
      queueKey: 'pending_events',
      
      // Processing settings
      batchSize: 5, // Process up to 5 events per batch
      maxRetries: 3,
      retryDelay: 1000, // 1 second
      
      // Deduplication settings
      deduplicationWindow: 300000, // 5 minutes
      
      // TTL settings
      queueTTL: 3600, // 1 hour
      
      logger: console,
      ...config
    };
    
    this.state = null;
    this._initPromise = null;
  }

  /**
   * Initialize Adobe I/O State service
   */
  async _init() {
    if (this._initPromise) {
      return this._initPromise;
    }
    
    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    try {
      this.state = new State();
      this.config.logger.debug && this.config.logger.debug('Event queue State service initialized');
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Failed to initialize Event queue State service', error);
      throw error;
    }
  }

  /**
   * Get current queue state from persistent storage
   */
  async _getQueueState() {
    await this._init();
    
    try {
      const queueKey = `${this.config.keyPrefix}${this.config.queueKey}`;
      const { value } = await this.state.get(queueKey);
      
      if (value) {
        const queueData = JSON.parse(value);
        return {
          events: queueData.events || [],
          lastProcessed: queueData.lastProcessed ? new Date(queueData.lastProcessed) : null,
          statistics: queueData.statistics || { processed: 0, failed: 0, duplicate: 0 }
        };
      }
      
      // Initialize new queue
      return {
        events: [],
        lastProcessed: null,
        statistics: { processed: 0, failed: 0, duplicate: 0 }
      };
      
    } catch (error) {
      this.config.logger.warn && this.config.logger.warn('Error getting queue state, using empty queue', { error: error.message });
      return {
        events: [],
        lastProcessed: null,
        statistics: { processed: 0, failed: 0, duplicate: 0 }
      };
    }
  }

  /**
   * Save queue state to persistent storage
   */
  async _saveQueueState(queueState) {
    await this._init();
    
    try {
      const queueKey = `${this.config.keyPrefix}${this.config.queueKey}`;
      const queueData = {
        events: queueState.events,
        lastProcessed: queueState.lastProcessed ? queueState.lastProcessed.toISOString() : null,
        statistics: queueState.statistics
      };
      
      await this.state.put(queueKey, JSON.stringify(queueData), { ttl: this.config.queueTTL });
      
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Error saving queue state', error);
      throw error;
    }
  }

  /**
   * Create event metadata for queuing
   */
  _createEventMetadata(event, priority = 'normal') {
    return {
      id: event.id,
      sku: event.data?.sku,
      type: event.type,
      priority: priority, // 'high', 'normal', 'low'
      queuedAt: new Date().toISOString(),
      attempts: 0,
      lastAttempt: null,
      event: event // Store full event data
    };
  }

  /**
   * Check if event is duplicate within deduplication window
   */
  _isDuplicateEvent(newEvent, existingEvents) {
    const now = new Date().getTime();
    const windowStart = now - this.config.deduplicationWindow;
    
    return existingEvents.some(queuedEvent => {
      const queuedTime = new Date(queuedEvent.queuedAt).getTime();
      
      // Check if within deduplication window and same SKU
      return queuedTime > windowStart && 
             queuedEvent.sku === newEvent.sku &&
             queuedEvent.type === newEvent.type;
    });
  }

  /**
   * Remove old events from queue (cleanup)
   */
  _cleanupOldEvents(events) {
    const now = new Date().getTime();
    const cutoffTime = now - (this.config.queueTTL * 1000); // Convert TTL to milliseconds
    
    const cleanedEvents = events.filter(event => {
      const eventTime = new Date(event.queuedAt).getTime();
      return eventTime > cutoffTime;
    });
    
    const removedCount = events.length - cleanedEvents.length;
    if (removedCount > 0) {
      this.config.logger.info && this.config.logger.info('Cleaned up old events from queue', {
        removedCount,
        remainingCount: cleanedEvents.length
      });
    }
    
    return cleanedEvents;
  }

  /**
   * Add event to queue
   */
  async enqueue(event, priority = 'normal') {
    try {
      this.config.logger.info && this.config.logger.info('Adding event to queue', {
        eventId: event.id,
        sku: event.data?.sku,
        type: event.type,
        priority
      });

      let queueState = await this._getQueueState();
      
      // Cleanup old events first
      queueState.events = this._cleanupOldEvents(queueState.events);
      
      // Create event metadata
      const eventMetadata = this._createEventMetadata(event, priority);
      
      // Check for duplicates
      if (this._isDuplicateEvent(eventMetadata, queueState.events)) {
        this.config.logger.warn && this.config.logger.warn('Duplicate event detected, skipping', {
          eventId: event.id,
          sku: event.data?.sku,
          type: event.type
        });
        
        queueState.statistics.duplicate++;
        await this._saveQueueState(queueState);
        
        return {
          success: false,
          reason: 'Duplicate event',
          queueSize: queueState.events.length,
          statistics: queueState.statistics
        };
      }
      
      // Check queue size limit
      if (queueState.events.length >= this.config.maxQueueSize) {
        this.config.logger.warn && this.config.logger.warn('Queue size limit reached, removing oldest events', {
          currentSize: queueState.events.length,
          maxSize: this.config.maxQueueSize
        });
        
        // Remove oldest events (FIFO)
        const eventsToRemove = queueState.events.length - this.config.maxQueueSize + 1;
        queueState.events.splice(0, eventsToRemove);
      }
      
      // Add event to queue (sorted by priority)
      queueState.events.push(eventMetadata);
      queueState.events.sort((a, b) => {
        const priorityOrder = { 'high': 3, 'normal': 2, 'low': 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });
      
      // Save updated queue
      await this._saveQueueState(queueState);
      
      this.config.logger.info && this.config.logger.info('Event added to queue successfully', {
        eventId: event.id,
        sku: event.data?.sku,
        queueSize: queueState.events.length,
        priority
      });
      
      return {
        success: true,
        queueSize: queueState.events.length,
        position: queueState.events.findIndex(e => e.id === event.id) + 1,
        statistics: queueState.statistics
      };
      
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Error adding event to queue', {
        error: error.message,
        eventId: event?.id,
        sku: event?.data?.sku
      });
      
      throw error;
    }
  }

  /**
   * Get next batch of events to process
   */
  async dequeue(batchSize = null) {
    try {
      const actualBatchSize = batchSize || this.config.batchSize;
      let queueState = await this._getQueueState();
      
      // Cleanup old events
      queueState.events = this._cleanupOldEvents(queueState.events);
      
      if (queueState.events.length === 0) {
        return {
          events: [],
          queueSize: 0,
          statistics: queueState.statistics
        };
      }
      
      // Get events that haven't exceeded retry limit
      const processingEvents = queueState.events
        .filter(event => event.attempts < this.config.maxRetries)
        .slice(0, actualBatchSize);
      
      this.config.logger.info && this.config.logger.info('Dequeued events for processing', {
        batchSize: processingEvents.length,
        queueSize: queueState.events.length,
        requestedSize: actualBatchSize
      });
      
      return {
        events: processingEvents.map(eventMeta => eventMeta.event),
        eventMetadata: processingEvents,
        queueSize: queueState.events.length,
        statistics: queueState.statistics
      };
      
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Error dequeuing events', error);
      throw error;
    }
  }

  /**
   * Mark events as processed (remove from queue)
   */
  async markProcessed(eventIds, success = true) {
    try {
      let queueState = await this._getQueueState();
      
      const initialSize = queueState.events.length;
      
      // Remove processed events or update retry count for failed events
      queueState.events = queueState.events.filter(eventMeta => {
        if (eventIds.includes(eventMeta.id)) {
          if (success) {
            queueState.statistics.processed++;
            return false; // Remove from queue
          } else {
            // Increment attempt count for failed events
            eventMeta.attempts++;
            eventMeta.lastAttempt = new Date().toISOString();
            
            if (eventMeta.attempts >= this.config.maxRetries) {
              queueState.statistics.failed++;
              return false; // Remove after max retries
            }
            
            return true; // Keep in queue for retry
          }
        }
        return true; // Keep other events
      });
      
      queueState.lastProcessed = new Date();
      
      // Save updated queue
      await this._saveQueueState(queueState);
      
      const processedCount = initialSize - queueState.events.length;
      
      this.config.logger.info && this.config.logger.info('Events marked as processed', {
        eventIds,
        success,
        processedCount,
        remainingInQueue: queueState.events.length,
        statistics: queueState.statistics
      });
      
      return {
        processedCount,
        remainingInQueue: queueState.events.length,
        statistics: queueState.statistics
      };
      
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Error marking events as processed', error);
      throw error;
    }
  }

  /**
   * Get queue status and statistics
   */
  async getStatus() {
    try {
      let queueState = await this._getQueueState();
      queueState.events = this._cleanupOldEvents(queueState.events);
      
      // Group events by priority
      const eventsByPriority = queueState.events.reduce((acc, event) => {
        acc[event.priority] = (acc[event.priority] || 0) + 1;
        return acc;
      }, {});
      
      // Group events by type
      const eventsByType = queueState.events.reduce((acc, event) => {
        acc[event.type] = (acc[event.type] || 0) + 1;
        return acc;
      }, {});
      
      return {
        queueSize: queueState.events.length,
        maxQueueSize: this.config.maxQueueSize,
        lastProcessed: queueState.lastProcessed,
        statistics: queueState.statistics,
        eventsByPriority,
        eventsByType,
        config: {
          batchSize: this.config.batchSize,
          maxRetries: this.config.maxRetries,
          deduplicationWindow: this.config.deduplicationWindow
        }
      };
      
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Error getting queue status', error);
      return {
        queueSize: 0,
        error: error.message,
        statistics: { processed: 0, failed: 0, duplicate: 0 }
      };
    }
  }

  /**
   * Clear the entire queue
   */
  async clear() {
    try {
      const emptyQueue = {
        events: [],
        lastProcessed: new Date(),
        statistics: { processed: 0, failed: 0, duplicate: 0 }
      };
      
      await this._saveQueueState(emptyQueue);
      
      this.config.logger.info && this.config.logger.info('Event queue cleared');
      
      return { success: true, message: 'Queue cleared successfully' };
      
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Error clearing queue', error);
      throw error;
    }
  }
}

module.exports = { EventQueue };
