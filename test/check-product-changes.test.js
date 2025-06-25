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

const assert = require('node:assert/strict');
const { loadState, saveState, getFileLocation, poll } = require('../actions/check-product-changes/poller');
const Files = require('./__mocks__/files');
const { AdminAPI } = require('../actions/lib/aem');
const { requestSaaS, requestSpreadsheet, isValidUrl } = require('../actions/utils');
const { MockState } = require('./__mocks__/state');

const EXAMPLE_STATE = 'sku1,1,\nsku2,2,\nsku3,3,';

const EXAMPLE_EXPECTED_STATE = {
  locale: 'uk',
  skus: {
    sku1: {
      lastPreviewedAt: new Date(1),
      hash: '',
    },
    sku2: {
      lastPreviewedAt: new Date(2),
      hash: '',
    },
    sku3: {
      lastPreviewedAt: new Date(3),
      hash: '',
    },
  },
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock('../actions/utils', () => ({
  requestSaaS: jest.fn(),
  requestSpreadsheet: jest.fn(),
  isValidUrl: jest.fn(() => true),
  getProductUrl: jest.fn(({ urlKey, sku }) => `/${urlKey || sku}`),
  getDefaultStoreURL: jest.fn(() => 'https://content.com'),
  formatMemoryUsage: jest.fn(() => '100MB'),
  FILE_PREFIX: 'check-product-changes',
  STATE_FILE_EXT: 'csv',
  PDP_FILE_EXT: 'html',
}));

jest.spyOn(AdminAPI.prototype, 'startProcessing').mockImplementation(jest.fn());
jest.spyOn(AdminAPI.prototype, 'stopProcessing').mockImplementation(jest.fn());
jest.spyOn(AdminAPI.prototype, 'unpublishAndDelete').mockImplementation(jest.fn());
jest.spyOn(AdminAPI.prototype, 'previewAndPublish').mockImplementation((batch) => {
  return Promise.resolve({
    records: batch.map(({ sku }) => ({
      sku,
      previewedAt: sku === 'sku-failed-due-preview' ? null : new Date(),
      publishedAt: sku === 'sku-failed-due-publishing' ? null : new Date(),
    }))
  });
});

jest.mock('../actions/pdp-renderer/render', () => ({
  generateProductHtml: jest.fn().mockImplementation((sku) => {
    if (sku === 'sku-123') return '<html>Product 123</html>';
    if (sku === 'sku-456') return '<html>Product 456</html>';
    if (sku === 'sku-789') return '<html>Product 789</html>';
    if (sku === 'sku-failed-due-preview') return '<html>Failed Preview</html>';
    if (sku === 'sku-failed-due-publishing') return '<html>Failed Publishing</html>';
    return `<html>Product ${sku}</html>`;
  }),
}));

// Add mock for crypto to return predictable hashes
jest.mock('crypto', () => {
  const originalModule = jest.requireActual('crypto');
  return {
    ...originalModule,
    createHash: jest.fn().mockImplementation(() => {
      return {
        update: jest.fn().mockImplementation((content) => {
          return {
            digest: jest.fn().mockImplementation(() => {
              if (content === '<html>Product 123</html>') return 'current-hash-for-product-123';
              if (content === '<html>Product 456</html>') return 'current-hash-for-product-456';
              if (content === '<html>Product 789</html>') return 'current-hash-for-product-789';
              return 'default-hash';
            })
          };
        })
      };
    })
  };
});

describe('Poller', () => {
  // Common test fixtures
  const mockFiles = () => ({
    read: jest.fn().mockResolvedValue(null),
    write: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(null),
  });

  const mockState = () => ({
    get: jest.fn().mockResolvedValue(null),
    put: jest.fn().mockResolvedValue(null),
  });

  const defaultParams = {
    ORG: 'orgName',
    SITE: 'siteName',
    CONTENT_URL: 'https://content.com',
    STORE_URL: 'https://store.com',
    PRODUCTS_TEMPLATE: 'https://store.com/products/default',
    PRODUCT_PAGE_URL_FORMAT: 'products/{urlKey}/{sku}',
    CONFIG_NAME: 'configName',
    AEM_ADMIN_AUTH_TOKEN: 'token',
  };

  const setupSkuData = (filesLib, stateLib, skuData, lastQueriedAt) => {
    const skuEntries = Object.entries(skuData).map(([sku, { timestamp, hash = '' }]) => 
      `${sku},${timestamp},${hash}`
    ).join('\n');

    let skuInfo = Object.entries(skuData).map(([sku]) => (
      {
        sku: `${sku}`
      }
    ));

    skuInfo = JSON.stringify(skuInfo);    
    filesLib.read.mockResolvedValueOnce(skuEntries).mockResolvedValueOnce(skuInfo);
    stateLib.get.mockResolvedValueOnce({ value: lastQueriedAt });
  };

  const mockSaaSResponse = (skus, lastModifiedOffset = 10000) => {
    requestSaaS.mockImplementation((query, operation) => {
      if (operation === 'getAllSkus') {
        return Promise.resolve({
          data: {
            productSearch: {
              items: skus.map(sku => ({ productView: {sku} }))
            }
          },
        });
      }
      if (operation === 'getLastModified') {
        return Promise.resolve({
          data: {
            products: skus.map(sku => ({ 
              urlKey: `url-${sku}`, 
              sku, 
              lastModifiedAt: new Date().getTime() - lastModifiedOffset 
            })),
          },
        });
      }
      return Promise.resolve({});
    });
  };

  afterEach(() => {
    jest.clearAllMocks();
    // Reset isValidUrl mock to default behavior
    isValidUrl.mockReturnValue(true);
  });

  it('loadState returns default state', async () => {
    const filesLib = new Files(0);
    const stateLib = new MockState(0);
    const state = await loadState('uk', { filesLib, stateLib });
    assert.deepEqual(
      state,
      {
        locale: 'uk',
        skus: {},
      }
    );
  });

  it('loadState returns parsed state', async () => {
    const filesLib = new Files(0);
    const stateLib = new MockState(0);
    await filesLib.write(getFileLocation('uk', 'csv'), EXAMPLE_STATE);
    const state = await loadState('uk', { filesLib, stateLib });
    assert.deepEqual(state, EXAMPLE_EXPECTED_STATE);
  });

  it('loadState after saveState', async () => {
    const filesLib = new Files(0);
    const stateLib = new MockState(0);
    await filesLib.write(getFileLocation('uk', 'csv'), EXAMPLE_STATE);
    const state = await loadState('uk', { filesLib, stateLib });
    assert.deepEqual(state, EXAMPLE_EXPECTED_STATE);
    state.skus['sku1'] = {
      lastPreviewedAt: new Date(4),
      hash: 'hash1',
    };
    state.skus['sku2'] = {
      lastPreviewedAt: new Date(5),
      hash: 'hash2',
    };
    await saveState(state, { filesLib, stateLib });

    const serializedState = await filesLib.read(getFileLocation('uk', 'csv'));
    assert.equal(serializedState, 'sku1,4,hash1\nsku2,5,hash2\nsku3,3,');

    const newState = await loadState('uk', { filesLib, stateLib });
    assert.deepEqual(newState, state);
  });

  it('loadState after saveState with null storeCode', async () => {
    const filesLib = new Files(0);
    const stateLib = new MockState(0);
    await filesLib.write(getFileLocation('default', 'csv'), EXAMPLE_STATE);
    const state = await loadState('default', { filesLib, stateLib });
    const expectedState = {
      ...EXAMPLE_EXPECTED_STATE,
      locale: 'default',
    };
    assert.deepEqual(state, expectedState);
    state.skus['sku1'] = {
      lastPreviewedAt: new Date(4),
      hash: 'hash1',
    };
    state.skus['sku2'] = {
      lastPreviewedAt: new Date(5),
      hash: 'hash2',
    };
    await saveState(state, { filesLib, stateLib });

    const serializedState = await filesLib.read(getFileLocation('default', 'csv'));
    assert.equal(serializedState, 'sku1,4,hash1\nsku2,5,hash2\nsku3,3,');
  });

  describe('Parameter validation', () => {
    it('should throw an error if required parameters are missing', async () => {
      const params = { ...defaultParams };
      delete params.CONFIG_NAME;
      
      const filesLib = mockFiles();
      const stateLib = mockState();

      await expect(poll(params, { filesLib, stateLib }, mockLogger))
        .rejects.toThrow('Missing required parameters: CONFIG_NAME');
    });

    it('should throw an error if STORE_URL is invalid', async () => {
      isValidUrl.mockReturnValue(false);
      const params = {
        ...defaultParams,
        STORE_URL: 'invalid-url',
      };
      
      const filesLib = mockFiles();
      const stateLib = mockState();

      await expect(poll(params, { filesLib, stateLib }, mockLogger))
        .rejects.toThrow('Invalid storeUrl');
    });
  });

  describe('Product processing', () => {
    it('should process products with changed content and update hashes', async () => {
      const now = new Date().getTime();
      const filesLib = mockFiles();
      const stateLib = mockState();

      // Setup initial state with existing products
      setupSkuData(
          filesLib,
          stateLib,
          {
            'sku-123': { timestamp: now - 100000, hash: 'old-hash-for-product-123' }
          },
          now - 700000
      );

      // Mock catalog service responses
      mockSaaSResponse(['sku-123'], 5000);

      const result = await poll(defaultParams, { filesLib, stateLib }, mockLogger);

      // Verify results
      expect(result.state).toBe('completed');
      expect(result.status.published).toBe(1);
      expect(result.status.ignored).toBe(0);

      // Verify hash was updated
      expect(filesLib.write).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining('current-hash-for-product-123')
      );

      // Verify HTML file was saved
      expect(filesLib.write).toHaveBeenCalledWith(
        '/public/pdps/url-sku-123.html',
        '<html>Product 123</html>'
      );

      // Verify API calls
      expect(AdminAPI.prototype.previewAndPublish).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ path: '/url-sku-123', sku: 'sku-123' })
          ]),
          null,
          1
      );
      expect(AdminAPI.prototype.startProcessing).toHaveBeenCalledTimes(1);
      expect(AdminAPI.prototype.stopProcessing).toHaveBeenCalledTimes(1);
    });

    it('should ignore products with unchanged content', async () => {
      const now = new Date().getTime();
      const filesLib = mockFiles();
      const stateLib = mockState();
      
      // Setup initial state with existing products that have current hash
      setupSkuData(
        filesLib, 
        stateLib, 
        {
          'sku-456': { timestamp: now - 10000, hash: 'current-hash-for-product-456' }
        }, 
        now - 700000
      );
      
      // Mock catalog service responses
      mockSaaSResponse(['sku-456'], 5000);
      
      const result = await poll(defaultParams, { filesLib, stateLib }, mockLogger);

      // Verify results
      expect(result.state).toBe('completed');
      expect(result.status.published).toBe(0);
      expect(result.status.ignored).toBe(1);
      
      // Verify no preview/publish was called
      expect(AdminAPI.prototype.previewAndPublish).not.toHaveBeenCalled();
    });

    it('should handle failed preview and publishing', async () => {
      const now = new Date().getTime();
      const filesLib = mockFiles();
      const stateLib = mockState();
      
      // Setup initial state with existing products
      setupSkuData(
        filesLib, 
        stateLib, 
        {
          'sku-failed-due-preview': { timestamp: now - 100000 },
          'sku-failed-due-publishing': { timestamp: now - 100000 }
        }, 
        now - 700000
      );
      
      // Mock catalog service responses
      mockSaaSResponse(['sku-failed-due-preview', 'sku-failed-due-publishing'], 20000);
      
      const result = await poll(defaultParams, { filesLib, stateLib }, mockLogger);

      // Verify results
      expect(result.state).toBe('completed');
      expect(result.status.published).toBe(0);
      expect(result.status.failed).toBe(2);
      
      // Verify API calls
      expect(AdminAPI.prototype.previewAndPublish).toHaveBeenCalledTimes(1);
    });

    it('should not process products when they are not modified', async () => {
      const now = new Date().getTime();
      const filesLib = mockFiles();
      const stateLib = mockState();
      
      // Setup initial state with recently processed products
      setupSkuData(
        filesLib, 
        stateLib, 
        {
          'sku-123': { timestamp: now - 10000 },
          'sku-456': { timestamp: now - 10000 },
          'sku-789': { timestamp: now - 10000 }
        }, 
        now - 100000 // Recent query time
      );
      
      // Mock catalog service responses with older modification times
      requestSaaS.mockImplementation((query, operation) => {
        if (operation === 'getLastModified') {
          return Promise.resolve({
            data: {
              products: [
                { urlKey: 'url-sku-123', sku: 'sku-123', lastModifiedAt: now - 20000 },
                { urlKey: 'url-sku-456', sku: 'sku-456', lastModifiedAt: now - 30000 },
                { urlKey: null, sku: 'sku-789', lastModifiedAt: now - 5000 },
              ],
            },
          });
        }
        return Promise.resolve({});
      });
      
      const result = await poll(defaultParams, { filesLib, stateLib }, mockLogger);

      // Verify results
      expect(result.state).toBe('completed');
      expect(result.status.published).toBe(0);
      expect(result.status.ignored).toBe(3);
      
      // Verify no processing occurred
      expect(AdminAPI.prototype.previewAndPublish).not.toHaveBeenCalled();
      expect(filesLib.write).not.toHaveBeenCalled();
    });
  });

  describe('Product unpublishing', () => {
    it.each([
        [[{ sku: 'sku-456' }, { sku: 'sku-failed' }], 0, 2],
        [[{ sku: 'sku-456' }], 1, 0],
    ])('should unpublish products that are not in the catalog', async (spreadsheetResponse, unpublished, failed) => {
      const now = new Date().getTime();
      const filesLib = mockFiles();
      const stateLib = mockState();

      // Setup initial state with products that will be partially removed
      setupSkuData(
          filesLib,
          stateLib,
          {
            'sku-123': { timestamp: now - 10000 },
            'sku-456': { timestamp: now - 10000 },
            'sku-failed': { timestamp: now - 10000 }
          },
          now - 100000
      );

      // Mock catalog service to only return one product
      requestSaaS.mockImplementation((query, operation) => {
        if (operation === 'getLastModified') {
          return Promise.resolve({
            data: {
              products: [
                { urlKey: 'url-sku-123', sku: 'sku-123', lastModifiedAt: now - 20000 },
              ],
            },
          });
        }
        return Promise.resolve({});
      });

      // Mock spreadsheet response for products to be removed
      requestSpreadsheet.mockImplementation(() => {
        return Promise.resolve({
          data: spreadsheetResponse,
        });
      });

      // Mock unpublish with one success and one failure
      AdminAPI.prototype.unpublishAndDelete.mockImplementation((batch) => {
        return Promise.resolve({
          records: batch.map(({ sku }) => ({
            sku,
            liveUnpublishedAt: batch.some(({ sku }) => sku === 'sku-failed') ? null : new Date(),
            previewUnpublishedAt: batch.some(({ sku }) => sku === 'sku-failed') ? null : new Date(),
          }))
        });
      });

      const result = await poll(defaultParams, { filesLib, stateLib }, mockLogger);

      // Verify results
      expect(result.state).toBe('completed');
      expect(result.status.published).toBe(0);
      expect(result.status.unpublished).toBe(unpublished);
      expect(result.status.failed).toBe(failed);
      expect(result.status.ignored).toBe(1);

      // Verify API calls
      expect(AdminAPI.prototype.unpublishAndDelete).toHaveBeenCalledTimes(1);
      expect(filesLib.write).toHaveBeenCalled();
    });

    it('should delete HTML files when unpublishing products', async () => {
      const now = new Date().getTime();
      const filesLib = mockFiles();
      const stateLib = mockState();

      // Setup initial state with products that will be removed
      setupSkuData(
        filesLib,
        stateLib,
        {
          'sku-123': { timestamp: now - 10000 },
          'sku-456': { timestamp: now - 10000 }
        },
        now - 100000
      );

      // Mock catalog service to only return no products (all should be unpublished)
      requestSaaS.mockImplementation((query, operation) => {
        if (operation === 'getLastModified') {
          return Promise.resolve({
            data: {
              products: [],
            },
          });
        }
        return Promise.resolve({});
      });

      // Mock spreadsheet response for products to be removed
      requestSpreadsheet.mockImplementation(() => {
        return Promise.resolve({
          data: [
            { sku: 'sku-123', urlKey: 'url-sku-123' },
            { sku: 'sku-456', urlKey: 'url-sku-456' }
          ],
        });
      });

      // Mock successful unpublish
      AdminAPI.prototype.unpublishAndDelete.mockImplementation((batch) => {
        return Promise.resolve({
          records: batch.map(({ sku }) => ({
            sku,
            liveUnpublishedAt: new Date(),
            previewUnpublishedAt: new Date()
          }))
        });
      });

      await poll(defaultParams, { filesLib, stateLib }, mockLogger);

      // Verify HTML files were deleted
      expect(filesLib.delete).toHaveBeenCalledTimes(2);
      expect(filesLib.delete).toHaveBeenCalledWith('/public/pdps/url-sku-123');
      expect(filesLib.delete).toHaveBeenCalledWith('/public/pdps/url-sku-456');
    });
  });
});
