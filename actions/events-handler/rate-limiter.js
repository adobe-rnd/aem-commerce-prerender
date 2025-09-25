/**
 * Rate Limiter for Event Processing
 * 
 * Implements token bucket algorithm to limit requests to 10 per second.
 * Manages separate limits for GraphQL queries and publishing requests.
 * 
 * Features:
 * - Token bucket algorithm for smooth rate limiting
 * - Separate buckets for different operations
 * - Configurable rates and burst capacity
 * - Async/await support with queuing
 * - Memory efficient implementation
 */

/**
 * Rate Limiter class using token bucket algorithm
 */
class RateLimiter {
  constructor(options = {}) {
    // Default configuration: 10 requests per second
    this.maxTokens = options.maxTokens || 10;      // Bucket capacity
    this.refillRate = options.refillRate || 10;    // Tokens per second
    this.refillInterval = 1000;                    // 1 second in ms
    
    // Current state
    this.tokens = this.maxTokens;                  // Start with full bucket
    this.lastRefill = Date.now();
    
    // Request queue for when bucket is empty
    this.requestQueue = [];
    this.isProcessingQueue = false;
    
    // Stats for monitoring
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      queuedRequests: 0,
      averageWaitTime: 0
    };
    
    console.log(`Rate limiter initialized: ${this.refillRate} req/sec, burst: ${this.maxTokens}`);
  }

  /**
   * Refill tokens based on elapsed time
   */
  refillTokens() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    
    if (elapsed >= this.refillInterval) {
      const intervals = Math.floor(elapsed / this.refillInterval);
      const tokensToAdd = intervals * this.refillRate;
      
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
      
      // Process queue if we have tokens
      if (this.tokens > 0 && this.requestQueue.length > 0) {
        this.processQueue();
      }
    }
  }

  /**
   * Acquire a token (with optional waiting)
   * @param {Object} options - Request options
   * @param {number} options.timeout - Max wait time in ms (default: 30000)
   * @returns {Promise<boolean>} True if token acquired
   */
  async acquire(options = {}) {
    const timeout = options.timeout || 30000; // 30 second default timeout
    const requestStart = Date.now();
    
    this.stats.totalRequests++;
    
    // Try immediate acquisition
    this.refillTokens();
    
    if (this.tokens > 0) {
      this.tokens--;
      this.stats.allowedRequests++;
      return true;
    }
    
    // No tokens available, queue the request
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove from queue on timeout
        const index = this.requestQueue.findIndex(req => req.timeoutId === timeoutId);
        if (index !== -1) {
          this.requestQueue.splice(index, 1);
        }
        reject(new Error(`Rate limit timeout after ${timeout}ms`));
      }, timeout);
      
      this.requestQueue.push({
        resolve,
        reject,
        timeoutId,
        requestStart
      });
      
      this.stats.queuedRequests++;
      
      // Try to process queue immediately
      this.processQueue();
    });
  }

  /**
   * Process queued requests
   */
  processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    // Process requests while we have tokens
    while (this.tokens > 0 && this.requestQueue.length > 0) {
      this.refillTokens(); // Refill before each check
      
      if (this.tokens > 0) {
        const request = this.requestQueue.shift();
        this.tokens--;
        
        // Calculate wait time for stats
        const waitTime = Date.now() - request.requestStart;
        this.updateAverageWaitTime(waitTime);
        
        // Clear timeout and resolve
        clearTimeout(request.timeoutId);
        this.stats.allowedRequests++;
        request.resolve(true);
      }
    }
    
    this.isProcessingQueue = false;
  }

  /**
   * Update average wait time statistics
   * @param {number} waitTime - Wait time for this request
   */
  updateAverageWaitTime(waitTime) {
    const alpha = 0.1; // Exponential moving average factor
    this.stats.averageWaitTime = (this.stats.averageWaitTime * (1 - alpha)) + (waitTime * alpha);
  }

  /**
   * Sleep for specified duration
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for rate limit with automatic retry
   * @param {Function} operation - Async operation to execute
   * @param {Object} options - Options
   * @returns {Promise} Operation result
   */
  async execute(operation, options = {}) {
    const maxRetries = options.maxRetries || 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Acquire token before executing
        const acquired = await this.acquire(options);
        
        if (acquired) {
          return await operation();
        }
        
      } catch (error) {
        lastError = error;
        console.warn(`Warning: Rate limit attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Max 5s delay
          await this.sleep(delay);
        }
      }
    }
    
    throw lastError || new Error('Rate limit execution failed');
  }

  /**
   * Get current rate limiter status
   * @returns {Object} Status information
   */
  getStatus() {
    this.refillTokens(); // Update tokens before reporting
    
    return {
      tokens: this.tokens,
      maxTokens: this.maxTokens,
      refillRate: this.refillRate,
      queueLength: this.requestQueue.length,
      stats: { ...this.stats },
      utilizationPercent: Math.round((1 - (this.tokens / this.maxTokens)) * 100)
    };
  }

  /**
   * Reset rate limiter state
   */
  reset() {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    
    // Clear queue
    this.requestQueue.forEach(req => {
      clearTimeout(req.timeoutId);
      req.reject(new Error('Rate limiter reset'));
    });
    this.requestQueue = [];
    
    // Reset stats
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      queuedRequests: 0,
      averageWaitTime: 0
    };
    
    console.log('Rate limiter reset');
  }
}

/**
 * Rate Limiter Manager for different operation types
 */
class RateLimiterManager {
  constructor() {
    // Separate rate limiters for different operations
    this.limiters = {
      // GraphQL API calls - 10 req/sec
      graphql: new RateLimiter({
        maxTokens: 10,
        refillRate: 10
      }),
      
      // Publishing API calls - 10 req/sec (shared with GraphQL for simplicity)
      publishing: new RateLimiter({
        maxTokens: 10,
        refillRate: 10
      }),
      
      // Default limiter for other operations
      default: new RateLimiter({
        maxTokens: 10,
        refillRate: 10
      })
    };
    
    console.log('Rate limiter manager initialized with separate limits');
  }

  /**
   * Get rate limiter for operation type
   * @param {string} type - Operation type ('graphql', 'publishing', 'default')
   * @returns {RateLimiter} Rate limiter instance
   */
  getLimiter(type = 'default') {
    return this.limiters[type] || this.limiters.default;
  }

  /**
   * Execute operation with appropriate rate limiting
   * @param {string} type - Operation type
   * @param {Function} operation - Async operation to execute
   * @param {Object} options - Options
   * @returns {Promise} Operation result
   */
  async execute(type, operation, options = {}) {
    const limiter = this.getLimiter(type);
    return await limiter.execute(operation, options);
  }

  /**
   * Get status of all rate limiters
   * @returns {Object} Status of all limiters
   */
  getStatus() {
    const status = {};
    
    for (const [type, limiter] of Object.entries(this.limiters)) {
      status[type] = limiter.getStatus();
    }
    
    return status;
  }

  /**
   * Reset all rate limiters
   */
  resetAll() {
    for (const limiter of Object.values(this.limiters)) {
      limiter.reset();
    }
    console.log('All rate limiters reset');
  }
}

module.exports = { RateLimiter, RateLimiterManager };
