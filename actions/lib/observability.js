class ObservabilityClient {
  constructor(nativeLogger, options = {}) {
      this.nativeLogger = nativeLogger;
      this.activationId = process.env.__OW_ACTIVATION_ID;
      this.namespace = process.env.__OW_NAMESPACE;
      this.instanceStartTime = Date.now();
      this.options = options;
      this.org = options.org;
      this.site = options.site;
      this.endpoint = options.endpoint;
  }

  getEndpoints(type) {
    const endpointsMap = {
      activationResults: `${this.endpoint}/${this.org}/${this.site}/activations`,
      logs: `${this.endpoint}/${this.org}/${this.site}/logs`,
    };
    return endpointsMap[type];
  }

  async #sendRequestToObservability(type, payload) {
      try {
        const logEndpoint = this.getEndpoints(type);
    
        if (logEndpoint) {
          await fetch(logEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.options.token}`,
          },
            body: JSON.stringify(payload),
          });
        }
      } catch (error) {
        this.nativeLogger.debug(`[ObservabilityClient] Failed to send to observability endpoint '${type}': ${error.message}`, { error });
      }
    }

  /**
   * Sends a single activation log entry to the observability endpoint.
   * @param {object} activationData The JSON object representing the activation log.
   * @returns {Promise<void>} A promise that resolves when the log is sent, or rejects on error.
   */
  async sendActivationResult(result) {
      if (!result || typeof result !== 'object') {
          return;
      }

      const payload = {
          environment: `${this.namespace}`,
          timestamp: this.instanceStartTime,
          result,
          activationId: this.activationId,
      };

      await this.#sendRequestToObservability('activationResults', payload);
  }

  logger = {
    debug: async (...args) => {
      this.nativeLogger.debug(...args);
    },
    info: async(...args) => {
      this.nativeLogger.info(...args);
    },
    error: async (...args) => {
      this.nativeLogger.error(...args);
    },
  }
}

module.exports = { ObservabilityClient };
