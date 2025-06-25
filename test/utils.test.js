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

const SAMPLE_CONFIGBUS_RESPONSE = {
	"public": {
		"default": {
			"commerce-core-endpoint": "https://www.aemshop.net/graphql",
			"commerce-endpoint": "https://www.aemshop.net/cs-graphql",
			"headers": {
				"all": {
					"Store": "default"
				},
				"cs": {
					"Magento-Customer-Group": "customer-group",
					"Magento-Store-Code": "store-code",
					"Magento-Store-View-Code": "store-view-code",
					"Magento-Website-Code": "website-code",
					"x-api-key": "api-key",
					"Magento-Environment-Id": "environment-id"
				}
			},
		}
	}
};

const { useMockServer } = require('./mock-server');
const { errorResponse, stringParameters, checkMissingRequestInputs, getBearerToken, request, requestSpreadsheet, getConfig, requestSaaS, getProductUrl } = require('./../actions/utils.js');
const { http, HttpResponse } = require('msw');

test('interface', () => {
  expect(typeof errorResponse).toBe('function')
  expect(typeof stringParameters).toBe('function')
  expect(typeof checkMissingRequestInputs).toBe('function')
  expect(typeof getBearerToken).toBe('function')
})

describe('errorResponse', () => {
  test('(400, errorMessage)', () => {
    const res = errorResponse(400, 'errorMessage')
    expect(res).toEqual({
      error: {
        statusCode: 400,
        body: { error: 'errorMessage' }
      }
    })
  })

  test('(400, errorMessage, logger)', () => {
    const logger = {
      info: jest.fn()
    }
    const res = errorResponse(400, 'errorMessage', logger)
    expect(logger.info).toHaveBeenCalledWith('400: errorMessage')
    expect(res).toEqual({
      error: {
        statusCode: 400,
        body: { error: 'errorMessage' }
      }
    })
  })
})

describe('stringParameters', () => {
  test('no auth header', () => {
    const params = {
      a: 1, b: 2, __ow_headers: { 'x-api-key': 'fake-api-key' }
    }
    expect(stringParameters(params)).toEqual(JSON.stringify(params))
  })
  test('with auth header', () => {
    const params = {
      a: 1, b: 2, __ow_headers: { 'x-api-key': 'fake-api-key', authorization: 'secret' }
    }
    expect(stringParameters(params)).toEqual(expect.stringContaining('"authorization":"<hidden>"'))
    expect(stringParameters(params)).not.toEqual(expect.stringContaining('secret'))
  })
})

describe('checkMissingRequestInputs', () => {
  test('({ a: 1, b: 2 }, [a])', () => {
    expect(checkMissingRequestInputs({ a: 1, b: 2 }, ['a'])).toEqual(null)
  })
  test('({ a: 1 }, [a, b])', () => {
    expect(checkMissingRequestInputs({ a: 1 }, ['a', 'b'])).toEqual('missing parameter(s) \'b\'')
  })
  test('({ a: { b: { c: 1 } }, f: { g: 2 } }, [a.b.c, f.g.h.i])', () => {
    expect(checkMissingRequestInputs({ a: { b: { c: 1 } }, f: { g: 2 } }, ['a.b.c', 'f.g.h.i'])).toEqual('missing parameter(s) \'f.g.h.i\'')
  })
  test('({ a: { b: { c: 1 } }, f: { g: 2 } }, [a.b.c, f.g.h])', () => {
    expect(checkMissingRequestInputs({ a: { b: { c: 1 } }, f: { g: 2 } }, ['a.b.c', 'f'])).toEqual(null)
  })
  test('({ a: 1, __ow_headers: { h: 1, i: 2 } }, undefined, [h])', () => {
    expect(checkMissingRequestInputs({ a: 1, __ow_headers: { h: 1, i: 2 } }, undefined, ['h'])).toEqual(null)
  })
  test('({ a: 1, __ow_headers: { f: 2 } }, [a], [h, i])', () => {
    expect(checkMissingRequestInputs({ a: 1, __ow_headers: { f: 2 } }, ['a'], ['h', 'i'])).toEqual('missing header(s) \'h,i\'')
  })
  test('({ c: 1, __ow_headers: { f: 2 } }, [a, b], [h, i])', () => {
    expect(checkMissingRequestInputs({ c: 1 }, ['a', 'b'], ['h', 'i'])).toEqual('missing header(s) \'h,i\' and missing parameter(s) \'a,b\'')
  })
  test('({ a: 0 }, [a])', () => {
    expect(checkMissingRequestInputs({ a: 0 }, ['a'])).toEqual(null)
  })
  test('({ a: null }, [a])', () => {
    expect(checkMissingRequestInputs({ a: null }, ['a'])).toEqual(null)
  })
  test('({ a: \'\' }, [a])', () => {
    expect(checkMissingRequestInputs({ a: '' }, ['a'])).toEqual('missing parameter(s) \'a\'')
  })
  test('({ a: undefined }, [a])', () => {
    expect(checkMissingRequestInputs({ a: undefined }, ['a'])).toEqual('missing parameter(s) \'a\'')
  })
})

