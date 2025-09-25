/**
 * Event Processor for Adobe Commerce Events
 * 
 * Processes product and price update events by generating HTML markup 
 * and publishing products using existing pdp-renderer and publishing infrastructure.
 * 
 * Features:
 * - SKU-based event processing
 * - HTML generation using pdp-renderer
 * - Product publishing integration
 * - Rate-limited GraphQL and publishing requests
 * - Error handling and retry logic
 */

const { getRuntimeConfig } = require('../lib/runtimeConfig');
const { generateProductHtml } = require('../pdp-renderer/render');
const { AdminAPI } = require('../lib/aem');
const { getProductUrl, PDP_FILE_EXT } = require('../utils');

/**
 * Event Processor class
 */
class EventProcessor {
  constructor(params = {}, filesLib = null) {
    this.params = params;
    
    // Rate limiter (will be injected)
    this.rateLimiterManager = null;
    
    // Files lib (will be injected)
    this.filesLib = filesLib;
    
    // Processing stats
    this.stats = {
      totalEvents: 0,
      processedEvents: 0,
      failedEvents: 0,
      skippedEvents: 0,
      processingErrors: {}
    };
    
    console.log('Event processor initialized');
  }

  /**
   * Set rate limiter manager dependency
   * @param {RateLimiterManager} rateLimiterManager - Rate limiter manager instance
   */
  setRateLimiterManager(rateLimiterManager) {
    this.rateLimiterManager = rateLimiterManager;
  }

  /**
   * Set files library dependency
   * @param {Files} filesLib - Files library instance
   */
  setFilesLib(filesLib) {
    this.filesLib = filesLib;
  }

  /**
   * Process batch of events
   * @param {Array} events - Array of events to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results
   */
  async processBatch(events, options = {}) {
    const batchStart = Date.now();
    console.log(`Processing batch of ${events.length} events`);
    
    const results = {
      success: true,
      totalEvents: events.length,
      processedEvents: 0,
      failedEvents: 0,
      skippedEvents: 0,
      errors: [],
      processingTime: 0
    };

    // Extract unique SKUs from events
    const uniqueSKUs = this.getUniqueSKUs(events);
    console.log(`Extracted ${uniqueSKUs.length} unique SKUs from ${events.length} events`);

    // Process each unique SKU
    for (const sku of uniqueSKUs) {
      try {
        const processed = await this.processSku(sku, options);
        
        if (processed.success) {
          results.processedEvents++;
          console.log(`SKU ${sku} processed successfully`);
        } else {
          results.failedEvents++;
          results.errors.push({
      sku: sku,
            error: processed.error
          });
          console.error(`SKU ${sku} processing failed: ${processed.error}`);
        }
        
      } catch (error) {
        results.failedEvents++;
        results.errors.push({
          sku: sku,
          error: error.message
        });
        console.error(`SKU ${sku} processing error: ${error.message}`);
      }
    }

    results.processingTime = Date.now() - batchStart;
    results.success = results.failedEvents === 0;
    
    // Update stats
    this.updateStats(results);
    
    console.log(`Batch complete: ${results.processedEvents}/${results.totalEvents} processed in ${results.processingTime}ms`);
    
    return results;
  }

  /**
   * Extract unique SKUs from events
   * @param {Array} events - Events to process
   * @returns {Array} Array of unique SKUs
   */
  getUniqueSKUs(events) {
    const skus = new Set();
    
    for (const event of events) {
      const sku = event.sku;
      if (!sku) {
        console.warn('Event without SKU, skipping:', event.id);
        continue;
      }
      
      skus.add(sku);
    }
    
    return Array.from(skus);
  }

