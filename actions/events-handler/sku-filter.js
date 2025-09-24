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
 * SKU Filter for Event Processing
 * 
 * Provides filtering mechanisms for events based on SKU patterns, 
 * allow/deny lists, and custom filtering rules.
 */

/**
 * SKU Filter Class
 * Handles filtering of events based on SKU criteria
 */
class SKUFilter {
  constructor(config = {}) {
    this.config = {
      // Default filtering rules
      allowedSKUs: [], // Specific SKUs to allow (empty = allow all)
      deniedSKUs: [], // Specific SKUs to deny
      allowedPatterns: [], // Regex patterns to allow
      deniedPatterns: [], // Regex patterns to deny
      
      // SKU validation rules
      minLength: 1,
      maxLength: 255,
      
      // Caching
      cacheSize: 1000,
      
      logger: console,
      ...config
    };
    
    // Compile regex patterns for performance
    this.compiledAllowedPatterns = this.config.allowedPatterns.map(pattern => new RegExp(pattern));
    this.compiledDeniedPatterns = this.config.deniedPatterns.map(pattern => new RegExp(pattern));
    
    // Simple LRU cache for filter results
    this.filterCache = new Map();
  }

  /**
   * Update filter configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Recompile regex patterns
    this.compiledAllowedPatterns = this.config.allowedPatterns.map(pattern => new RegExp(pattern));
    this.compiledDeniedPatterns = this.config.deniedPatterns.map(pattern => new RegExp(pattern));
    
    // Clear cache when config changes
    this.filterCache.clear();
    
    this.config.logger.info && this.config.logger.info('SKU filter configuration updated', {
      allowedSKUs: this.config.allowedSKUs.length,
      deniedSKUs: this.config.deniedSKUs.length,
      allowedPatterns: this.config.allowedPatterns.length,
      deniedPatterns: this.config.deniedPatterns.length
    });
  }

  /**
   * Validate SKU format
   */
  _validateSKUFormat(sku) {
    if (!sku || typeof sku !== 'string') {
      return { valid: false, reason: 'SKU must be a non-empty string' };
    }
    
    if (sku.length < this.config.minLength) {
      return { valid: false, reason: `SKU too short (min: ${this.config.minLength})` };
    }
    
    if (sku.length > this.config.maxLength) {
      return { valid: false, reason: `SKU too long (max: ${this.config.maxLength})` };
    }
    
    return { valid: true };
  }

  /**
   * Check if SKU matches any pattern in the list
   */
  _matchesPatterns(sku, patterns) {
    return patterns.some(pattern => pattern.test(sku));
  }

  /**
   * Check if SKU is in the list (case-insensitive)
   */
  _inList(sku, list) {
    return list.some(item => item.toLowerCase() === sku.toLowerCase());
  }

  /**
   * Main filtering logic
   */
  _shouldProcessSKU(sku) {
    // 1. Validate SKU format
    const validation = this._validateSKUFormat(sku);
    if (!validation.valid) {
      this.config.logger.debug && this.config.logger.debug('SKU format validation failed', {
        sku,
        reason: validation.reason
      });
      return { allowed: false, reason: validation.reason, stage: 'format_validation' };
    }

    // 2. Check denied SKUs list (highest priority)
    if (this.config.deniedSKUs.length > 0 && this._inList(sku, this.config.deniedSKUs)) {
      this.config.logger.debug && this.config.logger.debug('SKU denied by deny list', { sku });
      return { allowed: false, reason: 'SKU in deny list', stage: 'deny_list' };
    }

    // 3. Check denied patterns
    if (this.compiledDeniedPatterns.length > 0 && this._matchesPatterns(sku, this.compiledDeniedPatterns)) {
      this.config.logger.debug && this.config.logger.debug('SKU denied by deny pattern', { sku });
      return { allowed: false, reason: 'SKU matches deny pattern', stage: 'deny_pattern' };
    }

    // 4. If allow list is defined, SKU must be in it
    if (this.config.allowedSKUs.length > 0 && !this._inList(sku, this.config.allowedSKUs)) {
      this.config.logger.debug && this.config.logger.debug('SKU not in allow list', { sku });
      return { allowed: false, reason: 'SKU not in allow list', stage: 'allow_list' };
    }

    // 5. If allow patterns are defined, SKU must match at least one
    if (this.compiledAllowedPatterns.length > 0 && !this._matchesPatterns(sku, this.compiledAllowedPatterns)) {
      this.config.logger.debug && this.config.logger.debug('SKU does not match allow pattern', { sku });
      return { allowed: false, reason: 'SKU does not match allow pattern', stage: 'allow_pattern' };
    }

    // 6. All checks passed
    this.config.logger.debug && this.config.logger.debug('SKU filter passed', { sku });
    return { allowed: true, reason: 'All filters passed', stage: 'approved' };
  }