describe('getBearerToken', () => {
  test('({})', () => {
    expect(getBearerToken({})).toEqual(undefined)
  })
  test('({ authorization: Bearer fake, __ow_headers: {} })', () => {
    expect(getBearerToken({ authorization: 'Bearer fake', __ow_headers: {} })).toEqual(undefined)
  })
  test('({ authorization: Bearer fake, __ow_headers: { authorization: fake } })', () => {
    expect(getBearerToken({ authorization: 'Bearer fake', __ow_headers: { authorization: 'fake' } })).toEqual(undefined)
  })
  test('({ __ow_headers: { authorization: Bearerfake} })', () => {
    expect(getBearerToken({ __ow_headers: { authorization: 'Bearerfake' } })).toEqual(undefined)
  })
  test('({ __ow_headers: { authorization: Bearer fake} })', () => {
    expect(getBearerToken({ __ow_headers: { authorization: 'Bearer fake' } })).toEqual('fake')
  })
  test('({ __ow_headers: { authorization: Bearer fake Bearer fake} })', () => {
    expect(getBearerToken({ __ow_headers: { authorization: 'Bearer fake Bearer fake' } })).toEqual('fake Bearer fake')
  })
})

describe('request', () => {
  const server = useMockServer();

  test('getConfig (legacy)', async () => {
    server.use(http.get('https://content.com/configs.json', async () => {
      return HttpResponse.json({ data: [{ key: 'testKey', value: 'testValue' }] });
    }));

    const context = { contentUrl: 'https://content.com', logger: { debug: jest.fn() } };
    const config = await getConfig(context);
    expect(config).toEqual({ testKey: 'testValue', __hasLegacyFormat: true });
  });

  test('getConfig (legacy) with subpath', async () => {
    server.use(http.get('https://content.com/en/configs.json', async () => {
      return HttpResponse.json({ data: [{ key: 'testKey', value: 'testValue' }] });
    }));

    const context = { configName: 'en/configs', contentUrl: 'https://content.com', logger: { debug: jest.fn() } };
    const config = await getConfig(context);
    expect(config).toEqual({ testKey: 'testValue', __hasLegacyFormat: true });
  });


  test('getConfig (ConfigBus)', async () => {
    server.use(http.get('https://content.com/config.json', async () => {
      return HttpResponse.json(SAMPLE_CONFIGBUS_RESPONSE);
    }));

    const context = { contentUrl: 'https://content.com', logger: { debug: jest.fn() } };
    const config = await getConfig(context);
    expect(config).toEqual(SAMPLE_CONFIGBUS_RESPONSE.public.default);
  });

  test('getConfig (ConfigBus) with subpath', async () => {
    server.use(http.get('https://content.com/config.json', async () => {
      return HttpResponse.json({
        public: {
          ...SAMPLE_CONFIGBUS_RESPONSE.public,
          '/en/': {
            "headers": {
              "cs": {
                "Magento-Store-Code": "en",
                "Magento-Store-View-Code": "en",
                "Magento-Website-Code": "en",
              }
            },
          }
        }
      });
    }));

    const context = { contentUrl: 'https://content.com', storeUrl: 'https://content.com', locale: 'en', pathFormat: '/{locale}/products/{urlKey}/{sku}', logger: { debug: jest.fn() } };
    const config = await getConfig(context);
    expect(config).toEqual({
			"commerce-core-endpoint": "https://www.aemshop.net/graphql",
			"commerce-endpoint": "https://www.aemshop.net/cs-graphql",
			"headers": {
				"all": {
					"Store": "default"
				},
				"cs": {
					"Magento-Customer-Group": "customer-group",
					"Magento-Store-Code": "en",
					"Magento-Store-View-Code": "en",
					"Magento-Website-Code": "en",
					"x-api-key": "api-key",
					"Magento-Environment-Id": "environment-id"
				}
			},
		});
  });

  test('requestSaaS', async () => {
    let requestHeaders;
    server.use(http.post('https://commerce-endpoint.com', async ({ request }) => {
      requestHeaders = request.headers;
      return HttpResponse.json({ data: { result: 'success' } });
    }));

    const context = {
      storeUrl: 'https://store.com',
      config: {
        'commerce-endpoint': 'https://commerce-endpoint.com',
        'commerce.headers.cs.Magento-Customer-Group': 'customer-group',
        'commerce.headers.cs.Magento-Environment-Id': 'environment-id',
        'commerce.headers.cs.Magento-Store-Code': 'store-code',
        'commerce.headers.cs.Magento-Store-View-Code': 'store-view-code',
        'commerce.headers.cs.Magento-Website-Code': 'website-code',
        'commerce.headers.cs.x-api-key': 'api-key',
        __hasLegacyFormat: true
      }
    };

    const query = 'query { test }';
    const operationName = 'TestOperation';
    const variables = { var1: 'value1' };

    const response = await requestSaaS(query, operationName, variables, context);
    expect(response).toEqual({ data: { result: 'success' } });

    expect(requestHeaders.get('Content-Type')).toBe('application/json');
    expect(requestHeaders.get('origin')).toBe('https://store.com');
    expect(requestHeaders.get('magento-customer-group')).toBe('customer-group');
    expect(requestHeaders.get('magento-environment-id')).toBe('environment-id');
    expect(requestHeaders.get('magento-store-code')).toBe('store-code');
    expect(requestHeaders.get('magento-store-view-code')).toBe('store-view-code');
    expect(requestHeaders.get('magento-website-code')).toBe('website-code');
    expect(requestHeaders.get('x-api-key')).toBe('api-key');
    expect(requestHeaders.get('Magento-Is-Preview')).toBe('true');
  });

  test('requestSaaS with errors in GraphQL response', async () => {
    const graphqlError = {
      "message": "The field at path '/_entities' was declared as a non null type, but the code involved in retrieving data has wrongly returned a null value.  The graphql specification requires that the parent field be set to null, or if that is non nullable that it bubble up null to its parent and so on. The non-nullable type is '[_Entity]' within parent type 'Query'",
      "path": ["categories", "@"],
    };
    server.use(http.post('https://commerce-endpoint.com', async () => {
      return HttpResponse.json({
        data: {
          result: 'success'
        },
        errors: [
          graphqlError
        ],
      });
    }));

    const context = {
      storeUrl: 'https://store.com',
      config: {
        'commerce-endpoint': 'https://commerce-endpoint.com',
        'commerce-customer-group': 'customer-group',
        'commerce-environment-id': 'environment-id',
        'commerce-store-code': 'store-code',
        'commerce-store-view-code': 'store-view-code',
        'commerce-website-code': 'website-code',
        'commerce-x-api-key': 'api-key'
      },
      logger: { error: jest.fn() }
    };

    const query = 'query { test }';
    const operationName = 'TestOperation';
    const variables = { var1: 'value1' };

    const response = await requestSaaS(query, operationName, variables, context);
    expect(response).toEqual({ data: { result: 'success' }, errors: [graphqlError] });
    expect(context.logger.error).toHaveBeenCalledWith(`Request 'TestOperation' returned GraphQL error`, graphqlError);
  });

  test('requestSpreadsheet', async () => {
    server.use(http.get('https://content.com/config.json', async () => {
      return HttpResponse.json({ data: [{ key: 'testKey', value: 'testValue' }] });
    }));

    const context = { contentUrl: 'https://content.com' };
    const data = await requestSpreadsheet('config', null, context);
    expect(data).toEqual({ data: [{ key: 'testKey', value: 'testValue' }] });
  });

  test('requestSpreadsheet with sheet', async () => {
    let requestUrl;
    server.use(http.get('https://content.com/config.json', async ({ request }) => {
      requestUrl = request.url;
      return HttpResponse.json({ data: [{ key: 'testKey', value: 'testValue' }] });
    }));

    const context = { contentUrl: 'https://content.com' };
    await requestSpreadsheet('config', 'testSheet', context);
    expect(requestUrl).toEqual('https://content.com/config.json?sheet=testSheet');
  });

  test('successful request', async () => {
    server.use(http.get('https://example.com/success', async () => {
      return HttpResponse.json({ data: 'success' });
    }));

    const response = await request('testRequest', 'https://example.com/success', {});
    expect(response).toEqual({ data: 'success' });
  });

  test('error request', async () => {
    server.use(http.get('https://example.com/not-found', async () => {
      return new HttpResponse(null, { status: 404, statusText: 'Not Found' });
    }));

    await expect(request('testRequest', 'https://example.com/not-found', {})).rejects.toThrow("Request 'testRequest' to 'https://example.com/not-found' failed (404): Not Found");
  });

  test('request timeout', async () => {
    server.use(http.get('https://example.com/timeout', async () => {
      return new Promise((resolve) => setTimeout(() => resolve(HttpResponse.json({ data: 'timeout' })), 1000));
    }));

    await expect(request('testRequest', 'https://example.com/timeout', {}, 100)).rejects.toThrow('This operation was aborted');
  });
});

