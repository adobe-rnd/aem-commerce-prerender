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

const { checkTokenExpiration } = require('./tokenValidator');

/**
 * Check API key expiration and send alerts if needed
 * @param {string} token - The API token to check
 * @param {Object} stateMgr - State manager for tracking last check
 * @param {Object} observabilityClient - Client for sending alerts
 * @param {Object} logger - Logger instance
 */
async function checkAndAlertTokenExpiration(token, stateMgr, observabilityClient, logger) {
    const alertThresholdDays = 30;  // Alert when token expires in 30 days or less
    const checkIntervalMs = 24 * 60 * 60 * 1000;  // 24 hours

    const lastTokenCheck = await stateMgr.get('lastTokenCheck');
    const now = new Date();
    const intervalAgo = new Date(now.getTime() - checkIntervalMs);

    if (!lastTokenCheck || new Date(lastTokenCheck.value) < intervalAgo) {
        const tokenInfo = checkTokenExpiration(token);
        if (tokenInfo.isValid) {
            const { daysUntilExpiration } = tokenInfo;

            if (daysUntilExpiration < alertThresholdDays) {

                const message = `AEM Admin API key expires in ${daysUntilExpiration} days`;

                try {
                    await observabilityClient.sendApiKeyAlert({
                        daysUntilExpiration,
                        message,
                        recommendedAction: 'Contact AEM project lead to generate new API key'
                    });
                } catch (alertErr) {
                    logger.warn('Failed to send API key expiration alert.', alertErr);
                }
            }
        }
        await stateMgr.put('lastTokenCheck', now.toISOString());
    }
}

module.exports = {
    checkAndAlertTokenExpiration
};
