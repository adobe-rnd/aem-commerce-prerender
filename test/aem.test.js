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

const { AdminAPI } = require('../actions/lib/aem');
const { request } = require('../actions/utils');

jest.mock('../actions/utils', () => ({
    request: jest.fn(),
}));

describe('AdminAPI Optimized Tests', () => {
    let adminAPI;
    const context = { logger: { info: jest.fn(), error: jest.fn() } };

    beforeEach(() => {
        adminAPI = new AdminAPI(
            { org: 'testOrg', site: 'testSite' },
            context,
            { requestPerSecond: 5, publishBatchSize: 100, authToken: 'testToken' }
        );
        jest.useFakeTimers();
        // Remove setInterval/clearInterval spies as we're not using them anymore
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('should initialize with correct parameters', () => {
        expect(adminAPI.org).toBe('testOrg');
        expect(adminAPI.site).toBe('testSite');
        expect(adminAPI.publishBatchSize).toBe(100);
        expect(adminAPI.authToken).toBe('testToken');
    });

    test('should add record to previewQueue on previewAndPublish', async () => {
        const record = { path: '/test' };
        adminAPI.previewAndPublish(record);
        expect(adminAPI.previewQueue).toHaveLength(1);
        await Promise.resolve();
    });

    test('should add record to unpublishQueue on unpublishAndDelete', async () => {
        const record = { path: '/test' };
        adminAPI.unpublishAndDelete(record);
        expect(adminAPI.unpublishQueue).toHaveLength(1);
        await Promise.resolve();
    });

    test('should start processing queues with promise chain', async () => {
        const processingPromise = adminAPI.startProcessing();
        expect(processingPromise).toBeInstanceOf(Promise);
        
        // Wait for processing to complete (should be quick with no work)
        await processingPromise;
        expect(adminAPI.isProcessing).toBe(false);
    });

    test('should stop processing queues gracefully', async () => {
        const processingPromise = adminAPI.startProcessing();
        
        // Immediately stop processing
        const stopPromise = adminAPI.stopProcessing();
        expect(stopPromise).toBeInstanceOf(Promise);
        
        await stopPromise;
        expect(adminAPI.isProcessing).toBe(false);
    });

    test('should execute admin request', async () => {
        await adminAPI.execAdminRequest('POST', 'preview', '/test', { data: 'test' });
        expect(request).toHaveBeenCalledWith('preview', 'https://admin.hlx.page/preview/testOrg/testSite/main/test', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-auth-token': 'testToken',
                'User-Agent': 'AEM Commerce Poller / 1.0',
            },
            body: JSON.stringify({ data: 'test' }),
        });
    });

    test('should process preview queue', async () => {
        const batch = [{ path: '/test' }, { path: '/test2' }];
        adminAPI.previewQueue.push({ records: batch, resolve: jest.fn() });
        adminAPI.processQueues();
        expect(context.logger.info).toHaveBeenCalledWith('Queues: preview=1, publish=0, unpublish live=0, unpublish preview=0, inflight=0, in queue=0');
    });

    test('should process publish queue', async () => {
        const batch = [{ path: '/test' }, { path: '/test2' }];
        adminAPI.publishQueue.push({ records: batch, resolve: jest.fn() });
        adminAPI.processQueues();
        expect(context.logger.info).toHaveBeenCalledWith('Queues: preview=0, publish=1, unpublish live=0, unpublish preview=0, inflight=0, in queue=0');
    });

    test('should process unpublish live queue', async () => {
        const batch = [{ path: '/test' }, { path: '/test2' }];
        adminAPI.unpublishQueue.push({ records: batch, resolve: jest.fn() });
        adminAPI.processQueues();
        expect(context.logger.info).toHaveBeenCalledWith('Queues: preview=0, publish=0, unpublish live=1, unpublish preview=0, inflight=0, in queue=0');
    });

    test('should process unpublish preview queue', async () => {
        const batch = [{ path: '/test' }, { path: '/test2' }];
        adminAPI.unpublishPreviewQueue.push({ records: batch, resolve: jest.fn() });
        adminAPI.processQueues();
        expect(context.logger.info).toHaveBeenCalledWith('Queues: preview=0, publish=0, unpublish live=0, unpublish preview=1, inflight=0, in queue=0');
    });

    test('should handle promise chain processing gracefully', async () => {
        // Test that the promise chain can handle empty queues
        const processingPromise = adminAPI.startProcessing();
        
        // Should complete quickly when no work to do
        await processingPromise;
        
        expect(adminAPI.isProcessing).toBe(false);
    }, 10000);

    test('should handle errors in promise chain', async () => {
        // Mock an error in processing
        const originalProcessNextBatch = adminAPI.processNextBatch;
        adminAPI.processNextBatch = jest.fn().mockRejectedValue(new Error('Test error'));
        
        const processingPromise = adminAPI.startProcessing();
        
        // Should complete despite errors
        await processingPromise;
        
        expect(adminAPI.isProcessing).toBe(false);
        
        // Restore original method
        adminAPI.processNextBatch = originalProcessNextBatch;
    }, 10000);
});
