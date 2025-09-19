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

const { Core, State, Files } = require('@adobe/aio-sdk');
const { poll } = require('./poller');
const { StateManager } = require('../lib/state');
const { ObservabilityClient } = require('../lib/observability');
const { getRuntimeConfig } = require('../lib/runtimeConfig');
const { handleActionError } = require('../lib/errorHandler');

/**
 * Entry point for the "Product changes check" action.
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function main(params) {
    let logger;

    try {
        // Load runtime configuration and validate token
        const cfg = getRuntimeConfig(params, { validateToken: true });
        logger = Core.Logger('main', { level: cfg.logLevel });

        // Initialize observability (best-effort usage later)
        const observabilityClient = new ObservabilityClient(logger, {
            token: cfg.adminAuthToken,
            endpoint: cfg.logIngestorEndpoint,
            org: cfg.org,
            site: cfg.site
        });

        // Init SDK libs and state manager
        const stateLib = await State.init(params.libInit || {});
        const filesLib = await Files.init(params.libInit || {});
        const stateMgr = new StateManager(stateLib, { logger });

        let activationResult;

        // Skip if previous run still marked as "running"
        const running = await stateMgr.get('running');
        if (running?.value === 'true') {
            activationResult = { state: 'skipped' };

            // Observability is best-effort and must not fail the action
            try {
                await observabilityClient.sendActivationResult(activationResult);
            } catch (obsErr) {
                logger.warn('Failed to send activation result (skipped).', obsErr);
            }

            return activationResult;
        }

        try {
            // Mark job as running with TTL to avoid permanent lock on unexpected failures
            await stateMgr.put('running', 'true', { ttl: 3600 });

            // Core logic
            activationResult = await poll(cfg, { stateLib: stateMgr, filesLib }, logger);
        } finally {
            // Always reset running flag
            try {
                await stateMgr.put('running', 'false');
            } catch (stateErr) {
                // Do not throw from finally; just log
                (logger || Core.Logger('main', { level: 'error' }))
                    .error('Failed to reset running state.', stateErr);
            }
        }

        // Report result (best effort)
        try {
            await observabilityClient.sendActivationResult(activationResult);
        } catch (obsErr) {
            logger.warn('Failed to send activation result.', obsErr);
        }

        return activationResult;
    } catch (error) {
        // If logger not ready, create error-level one
        logger = logger || Core.Logger('main', { level: 'error' });

        // Poll/processing errors are critical
        return handleActionError(error, {
            logger,
            actionName: 'Product changes check'
        });
    }
}

exports.main = main