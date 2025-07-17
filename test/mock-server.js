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
const { setupServer } = require('msw/node');
const { http, graphql, HttpResponse } = require('msw');
const fs = require('fs');
const path = require('path');

const mockConfig = require('./mock-responses/mock-config.json');
const mockVariants = require('./mock-responses/mock-variants.json');
const mockProduct = require('./mock-responses/mock-product.json');
const mockProductLs = require('./mock-responses/mock-product-ls.json');
const mockComplexProduct = require('./mock-responses/mock-complex-product.json');
const mockProductTemplate = fs.readFileSync(path.resolve(__dirname, './mock-responses/product-default.html'), 'utf8');

const handlers = {
  defaultProduct: (matcher) => graphql.query('ProductQuery', (req) => {
    matcher?.(req);
    return HttpResponse.json(mockProduct);
  }),
  defaultComplexProduct: (matcher) => graphql.query('ProductQuery', (req) => {
    matcher?.(req);
    return HttpResponse.json(mockComplexProduct);
  }),
  defaultVariant: (matcher) => graphql.query('VariantsQuery', (req) => {
    matcher?.(req);
    return HttpResponse.json(mockVariants);
  }),
  defaultProductLiveSearch: (matcher) => graphql.query('ProductByUrlKey', (req) => {
    matcher?.(req);
    return HttpResponse.json(mockProductLs);
  }),
  return404: (matcher) => graphql.query('ProductQuery', (req) => {
    matcher?.(req);
    return HttpResponse.json({ data: { products: [] }});
  }),
  returnLiveSearch404: (matcher) => graphql.query('ProductByUrlKey', (req) => {
    matcher?.(req);
    return HttpResponse.json({ data: { productSearch: { items: [] } }});
  }),
  defaultProductTemplate : http.get('https://content.com/products/default.plain.html', () => {
    return HttpResponse.html(mockProductTemplate);
  }),
  localizedProductTemplate: http.get('https://content.com/en/products/default.plain.html', () => {
    return HttpResponse.html(mockProductTemplate);
  }),
}

function useMockServer() {
  const handlers = [
    http.get('https://content.com/config.json', async () => {
      return HttpResponse.json(mockConfig);
    }),
  ];

  const server = setupServer(...handlers);

  jest.setTimeout(10000)

  beforeAll(() => {
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => server.close());

  return server;
}

module.exports = { useMockServer, handlers };