  /**
   * Process single SKU
   * @param {string} sku - Product SKU
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing result
   */
  async processSku(sku) {
    const skuStart = Date.now();
    console.log(`Processing SKU: ${sku}`);
    
    try {
      // Step 1: Generate HTML markup using pdp-renderer (includes product data fetching)
      const config = getRuntimeConfig(this.params);
      const context = {
        ...config,
        logger: console,
        aioLibs: { filesLib: this.filesLib }
      };
      
      // Generate HTML - pdp-renderer will fetch product data internally
      // Pass null as urlKey - pdp-renderer will fetch product data and get the real urlKey
      const html = await generateProductHtml(sku, null, context);
      
      if (!html) {
        return {
          success: false,
          error: 'HTML generation failed - product not found or invalid',
          sku: sku,
          processingTime: Date.now() - skuStart
        };
      }
      
      // Generate path using the same logic as check-product-changes
      // Since we don't have urlKey at this point, use SKU as fallback
      const productUrl = getProductUrl({ sku }, context, false).toLowerCase();
      const htmlPath = `/public/pdps${productUrl}.${PDP_FILE_EXT}`;
      
      // Save HTML file using Files SDK
      if (this.filesLib) {
        await this.filesLib.write(htmlPath, html);
      }
      
      console.log(`HTML generated and saved: ${htmlPath}`);
      
      // Step 2: Publish product (rate limited)
      const publishResult = await this.publishProduct(sku, htmlPath);
      
      if (!publishResult.success) {
        return {
          success: false,
          error: `Publishing failed: ${publishResult.error}`,
        sku: sku,
          processingTime: Date.now() - skuStart
        };
      }
      
      const processingTime = Date.now() - skuStart;
      
      return { 
        success: true, 
        sku: sku,
        htmlPath: htmlPath,
        publishResult: publishResult,
        processingTime: processingTime
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        sku: sku,
        processingTime: Date.now() - skuStart
      };
    }
  }



  /**
   * Publish product using AEM Admin API
   * @param {string} sku - Product SKU
   * @param {string} htmlPath - Path to HTML file
   * @returns {Promise<Object>} Publishing result
   */
  async publishProduct(sku, htmlPath) {
    console.log(`Publishing product SKU: ${sku}`);
    
    return await this.rateLimiterManager.execute('publishing', async () => {
      try {
        // Get runtime config
        const config = getRuntimeConfig(this.params, { validateToken: true });
        
        // Create AdminAPI instance
        const adminApi = new AdminAPI({
          adminToken: config.AEM_ADMIN_API_AUTH_TOKEN,
          contentUrl: config.CONTENT_URL,
          logger: console
        });
        
        // Publish the HTML file
        const result = await adminApi.publish([htmlPath]);
        
        if (result && result.success) {
          console.log(`Product published: ${sku} -> ${htmlPath}`);
          return {
            success: true,
            result: result,
            htmlPath: htmlPath
          };
        } else {
          throw new Error(result?.error || 'Publishing failed with unknown error');
        }
        
      } catch (error) {
        console.error(`Publishing error for SKU ${sku}:`, error.message);
        return {
        success: false,
          error: error.message
        };
      }
    });
  }

  /**
   * Update processing statistics
   * @param {Object} results - Batch processing results
   */
  updateStats(results) {
    this.stats.totalEvents += results.totalEvents;
    this.stats.processedEvents += results.processedEvents;
    this.stats.failedEvents += results.failedEvents;
    this.stats.skippedEvents += results.skippedEvents;
    
    // Track error types
    for (const error of results.errors) {
      const errorType = error.error.split(':')[0]; // Get error category
      this.stats.processingErrors[errorType] = (this.stats.processingErrors[errorType] || 0) + 1;
    }
  }

  /**
   * Get processing statistics
   * @returns {Object} Processing stats
   */
  getStats() {
    const successRate = this.stats.totalEvents > 0 
      ? Math.round((this.stats.processedEvents / this.stats.totalEvents) * 100) 
      : 0;

    return {
      ...this.stats,
      successRate: successRate,
      rateLimiterStatus: this.rateLimiterManager ? this.rateLimiterManager.getStatus() : 'not_configured'
    };
  }

  /**
   * Reset processing statistics
   */
  resetStats() {
    this.stats = {
      totalEvents: 0,
      processedEvents: 0,
      failedEvents: 0,
      skippedEvents: 0,
      processingErrors: {}
    };
    console.log('Event processor stats reset');
  }
}

module.exports = { EventProcessor };