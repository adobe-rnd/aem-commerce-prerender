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
 * Rate Limiter for Publishing Events
 * 
 * Manages rate limiting to ensure no more than 20 publishing requests per second
 * Uses token bucket algorithm with Adobe I/O Runtime State for persistence
 */

const { State } = require('@adobe/aio-lib-state');

/**
 * Token Bucket Rate Limiter
 * Implements rate limiting using token bucket algorithm with persistent state
 */
class RateLimiter {
  constructor(config = {}) {
    this.config = {
      maxTokens: 20, // Maximum tokens (requests per second)
      refillRate: 20, // Tokens refilled per second
      keyPrefix: 'rate_limiter_',
      bucketKey: 'publishing_bucket',
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
      this.config.logger.debug && this.config.logger.debug('Rate limiter State service initialized');
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Failed to initialize Rate limiter State service', error);
      throw error;
    }
  }

  /**
   * Get current bucket state from persistent storage
   */
  async _getBucketState() {
    await this._init();
    
    try {
      const bucketKey = `${this.config.keyPrefix}${this.config.bucketKey}`;
      const { value } = await this.state.get(bucketKey);
      
      if (value) {
        const bucketData = JSON.parse(value);
        return {
          tokens: bucketData.tokens,
          lastRefill: new Date(bucketData.lastRefill),
          requests: bucketData.requests || []
        };
      }
      
      // Initialize new bucket
      return {
        tokens: this.config.maxTokens,
        lastRefill: new Date(),
        requests: []
      };
      
    } catch (error) {
      this.config.logger.warn && this.config.logger.warn('Error getting bucket state, using defaults', { error: error.message });
      return {
        tokens: this.config.maxTokens,
        lastRefill: new Date(),
        requests: []
      };
    }
  }

  /**
   * Save bucket state to persistent storage
   */
  async _saveBucketState(bucketState) {
    await this._init();
    
    try {
      const bucketKey = `${this.config.keyPrefix}${this.config.bucketKey}`;
      const bucketData = {
        tokens: bucketState.tokens,
        lastRefill: bucketState.lastRefill.toISOString(),
        requests: bucketState.requests
      };
      
      // TTL: 2 minutes (longer than needed for rate limiting window)
      await this.state.put(bucketKey, JSON.stringify(bucketData), { ttl: 120 });
      
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Error saving bucket state', error);
      // Don't throw - rate limiting should be resilient
    }
  }

  /**
   * Refill tokens based on elapsed time
   */
  _refillTokens(bucketState) {
    const now = new Date();
    const timeDiff = (now.getTime() - bucketState.lastRefill.getTime()) / 1000; // seconds
    
    if (timeDiff > 0) {
      const tokensToAdd = Math.floor(timeDiff * this.config.refillRate);
      bucketState.tokens = Math.min(this.config.maxTokens, bucketState.tokens + tokensToAdd);
      bucketState.lastRefill = now;
    }
    
    return bucketState;
  }

  /**
   * Clean old request timestamps (older than 1 second)
   */
  _cleanOldRequests(bucketState) {
    const now = new Date();
    const oneSecondAgo = now.getTime() - 1000;
    
    bucketState.requests = bucketState.requests.filter(timestamp => timestamp > oneSecondAgo);
    
    return bucketState;
  }

  /**
   * Check if request can be processed (rate limit check)
   */
  async canProcess() {
    try {
      let bucketState = await this._getBucketState();
      
      // Refill tokens and clean old requests
      bucketState = this._refillTokens(bucketState);
      bucketState = this._cleanOldRequests(bucketState);
      
      // Check if we have tokens available
      if (bucketState.tokens > 0) {
        // Consume a token
        bucketState.tokens--;
        bucketState.requests.push(new Date().getTime());
        
        // Save updated state
        await this._saveBucketState(bucketState);
        
        this.config.logger.debug && this.config.logger.debug('Rate limit check passed', {
          tokensRemaining: bucketState.tokens,
          requestsInLastSecond: bucketState.requests.length
        });
        
        return {
          allowed: true,
          tokensRemaining: bucketState.tokens,
          requestsInLastSecond: bucketState.requests.length
        };
      } else {
        this.config.logger.warn && this.config.logger.warn('Rate limit exceeded', {
          tokensRemaining: bucketState.tokens,
          requestsInLastSecond: bucketState.requests.length,
          maxRequests: this.config.maxTokens
        });
        
        return {
          allowed: false,
          tokensRemaining: bucketState.tokens,
          requestsInLastSecond: bucketState.requests.length,
          retryAfterMs: 1000 // Suggest retry after 1 second
        };
      }
      
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Error in rate limit check', error);
      
      // Fallback: allow request if rate limiting fails
      this.config.logger.warn && this.config.logger.warn('Rate limiting failed, allowing request as fallback');
      return {
        allowed: true,
        tokensRemaining: 0,
        requestsInLastSecond: 0,
        fallback: true
      };
    }
  }

  /**
   * Get current rate limit status
   */
  async getStatus() {
    try {
      let bucketState = await this._getBucketState();
      bucketState = this._refillTokens(bucketState);
      bucketState = this._cleanOldRequests(bucketState);
      
      return {
        tokensRemaining: bucketState.tokens,
        maxTokens: this.config.maxTokens,
        requestsInLastSecond: bucketState.requests.length,
        refillRate: this.config.refillRate,
        lastRefill: bucketState.lastRefill
      };
      
    } catch (error) {
      this.config.logger.error && this.config.logger.error('Error getting rate limit status', error);
      return {
        tokensRemaining: 0,
        maxTokens: this.config.maxTokens,
        requestsInLastSecond: 0,
        refillRate: this.config.refillRate,
        error: error.message
      };
    }
  }
}

module.exports = { RateLimiter };
