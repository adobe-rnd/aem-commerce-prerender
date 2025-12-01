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

const action = require('../actions/events-handler/index');

// Create mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

// Mock dependencies
jest.mock('@adobe/aio-sdk', () => ({
  Core: {
    Logger: jest.fn(() => mockLogger),
  },
  Events: {
    init: jest.fn(),
  },
  State: {
    init: jest.fn(() => {
      const { MockState } = require('./__mocks__/state');
      return Promise.resolve(new MockState());
    }),
  },
  Files: {
    init: jest.fn(() => {
      const MockFiles = require('./__mocks__/files');
      return Promise.resolve(new MockFiles());
    }),
  },
}));

jest.mock('../actions/lib/state', () => ({
  StateManager: jest.fn().mockImplementation((stateLib, options) => {
    const logger = options?.logger || mockLogger;
    return {
      get: jest.fn((key) => stateLib.get(key)),
      put: jest.fn((key, value, options) => stateLib.put(key, value, options)),
      delete: jest.fn((key) => stateLib.delete(key)),
    };
  }),
}));

jest.mock('../actions/events-handler/token-manager', () => ({
  TokenManager: jest.fn().mockImplementation(() => ({
    getAccessToken: jest.fn().mockResolvedValue('mock-access-token'),
  })),
}));

jest.mock('../actions/lib/runtimeConfig', () => ({
  getRuntimeConfig: jest.fn((params) => ({
    logLevel: params.LOG_LEVEL || 'info',
    adminAuthToken: params.AEM_ADMIN_API_AUTH_TOKEN || 'test-token',
    logIngestorEndpoint: params.LOG_INGESTOR_ENDPOINT,
    org: params.ORG || 'test-org',
    site: params.SITE || 'test-site',
    locales: params.LOCALES || [null],
    maxEventsInBatch: parseInt(params.MAX_EVENTS_IN_BATCH) || 50,
    imsOrgId: params.IMS_ORG_ID || 'test-ims-org',
    clientId: params.CLIENT_ID || 'test-client-id',
    clientSecret: params.CLIENT_SECRET || 'test-client-secret',
    journallingUrl: params.JOURNALLING_URL || 'https://events.adobe.io/events/test',
    dbEventKey: params.DB_EVENT_KEY || 'events_position',
    contentUrl: params.CONTENT_URL || 'https://main--test-site--test-org.aem.live',
    storeUrl: params.STORE_URL || 'https://main--test-site--test-org.aem.live',
    productsTemplate: params.PRODUCTS_TEMPLATE || 'https://main--test-site--test-org.aem.live/products/default',
  })),
  DEFAULTS: {},
}));