describe('getProductUrl', () => {
  
  test('getProductUrl with no product, with products prefix, with locale', () => {
    const context = { storeUrl: 'https://example.com', pathFormat: '/{locale}/products/{urlKey}/{sku}', locale: 'en' };
    expect(getProductUrl({ }, context, false)).toBe('/en/products');
  });

  test('getProductUrl with no product, with products prefix, without locale', () => {
    const context = { storeUrl: 'https://example.com', pathFormat: '/products/{urlKey}/{sku}'};
    expect(getProductUrl({ }, context, false)).toBe('/products');
  });

  test('getProductUrl with no product, without products prefix, without locale', () => {
    const context = { storeUrl: 'https://example.com', pathFormat: '/{urlKey}/{sku}'};
    expect(getProductUrl({ }, context, false)).toBe('/');
  });

  test('getProductUrl with urlKey and sku', () => {
      const context = { storeUrl: 'https://example.com', pathFormat: '/products/{urlKey}/{sku}' };
      expect(getProductUrl({ urlKey: 'my-url-key', sku: 'my-sku' }, context)).toBe('https://example.com/products/my-url-key/my-sku');
  });

  test('getProductUrl with urlKey', () => {
      const context = { storeUrl: 'https://example.com', pathFormat: '/{urlKey}' };
      expect(getProductUrl({ urlKey: 'my-url-key' }, context)).toBe('https://example.com/my-url-key');
  });

  test('return null for missing storeUrl', () => {
      const context = { pathFormat: '/{urlKey}' };
      expect(getProductUrl({ urlKey: 'my-url-key' }, context)).toBe(null);
  });

  test('return null for missing pathFormat', () => {
      const context = { storeUrl: 'https://example.com' };
      expect(getProductUrl({ urlKey: 'my-url-key' }, context)).toBe(null);
  });

  test('getProductUrl with path only', () => {
      const context = { storeUrl: 'https://example.com', pathFormat: '/{locale}/products/{urlKey}/{sku}', locale: 'de' };
      expect(getProductUrl({ urlKey: 'my-url-key', sku: 'my-sku' }, context, false)).toBe('/de/products/my-url-key/my-sku');
  });
});
