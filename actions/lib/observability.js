class ObservabilityClient {
  constructor(nativeLogger, options = {}) {
      this.activationId = process.env.__OW_ACTIVATION_ID;
      this.namespace = process.env.__OW_NAMESPACE;
      this.instanceStartTime = Date.now();
      this.options = options;
      this.org = options.org;
      this.site = options.site;
      this.endpoint = options.endpoint;
      this.nativeLogger = nativeLogger;
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

    severityMap = {
      'DEBUG': 1,
      'VERBOSE': 2,
      'INFO': 3,
      'WARNING': 4,
      'ERROR': 5,
      'CRITICAL': 6,
    }

    stateToSeverity(state) {
      const stateToSeverityMap = {
        skipped: 'DEBUG',
        completed: 'INFO',
        failure: 'ERROR',
      };

      return this.severityMap[stateToSeverityMap[state]] || this.severityMap['DEBUG'];
    }

  /**
   * Sends a single activation log entry to the observability endpoint.
   * @param {object} result The JSON object representing the activation log.
   * @returns {Promise<void>} A promise that resolves when the log is sent, or rejects on error.
   */
  async sendActivationResult(result) {
      if (!result || typeof result !== 'object') {
          return;
      }

      let severity = this.stateToSeverity(result.state);

      if (result?.status?.failed > 0) {
        severity = this.severityMap['WARNING'];
      }

      const payload = {
          environment: `${this.namespace}`,
          timestamp: this.instanceStartTime,
          result,
          severity,
          activationId: this.activationId,
      };

      await this.#sendRequestToObservability('activationResults', payload);
  }
}

module.exports = { ObservabilityClient };
