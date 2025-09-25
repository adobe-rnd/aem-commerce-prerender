/**
 * Adobe I/O Events Journal Reader
 * 
 * Reads events from Adobe I/O Events Journaling API with cursor management.
 * Implements pull-based event consumption with position tracking.
 * 
 * Features:
 * - Cursor-based position tracking
 * - Batch event fetching (up to 100 events)
 * - Event filtering by type and SKU
 * - Persistent cursor storage
 * - Error handling and retry logic
 */

const fetch = require('node-fetch');
const { StateManager } = require('../lib/state');

/**
 * Journal Reader class
 */
class JournalReader {
  constructor(params = {}, stateManager = null, logger = console) {
    // Journal configuration
    this.journalUrl = params.JOURNAL_URL || 'https://events-va6.adobe.io/events/organizations/1172492/integrations/842637/eef46a64-81dd-4b51-b58d-e208a3e0c76f';
    this.clientId = params.CLIENT_ID || process.env.CLIENT_ID || '94ef891d1d6c498499d19f07f46c812f';
    this.imsOrgId = params.IMS_ORG_ID || process.env.IMS_ORG_ID || 'DEDB2A52641B1D460A495F8E@AdobeOrg';
    
    // Token manager (will be injected)
    this.tokenManager = null;
    
    // State management for cursor tracking
    this.stateManager = stateManager;
    this.cursorKey = 'journal_cursor_position';
    this.logger = logger;
    
    // Event filtering configuration
    this.supportedEventTypes = [
      'com.adobe.commerce.storefront.events.product.update',
      'com.adobe.commerce.storefront.events.price.update'
    ];
    
    // Batch configuration
    this.batchSize = 100; // Max events per request
    this.maxRetries = 3;
  }

  /**
   * Set token manager dependency
   * @param {TokenManager} tokenManager - Token manager instance
   */
  setTokenManager(tokenManager) {
    this.tokenManager = tokenManager;
  }

  /**
   * Set state manager (injected dependency)
   */
  setStateManager(stateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Get stored cursor position
   * @returns {Promise<string|null>} Last cursor position or null
   */
  async getCursor() {
    try {
      const cursor = this.stateManager ? await this.stateManager.get(this.cursorKey) : null;
      return cursor || null;
    } catch (error) {
      console.warn('Could not get cursor from state:', error.message);
      return null;
    }
  }

  /**
   * Save cursor position
   * @param {string} cursor - Cursor position to save
   */
  async saveCursor(cursor) {
    try {
      if (this.stateManager) {
        await this.stateManager.put(this.cursorKey, cursor);
      }
      console.log(`Cursor saved: ${cursor.substring(0, 20)}...`);
    } catch (error) {
      console.warn('Could not save cursor to state:', error.message);
    }
  }

  /**
   * Read events from journal with cursor management
   * @param {Object} options - Reading options
   * @param {number} options.limit - Max events to read (default: 100)
   * @param {string} options.since - Override cursor position
   * @returns {Promise<Object>} Result with events and new cursor
   */
  async readEvents(options = {}) {
    const limit = Math.min(options.limit || this.batchSize, this.batchSize);
    let cursor = options.since || await this.getCursor();
    
    console.log(`Reading events from journal (limit: ${limit})`);
    if (cursor) {
      console.log(`Starting from cursor: ${cursor.substring(0, 20)}...`);
    } else {
      console.log('Starting from beginning (no cursor found)');
    }

    try {
      if (!this.tokenManager) {
        throw new Error('Token manager not set');
      }

      const accessToken = await this.tokenManager.getAccessToken();
      const events = await this.fetchEventsFromJournal(accessToken, cursor, limit);
      
      return {
        success: true,
        events: events.events || [],
        newCursor: events.cursor,
        totalRead: events.events?.length || 0,
        hasMore: events.hasMore || false
      };
      
    } catch (error) {
      console.error('Error reading events from journal:', error.message);
      return {
        success: false,
        error: error.message,
        events: [],
        newCursor: cursor,
        totalRead: 0,
        hasMore: false
      };
    }
  }

  /**
   * Fetch events from Adobe I/O Events Journaling API
   * @param {string} accessToken - Valid access token
   * @param {string} cursor - Cursor position (optional)
   * @param {number} limit - Max events to fetch
   * @returns {Promise<Object>} Events data
   */
  async fetchEventsFromJournal(accessToken, cursor, limit) {
    const url = new URL(this.journalUrl);
    
    // Add query parameters
    url.searchParams.set('limit', limit.toString());
    if (cursor) {
      url.searchParams.set('since', cursor);
    }

    console.log(`Fetching from: ${url.toString()}`);

    let lastError = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-api-key': this.clientId,
            'x-ims-org-id': this.imsOrgId,
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.text();
        
        if (!data || data.trim() === '') {
          console.log('No events in journal');
          return { events: [], cursor: cursor };
        }

        // Parse JSONL format (one JSON object per line)
        const events = this.parseJsonlEvents(data);
        const filteredEvents = this.filterRelevantEvents(events);
        
        // Extract cursor from response headers or last event
        const newCursor = this.extractCursor(response, events);
        
        console.log(`Fetched ${events.length} events, ${filteredEvents.length} relevant`);
        
        return {
          events: filteredEvents,
          cursor: newCursor,
          hasMore: events.length === limit
        };
        
      } catch (error) {
        lastError = error;
        console.warn(`Attempt ${attempt}/${this.maxRetries} failed: ${error.message}`);
        
        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Parse JSONL format events
   * @param {string} jsonlData - JSONL data from journal
   * @returns {Array} Parsed events
   */
  parseJsonlEvents(jsonlData) {
    const lines = jsonlData.trim().split('\n');
    const events = [];
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const event = JSON.parse(line);
          events.push(event);
        } catch (error) {
          console.warn('Failed to parse event line:', error.message);
        }
      }
    }
    
