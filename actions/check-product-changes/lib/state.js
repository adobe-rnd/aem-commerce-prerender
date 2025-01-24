
class StateManager {
    /**
     * Constructs a new StateManager instance.
     * @param {number} [retryCount=5] - Number of retry attempts for failed operations (default: 5).
     * @param {number} [retryDelay=1] - Delay between retries in seconds (default: 10s).
     */
    constructor(state, { logger }, retryCount = 5, retryDelay = 10) {
        this.retryCount = retryCount > 0 ? retryCount : 1;
        this.retryDelay = retryDelay * 1000;
        this.logger = logger;
        this.state = state;
    }

    /**
     * Retrieves a value from the state library.
     * @param {string} key - The key to retrieve the value for.
     * @returns {Promise<any>} - The value associated with the key.
     * @throws {Error} - If the operation fails after all retry attempts.
     */
    async get(key) {
        return this._retry(async () => await this.state.get(key));
    }

    /**
     * Sets a key-value pair in the state library.
     * Retries the operation in case of failure up to the configured retry count.
     * @param {string} key - The key to set.
     * @param {string} value - The value to associate with the key.
     * @param {number} [ttl=86400] Entry expiration time in seconds. (default: 86400s (24h)).
     * @returns {Promise<string>} - Key for entry
     * @throws {Error} - If the operation fails after all retry attempts.
     */
    async put(key, value, ttl = 86400) {
        return this._retry(async () => await this.state.put(key, value, { ttl: ttl }));
    }

    /**
     * Internal method to retry an operation with delay and max retries.
     * @private
     * @param {Function} operation - The asynchronous operation to execute.
     * @returns {Promise<any>} - The result of the operation if successful.
     * @throws {Error} - If the operation fails after all retry attempts.
     */
    async _retry(operation) {
        let attempt = 0;
        let lastError = null;
        while (attempt < this.retryCount) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                attempt++;
                this.logger.warning(`State error encountered, attempting retry ${attempt}: ${error.message}`);
                await new Promise((r) => setTimeout(r, this.retryDelay));
            }
        }
        this.logger.error(`Fatal state error giving up.`);
        throw lastError;
    }
}

module.exports = { StateManager };