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
      const message = args.map(arg => arg instanceof Error ? arg.message : String(arg)).join(' ');
      this.sendLogEvent(message, 'DEBUG');
      this.nativeLogger.debug(...args);
    },
    info: async(...args) => {
      const message = args.map(arg => arg instanceof Error ? arg.message : String(arg)).join(' ');
      this.sendLogEvent(message, 'INFO');
      this.nativeLogger.info(...args);
    },
    error: async (...args) => {
      const message = args.map(arg => arg instanceof Error ? arg.message : String(arg)).join(' ');
      this.sendLogEvent(message, 'ERROR');
      this.nativeLogger.error(...args);
    },
  }

  /**
   * Sends a log event to the observability endpoint.
   * @param {string} message The log message.
   * @param {string} severity The log severity.
   * @returns {Promise<void>} A promise that resolves when the log is sent, or rejects on error.
   */
  async sendLogEvent(message, severity = 'INFO') {
      const severityMap = {
          'DEBUG': 1,
          'VERBOSE': 2,
          'INFO': 3,
          'WARNING': 4,
          'ERROR': 5,
          'CRITICAL': 6,
      };

      const payload = {
          environment: `${this.namespace}`,
          timestamp: Date.now(),
          message,
          activationId: `${this.activationId}`,
          severity: severityMap[severity] || 2,
      };

      await this.#sendRequestToObservability('logs', payload);
  }
}

module.exports = { ObservabilityClient };
