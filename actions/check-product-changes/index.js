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

async function main(params) {
  const rtLogger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' });
  const observabilityClient = new ObservabilityClient(rtLogger, { token: params.authToken, endpoint: 'https://blazerank-logs-ingestor.adobeaem.workers.dev/api/v1/services/change-detector' });
  const {logger} = observabilityClient;
  const stateLib = await State.init(params.libInit || {});
  const filesLib = await Files.init(params.libInit || {});
  const stateMgr = new StateManager(stateLib, { logger });

  let activationResult = null;

  const running = await stateMgr.get('running');
  if (running?.value === 'true') {
    activationResult = { state: 'skipped' };
    await observabilityClient.sendActivationResult(activationResult);
    return activationResult;
  }

  try {
    // if there is any failure preventing a reset of the 'running' state key to 'false',
    // this might not be updated and action execution could be permanently skipped
    // a ttl == function timeout is a mitigation for this risk
    await stateMgr.put('running', 'true', { ttl: 3600 });
    activationResult = await poll(params, { stateLib: stateMgr, filesLib }, logger);
  } finally {
    await stateMgr.put('running', 'false');
  }

  await observabilityClient.sendActivationResult(activationResult);
  return activationResult;
}

exports.main = main