    return events;
  }

  /**
   * Filter events by type and extract SKUs
   * @param {Array} events - Raw events from journal
   * @returns {Array} Filtered events with SKU information
   */
  filterRelevantEvents(events) {
    const filtered = [];
    
    for (const event of events) {
      // Check if this is a supported event type
      if (this.supportedEventTypes.includes(event.type)) {
        // Extract SKU from event data
        const sku = this.extractSku(event);
        
        if (sku) {
          filtered.push({
            id: event.id || event.eventid,
            type: event.type,
            sku: sku,
            timestamp: event.time,
            source: event.source,
            instanceId: event.data?.instanceId,
            rawEvent: event
          });
        }
      }
    }
    
    return filtered;
  }

  /**
   * Extract SKU from event data
   * @param {Object} event - Event object
   * @returns {string|null} SKU if found
   */
  extractSku(event) {
    if (event.data && event.data.sku) {
      return event.data.sku;
    }
    
    // Try other possible SKU locations
    if (event.data && event.data.product && event.data.product.sku) {
      return event.data.product.sku;
    }
    
    return null;
  }

  /**
   * Extract cursor from response
   * @param {Response} response - HTTP response
   * @param {Array} events - Events array
   * @returns {string|null} New cursor position
   */
  extractCursor(response, events) {
    // Check for cursor in response headers
    const cursorHeader = response.headers.get('x-adobe-cursor') || 
                        response.headers.get('cursor') ||
                        response.headers.get('x-cursor');
    
    if (cursorHeader) {
      return cursorHeader;
    }
    
    // Fallback: use timestamp of last event
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];
      return lastEvent.time || lastEvent.timestamp || new Date().toISOString();
    }
    
    return null;
  }

  /**
   * Process batch of events and update cursor
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing result
   */
  async processBatch(options = {}) {
    try {
      const result = await this.readEvents(options);
      
      if (!result.success) {
        return result;
      }
      
      // Update cursor position if we got events
      if (result.newCursor && result.totalRead > 0) {
        await this.saveCursor(result.newCursor);
      }
      
      return result;
      
    } catch (error) {
      console.error('Error processing batch:', error.message);
      return {
        success: false,
        error: error.message,
        events: [],
        totalRead: 0
      };
    }
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get reader status for debugging
   * @returns {Object} Reader status
   */
  async getStatus() {
    try {
      const cursor = await this.getCursor();
      return {
        journalUrl: this.journalUrl,
        clientId: this.clientId,
        currentCursor: cursor ? cursor.substring(0, 20) + '...' : 'none',
        supportedEventTypes: this.supportedEventTypes,
        batchSize: this.batchSize,
        tokenManager: this.tokenManager ? 'configured' : 'not_set'
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}

module.exports = { JournalReader };