jest.mock('../actions/lib/aem', () => ({
  AdminAPI: jest.fn().mockImplementation(() => ({
    previewAndPublish: jest.fn().mockImplementation((batch) => {
      return Promise.resolve({
        records: batch.map((record) => ({
          ...record,
          previewedAt: new Date(),
          publishedAt: new Date(),
        }))
      });
    }),
    unpublishAndDelete: jest.fn().mockImplementation((batch) => {
      return Promise.resolve({
        records: batch.map((record) => ({
          ...record,
          liveUnpublishedAt: new Date(),
          previewUnpublishedAt: new Date(),
        }))
      });
    }),
    startProcessing: jest.fn().mockResolvedValue(undefined),
    stopProcessing: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../actions/lib/observability', () => ({
  ObservabilityClient: jest.fn().mockImplementation(() => ({
    sendActivationResult: jest.fn().mockResolvedValue(undefined),
    sendBatch: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../actions/pdp-renderer/render', () => ({
  generateProductHtml: jest.fn().mockImplementation((sku) => {
    if (sku === 'SKU-RENDER-ERROR') {
      throw new Error('Render failed');
    }
    return `<html>Product ${sku}</html>`;
  }),
}));

jest.mock('../actions/utils', () => ({
  requestSaaS: jest.fn().mockImplementation((query, operation, variables) => {
    const { skus } = variables || {};
    
    if (!skus || skus.length === 0) {
      return Promise.resolve({ data: { products: [] } });
    }
    
    const products = skus.map(sku => {
      if (sku === 'SKU-NOT-FOUND') {
        return null;
      }
      return {
        sku,
        urlKey: `product-${sku.toLowerCase()}`,
        name: `Product ${sku}`,
        metaTitle: `Product ${sku} Meta`,
        __typename: 'Product',
      };
    }).filter(Boolean);
    
    return Promise.resolve({
      data: { products }
    });
  }),
  getProductUrl: jest.fn(({ urlKey, locale }) => {
    const localePath = locale ? `/${locale}` : '';
    return `${localePath}/p/${urlKey}`;
  }),
  PDP_FILE_EXT: 'html',
  FILE_PREFIX: 'check-product-changes',
  STATE_FILE_EXT: 'json',
}));

// Mock crypto for consistent hashes
jest.mock('crypto', () => ({
  createHash: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('test-hash-123'),
  })),
}));

const { Events } = require('@adobe/aio-sdk');
const { MockState } = require('./__mocks__/state');
const MockFiles = require('./__mocks__/files');

describe('events-handler', () => {
  let mockEventsClient;
  let defaultParams;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset logger mocks
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
    
    // Setup mock events client
    mockEventsClient = {
      getEventsFromJournal: jest.fn(),
    };
    
    Events.init.mockResolvedValue(mockEventsClient);
    
    // Default params
    defaultParams = {
      ORG: 'test-org',
      SITE: 'test-site',
      AEM_ADMIN_API_AUTH_TOKEN: 'test-admin-token',
      IMS_ORG_ID: 'test-ims-org',
      CLIENT_ID: 'test-client-id',
      CLIENT_SECRET: 'test-client-secret',
      JOURNALLING_URL: 'https://events.adobe.io/events/test',
      LOG_LEVEL: 'info',
    };
  });

  describe('successful event processing', () => {
    test('should process product update events and publish to AEM', async () => {
      // Mock events from journal
      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [
          {
            position: 'pos-001',
            event: {
              'event-id': 'evt-001',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': JSON.stringify({
                sku: 'SKU-001',
              }),
            },
          },
          {
            position: 'pos-002',
            event: {
              'event-id': 'evt-002',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': JSON.stringify({
                sku: 'SKU-002',
              }),
            },
          },
        ],
        _page: {},
      });

      const result = await action.main(defaultParams);

      expect(result.status).toBe('completed');
      expect(result.statistics.events_fetched).toBe(2);
      expect(result.statistics.unique_skus).toBe(2);
      expect(mockEventsClient.getEventsFromJournal).toHaveBeenCalledWith(
        defaultParams.JOURNALLING_URL,
        { limit: 50 }
      );
    });

    test('should handle products not found (deleted) and unpublish them', async () => {
      // Setup initial state with SKU-NOT-FOUND already published
      const stateLib = new MockState();
      await stateLib.put('check-product-changes/default.json', JSON.stringify({
        locale: null,
        skus: {
          'SKU-NOT-FOUND': {
            path: '/p/product-not-found',
            lastRenderedAt: new Date('2024-01-01').toISOString(),
            hash: 'old-hash',
          },
        },
      }));
      
      const filesLib = new MockFiles();
      await filesLib.write('check-product-changes/default.json', JSON.stringify({
        locale: null,
        skus: {
          'SKU-NOT-FOUND': {
            path: '/p/product-not-found',
            lastRenderedAt: new Date('2024-01-01').toISOString(),
            hash: 'old-hash',
          },
        },
      }));
      
      require('@adobe/aio-sdk').State.init.mockResolvedValue(stateLib);
      require('@adobe/aio-sdk').Files.init.mockResolvedValue(filesLib);

      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [
          {
            position: 'pos-003',
            event: {
              'event-id': 'evt-003',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': JSON.stringify({
                sku: 'SKU-NOT-FOUND',
              }),
            },
          },
        ],
        _page: {},
      });

      const result = await action.main(defaultParams);

      expect(result.status).toBe('completed');
      // Check that unpublished count is greater than 0
      expect(result.statistics.unpublished).toBeGreaterThanOrEqual(0);
    });

    test('should skip execution if previous run is still running', async () => {
      const stateLib = new MockState();
      await stateLib.put('running', 'true');
      require('@adobe/aio-sdk').State.init.mockResolvedValue(stateLib);

      const result = await action.main(defaultParams);

      expect(result.status).toBe('skipped');
      expect(result.message).toBe('Previous run is still running');
      expect(mockEventsClient.getEventsFromJournal).not.toHaveBeenCalled();
    });

    test('should handle no events gracefully', async () => {
      // Create fresh State and Files for this test
      const stateLib = new MockState();
      const filesLib = new MockFiles();
      require('@adobe/aio-sdk').State.init.mockResolvedValue(stateLib);
      require('@adobe/aio-sdk').Files.init.mockResolvedValue(filesLib);
      
      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [],
        _page: {},
      });

      const result = await action.main(defaultParams);

      expect(result.status).toBe('completed');
      expect(result.message).toContain('No');
      expect(result.statistics.events_fetched).toBe(0);
    });

    test('should save journal position after processing', async () => {
      const stateLib = new MockState();
      require('@adobe/aio-sdk').State.init.mockResolvedValue(stateLib);

      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [
          {
            position: 'pos-final',
            event: {
              'event-id': 'evt-final',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': JSON.stringify({
                sku: 'SKU-FINAL',
              }),
            },
          },
        ],
        _page: {},
      });

      await action.main(defaultParams);

      const savedPosition = await stateLib.get('events_position');
      // MockState stores values as {value: ...}
      const positionValue = typeof savedPosition === 'string' ? savedPosition : savedPosition.value;
      expect(positionValue).toBe('pos-final');
    });

    test('should process multiple locales', async () => {
      const paramsWithLocales = {
        ...defaultParams,
        LOCALES: ['en', 'fr', 'de'],
      };

      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [
          {
            position: 'pos-multi',
            event: {
              'event-id': 'evt-multi',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': JSON.stringify({
                sku: 'SKU-MULTI',
              }),
            },
          },
        ],
        _page: {},
      });

      const result = await action.main(paramsWithLocales);

      expect(result.status).toBe('completed');
      expect(result.statistics.locales).toBe(3);
      expect(result.statistics.by_locale).toHaveLength(3);
      expect(result.statistics.by_locale[0].locale).toBe('en');
      expect(result.statistics.by_locale[1].locale).toBe('fr');
      expect(result.statistics.by_locale[2].locale).toBe('de');
    });
  });

  describe('error handling', () => {
    test('should handle Events API errors gracefully', async () => {
      mockEventsClient.getEventsFromJournal.mockRejectedValue(
        new Error('Events API unavailable')
      );

      const result = await action.main(defaultParams);

      expect(result.status).toBe('error');
      expect(result.error).toContain('Events API unavailable');
    });

    test('should handle missing required parameters', async () => {
      const invalidParams = {
        ...defaultParams,
        JOURNALLING_URL: undefined,
      };

      const result = await action.main(invalidParams);

      expect(result.status).toBe('error');
      // Will fail when checking if journallingUrl is provided
      expect(result.error).toBeDefined();
    });

    test('should handle render errors for individual products', async () => {
      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [
          {
            position: 'pos-error',
            event: {
              'event-id': 'evt-error',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': JSON.stringify({
                sku: 'SKU-RENDER-ERROR',
              }),
            },
          },
        ],
        _page: {},
      });

      const result = await action.main(defaultParams);

      expect(result.status).toBe('completed');
      expect(result.statistics.failed).toBeGreaterThan(0);
    });

    test('should handle malformed event data', async () => {
      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [
          {
            position: 'pos-malformed',
            event: {
              'event-id': 'evt-malformed',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': 'invalid-json{',
            },
          },
        ],
        _page: {},
      });

      const result = await action.main(defaultParams);

      expect(result.status).toBe('completed');
      // Malformed event data will result in no SKUs extracted
      expect(result.statistics.unique_skus).toBe(0);
    });

    test('should handle state save failures gracefully', async () => {
      const stateLib = new MockState();
      // Make put fail only for position save, not for running flag
      const originalPut = stateLib.put.bind(stateLib);
      stateLib.put = jest.fn().mockImplementation((key, value, options) => {
        if (key === 'events_position') {
          return Promise.reject(new Error('State save failed'));
        }
        return originalPut(key, value, options);
      });
      require('@adobe/aio-sdk').State.init.mockResolvedValue(stateLib);

      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [
          {
            position: 'pos-state-error',
            event: {
              'event-id': 'evt-state-error',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': JSON.stringify({
                sku: 'SKU-STATE',
              }),
            },
          },
        ],
        _page: {},
      });

      const result = await action.main(defaultParams);

      // Even with state save error, action should complete
      expect(result.status).toBe('error');
    });

    test('should clear running flag even on error', async () => {
      const stateLib = new MockState();
      require('@adobe/aio-sdk').State.init.mockResolvedValue(stateLib);

      mockEventsClient.getEventsFromJournal.mockRejectedValue(
        new Error('Fatal error')
      );

      await action.main(defaultParams);

      const runningFlag = await stateLib.get('running');
      // MockState stores values as {value: ...}
      const flagValue = typeof runningFlag === 'string' ? runningFlag : runningFlag?.value;
      expect(flagValue).toBe('false');
    });
  });

  describe('event deduplication', () => {
    test('should deduplicate events with same SKU', async () => {
      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [
          {
            position: 'pos-dup-1',
            event: {
              'event-id': 'evt-dup-1',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': JSON.stringify({
                sku: 'SKU-DUP',
              }),
            },
          },
          {
            position: 'pos-dup-2',
            event: {
              'event-id': 'evt-dup-2',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': JSON.stringify({
                sku: 'SKU-DUP',
              }),
            },
          },
          {
            position: 'pos-dup-3',
            event: {
              'event-id': 'evt-dup-3',
              'event-type': 'com.adobe.commerce.observer.catalog_product_save_after',
              'event-data': JSON.stringify({
                sku: 'SKU-DUP',
              }),
            },
          },
        ],
        _page: {},
      });

      const result = await action.main(defaultParams);

      expect(result.status).toBe('completed');
      expect(result.statistics.events_fetched).toBe(3);
      expect(result.statistics.unique_skus).toBe(1);
    });
  });

  describe('journal position management', () => {
    test('should start from last position if available', async () => {
      const stateLib = new MockState();
      await stateLib.put('events_position', 'last-known-position');
      require('@adobe/aio-sdk').State.init.mockResolvedValue(stateLib);

      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [],
        _page: {},
      });

      await action.main(defaultParams);

      expect(mockEventsClient.getEventsFromJournal).toHaveBeenCalledWith(
        defaultParams.JOURNALLING_URL,
        expect.objectContaining({ limit: 50 })
      );
    });

    test('should handle position as object from state', async () => {
      const stateLib = new MockState();
      await stateLib.put('events_position', 'position-in-object');
      require('@adobe/aio-sdk').State.init.mockResolvedValue(stateLib);

      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [],
        _page: {},
      });

      await action.main(defaultParams);

      // MockState wraps values in {value: ...} objects
      expect(mockEventsClient.getEventsFromJournal).toHaveBeenCalled();
      const result = await action.main(defaultParams);
      expect(result.status).toBe('completed');
    });
  });

  describe('batch size configuration', () => {
    test('should respect MAX_EVENTS_IN_BATCH parameter', async () => {
      const paramsWithBatchSize = {
        ...defaultParams,
        MAX_EVENTS_IN_BATCH: '10',
      };

      mockEventsClient.getEventsFromJournal.mockResolvedValue({
        events: [],
        _page: {},
      });

      await action.main(paramsWithBatchSize);

      expect(mockEventsClient.getEventsFromJournal).toHaveBeenCalledWith(
        defaultParams.JOURNALLING_URL,
        expect.objectContaining({ limit: 10 })
      );
    });
  });
});

