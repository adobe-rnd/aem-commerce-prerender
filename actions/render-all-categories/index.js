/*
Copyright 2026 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

const { Core, State, Files } = require('@adobe/aio-sdk');
const { poll } = require('./poller');
const { StateManager } = require('../lib/state');
const { ObservabilityClient } = require('../lib/observability');
const { getRuntimeConfig } = require('../lib/runtimeConfig');
const { handleActionError } = require('../lib/errorHandler');

/**
 * Entry point for the "Render all categories" action.
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function main(params) {
  let logger;

  try {
    const cfg = getRuntimeConfig(params, { validateToken: true });
    logger = Core.Logger('main', { level: cfg.logLevel });

    const observabilityClient = new ObservabilityClient(logger, {
      token: cfg.adminAuthToken,
      endpoint: cfg.logIngestorEndpoint,
      org: cfg.org,
      site: cfg.site,
    });

    const stateLib = await State.init(params.libInit || {});
    const filesLib = await Files.init(params.libInit || {});
    const stateMgr = new StateManager(stateLib, { logger });

    let activationResult;

    const running = await stateMgr.get('plp-running');
    if (running?.value === 'true') {
      activationResult = { state: 'skipped' };

      try {
        await observabilityClient.sendActivationResult(activationResult);
      } catch (obsErr) {
        logger.warn('Failed to send activation result (skipped).', obsErr);
      }

      return activationResult;
    }

    try {
      await stateMgr.put('plp-running', 'true', { ttl: 3600 });

      activationResult = await poll(cfg, { stateLib: stateMgr, filesLib }, logger);
    } finally {
      try {
        await stateMgr.put('plp-running', 'false');
      } catch (stateErr) {
        (logger || Core.Logger('main', { level: 'error' })).error('Failed to reset running state.', stateErr);
      }
    }

    try {
      await observabilityClient.sendActivationResult(activationResult);
    } catch (obsErr) {
      logger.warn('Failed to send activation result.', obsErr);
    }

    return activationResult;
  } catch (error) {
    logger = logger || Core.Logger('main', { level: 'error' });

    return handleActionError(error, {
      logger,
      actionName: 'Render all categories',
    });
  }
}

exports.main = main;