  /**
   * Check if event should be processed based on SKU filtering
   */
  shouldProcessEvent(event) {
    try {
      const sku = event?.data?.sku;
      
      if (!sku) {
        this.config.logger.warn && this.config.logger.warn('Event missing SKU', { eventId: event?.id });
        return {
          allowed: false,
          reason: 'Event missing SKU',
          stage: 'missing_sku',
          eventId: event?.id
        };
      }

      // Check cache first
      const cacheKey = `filter_${sku}`;
      if (this.filterCache.has(cacheKey)) {
        const cachedResult = this.filterCache.get(cacheKey);
        this.config.logger.debug && this.config.logger.debug('SKU filter result from cache', {
          sku,
          allowed: cachedResult.allowed,
          eventId: event?.id
        });
        return { ...cachedResult, eventId: event?.id, fromCache: true };
      }

      // Perform filtering
      const result = this._shouldProcessSKU(sku);
      
      // Cache result (with LRU eviction)
      if (this.filterCache.size >= this.config.cacheSize) {
        const firstKey = this.filterCache.keys().next().value;
        this.filterCache.delete(firstKey);
      }
      this.filterCache.set(cacheKey, result);

      this.config.logger.info && this.config.logger.info('SKU filter result', {
        sku,
        eventId: event?.id,
        eventType: event?.type,
        allowed: result.allowed,
        reason: result.reason,
        stage: result.stage
      });

      return { ...result, eventId: event?.id, sku, fromCache: false };

    } catch (error) {
      this.config.logger.error && this.config.logger.error('Error in SKU filtering', {
        error: error.message,
        eventId: event?.id,
        sku: event?.data?.sku
      });
      
      // Fallback: allow event if filtering fails
      return {
        allowed: true,
        reason: 'Filter error - allowing as fallback',
        stage: 'error_fallback',
        eventId: event?.id,
        error: error.message
      };
    }
  }

  /**
   * Get current filter statistics
   */
  getStatistics() {
    return {
      cacheSize: this.filterCache.size,
      maxCacheSize: this.config.cacheSize,
      config: {
        allowedSKUs: this.config.allowedSKUs.length,
        deniedSKUs: this.config.deniedSKUs.length,
        allowedPatterns: this.config.allowedPatterns.length,
        deniedPatterns: this.config.deniedPatterns.length,
        minLength: this.config.minLength,
        maxLength: this.config.maxLength
      }
    };
  }

  /**
   * Clear filter cache
   */
  clearCache() {
    this.filterCache.clear();
    this.config.logger.info && this.config.logger.info('SKU filter cache cleared');
  }
}

/**
 * Predefined filter configurations
 */
const FILTER_PRESETS = {
  // Allow all SKUs (no filtering)
  ALLOW_ALL: {
    allowedSKUs: [],
    deniedSKUs: [],
    allowedPatterns: [],
    deniedPatterns: []
  },
  
  // Only allow product SKUs (exclude test/temp SKUs)
  PRODUCTS_ONLY: {
    allowedPatterns: ['^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$'], // Alphanumeric with hyphens/underscores
    deniedPatterns: ['^test_', '^temp_', '^demo_', '^sample_'], // Exclude test products
    deniedSKUs: ['test', 'demo', 'sample']
  },
  
  // Only specific product prefixes
  SPECIFIC_PREFIXES: {
    allowedPatterns: ['^prod_', '^24-'], // Only products starting with 'prod_' or '24-'
    deniedPatterns: ['^prod_test_'] // Exclude test products even with prod prefix
  }
};

module.exports = { SKUFilter, FILTER_PRESETS };
