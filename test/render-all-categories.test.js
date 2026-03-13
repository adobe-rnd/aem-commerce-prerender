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

const { loadState, saveState, getFileLocation } = require('../actions/render-all-categories/poller');
const { generatePlpLdJson } = require('../actions/plp-renderer/ldJson');
const { buildBreadcrumbs, getCategorySlugsFromFamilies, getCategoryDataFromFamilies } = require('../actions/categories');
const { getCategoryUrl } = require('../actions/utils');
const Files = require('./__mocks__/files');
const { useMockServer } = require('./mock-server');
const { http, HttpResponse } = require('msw');

// ─── loadState / saveState ──────────────────────────────────────────────────

describe('PLP poller state', () => {
  let filesLib;

  beforeEach(() => {
    filesLib = new Files(0);
  });

  test('loadState returns empty categories when no state file exists', async () => {
    const state = await loadState('en', { filesLib });
    expect(state).toEqual({ locale: 'en', categories: {} });
  });

  test('loadState parses CSV state correctly', async () => {
    const csv = 'electronics,1000,abc123\nelectronics/laptops,2000,def456';
    await filesLib.write('render-all-categories/en.csv', csv);

    const state = await loadState('en', { filesLib });
    expect(state.locale).toBe('en');
    expect(state.categories['electronics']).toEqual({
      lastRenderedAt: new Date(1000),
      hash: 'abc123',
    });
    expect(state.categories['electronics/laptops']).toEqual({
      lastRenderedAt: new Date(2000),
      hash: 'def456',
    });
  });

  test('loadState uses "default" when locale is null', async () => {
    const csv = 'electronics,1000,abc123';
    await filesLib.write('render-all-categories/default.csv', csv);

    const state = await loadState(null, { filesLib });
    expect(state.locale).toBe(null);
    expect(state.categories['electronics']).toBeDefined();
  });

  test('saveState writes CSV in expected format', async () => {
    const state = {
      locale: 'en',
      categories: {
        'electronics': { lastRenderedAt: new Date(1000), hash: 'abc123' },
        'electronics/laptops': { lastRenderedAt: new Date(2000), hash: 'def456' },
      },
    };

    await saveState(state, { filesLib });

    const written = await filesLib.read('render-all-categories/en.csv');
    const lines = written.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines).toContain('electronics,1000,abc123');
    expect(lines).toContain('electronics/laptops,2000,def456');
  });

  test('saveState filters entries without lastRenderedAt', async () => {
    const state = {
      locale: 'en',
      categories: {
        'electronics': { lastRenderedAt: new Date(1000), hash: 'abc123' },
        'stale-slug': { lastRenderedAt: null, hash: 'xyz' },
      },
    };

    await saveState(state, { filesLib });

    const written = await filesLib.read('render-all-categories/en.csv');
    expect(written).toBe('electronics,1000,abc123');
  });

  test('saveState round-trips with loadState', async () => {
    const original = {
      locale: 'de',
      categories: {
        'kleidung': { lastRenderedAt: new Date(5000), hash: 'hash1' },
        'kleidung/schuhe': { lastRenderedAt: new Date(6000), hash: 'hash2' },
      },
    };

    await saveState(original, { filesLib });
    const loaded = await loadState('de', { filesLib });

    expect(loaded.categories['kleidung'].hash).toBe('hash1');
    expect(loaded.categories['kleidung'].lastRenderedAt).toEqual(new Date(5000));
    expect(loaded.categories['kleidung/schuhe'].hash).toBe('hash2');
  });
});

// ─── getFileLocation ────────────────────────────────────────────────────────

describe('getFileLocation', () => {
  test('constructs path with prefix', () => {
    expect(getFileLocation('en', 'csv')).toBe('render-all-categories/en.csv');
  });

  test('constructs path for json', () => {
    expect(getFileLocation('en-categories', 'json')).toBe('render-all-categories/en-categories.json');
  });
});

// ─── generatePlpLdJson ──────────────────────────────────────────────────────

describe('generatePlpLdJson', () => {
  const context = {
    storeUrl: 'https://example.com',
    pathFormat: '/products/{urlKey}/{sku}',
    locale: 'en',
  };

  const categoryData = {
    name: 'Laptops',
    slug: 'electronics/laptops',
  };

  const products = [
    {
      name: 'MacBook Pro',
      sku: 'mbp-16',
      urlKey: 'macbook-pro',
      images: [{ url: 'https://img.com/mbp.jpg', roles: ['image'], label: 'MacBook' }],
    },
    {
      name: 'ThinkPad X1',
      sku: 'tp-x1',
      urlKey: 'thinkpad-x1',
      images: [{ url: 'https://img.com/tp.jpg', roles: ['image'], label: 'ThinkPad' }],
    },
  ];

  const breadcrumbs = [
    { name: 'Electronics', slug: 'electronics' },
    { name: 'Laptops', slug: 'electronics/laptops' },
  ];

  test('generates ItemList JSON-LD with correct structure', () => {
    const { itemListLdJson } = generatePlpLdJson(categoryData, products, breadcrumbs, context);
    const parsed = JSON.parse(itemListLdJson);

    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('ItemList');
    expect(parsed.name).toBe('Laptops');
    expect(parsed.numberOfItems).toBe(2);
    expect(parsed.itemListElement).toHaveLength(2);
  });

  test('ItemList items have correct position, name, url, image', () => {
    const { itemListLdJson } = generatePlpLdJson(categoryData, products, breadcrumbs, context);
    const parsed = JSON.parse(itemListLdJson);
    const first = parsed.itemListElement[0];

    expect(first['@type']).toBe('ListItem');
    expect(first.position).toBe(1);
    expect(first.name).toBe('MacBook Pro');
    expect(first.url).toBe('https://example.com/products/macbook-pro/mbp-16');
    expect(first.image).toBe('https://img.com/mbp.jpg');
  });

  test('ItemList omits image key when product has no images', () => {
    const noImageProducts = [{ name: 'No Image Product', sku: 'nip', urlKey: 'nip', images: [] }];
    const { itemListLdJson } = generatePlpLdJson(categoryData, noImageProducts, breadcrumbs, context);
    const parsed = JSON.parse(itemListLdJson);

    expect(parsed.itemListElement[0]).not.toHaveProperty('image');
  });

  test('generates BreadcrumbList JSON-LD with correct structure', () => {
    const { breadcrumbLdJson } = generatePlpLdJson(categoryData, products, breadcrumbs, context);
    const parsed = JSON.parse(breadcrumbLdJson);

    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('BreadcrumbList');
    expect(parsed.itemListElement).toHaveLength(2);

    const first = parsed.itemListElement[0];
    expect(first['@type']).toBe('ListItem');
    expect(first.position).toBe(1);
    expect(first.name).toBe('Electronics');
    expect(first.item).toBe('https://example.com/en/electronics');
  });

  test('handles empty product list', () => {
    const { itemListLdJson } = generatePlpLdJson(categoryData, [], breadcrumbs, context);
    const parsed = JSON.parse(itemListLdJson);

    expect(parsed.numberOfItems).toBe(0);
    expect(parsed.itemListElement).toHaveLength(0);
  });
});

// ─── buildBreadcrumbs ───────────────────────────────────────────────────────

describe('buildBreadcrumbs', () => {
  test('builds breadcrumbs from a top-level slug', () => {
    const categoryMap = new Map([
      ['electronics', { name: 'Electronics', slug: 'electronics' }],
    ]);

    const crumbs = buildBreadcrumbs('electronics', categoryMap);
    expect(crumbs).toEqual([
      { name: 'Electronics', slug: 'electronics' },
    ]);
  });

  test('builds breadcrumbs from a nested slug', () => {
    const categoryMap = new Map([
      ['electronics', { name: 'Electronics', slug: 'electronics' }],
      ['electronics/computers', { name: 'Computers', slug: 'electronics/computers' }],
      ['electronics/computers/laptops', { name: 'Laptops', slug: 'electronics/computers/laptops' }],
    ]);

    const crumbs = buildBreadcrumbs('electronics/computers/laptops', categoryMap);
    expect(crumbs).toHaveLength(3);
    expect(crumbs[0]).toEqual({ name: 'Electronics', slug: 'electronics' });
    expect(crumbs[1]).toEqual({ name: 'Computers', slug: 'electronics/computers' });
    expect(crumbs[2]).toEqual({ name: 'Laptops', slug: 'electronics/computers/laptops' });
  });

  test('falls back to humanized slug when category not in map', () => {
    const categoryMap = new Map([
      ['electronics', { name: 'Electronics', slug: 'electronics' }],
    ]);

    const crumbs = buildBreadcrumbs('electronics/computers-tablets', categoryMap);
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].name).toBe('Electronics');
    // Second segment is not in the map, so falls back to humanized slug segment
    expect(crumbs[1].name).toBe('Computers Tablets');
    expect(crumbs[1].slug).toBe('electronics/computers-tablets');
  });

  test('handles single-segment slug', () => {
    const categoryMap = new Map();
    const crumbs = buildBreadcrumbs('clothing', categoryMap);
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0]).toEqual({ name: 'Clothing', slug: 'clothing' });
  });
});

// ─── getCategoryUrl ─────────────────────────────────────────────────────────

describe('getCategoryUrl', () => {
  test('builds full URL with store and locale', () => {
    const context = { storeUrl: 'https://example.com', locale: 'en' };
    expect(getCategoryUrl('electronics/laptops', context)).toBe('https://example.com/en/electronics/laptops');
  });

  test('builds path-only when addStore is false', () => {
    const context = { storeUrl: 'https://example.com', locale: 'en' };
    expect(getCategoryUrl('electronics/laptops', context, false)).toBe('/en/electronics/laptops');
  });

  test('builds URL without locale when locale is absent', () => {
    const context = { storeUrl: 'https://example.com' };
    expect(getCategoryUrl('electronics', context)).toBe('https://example.com/electronics');
  });

  test('builds path-only without locale', () => {
    const context = { storeUrl: 'https://example.com' };
    expect(getCategoryUrl('electronics', context, false)).toBe('/electronics');
  });
});

// ─── getCategoryDataFromFamilies / getCategorySlugsFromFamilies ─────────────

describe('category tree fetching', () => {
  const server = useMockServer();

  const mockContext = {
    storeUrl: 'https://store.com',
    config: {
      'commerce-endpoint': 'https://commerce.com/graphql',
      'commerce.headers.cs.x-api-key': 'test-key',
      'commerce.headers.cs.Magento-Environment-Id': 'test-env',
      'commerce.headers.cs.Magento-Customer-Group': 'test-group',
      'commerce.headers.cs.Magento-Store-Code': 'default',
      'commerce.headers.cs.Magento-Store-View-Code': 'default',
      'commerce.headers.cs.Magento-Website-Code': 'base',
      __hasLegacyFormat: true,
    },
    logger: { debug: jest.fn(), error: jest.fn() },
  };

  test('getCategorySlugsFromFamilies returns flat array of slugs', async () => {
    server.use(
      http.post('https://commerce.com/graphql', async ({ request }) => {
        const body = await request.json();
        if (body.operationName === 'getCategoryTree') {
          return HttpResponse.json({
            data: {
              categoryTree: [
                { slug: 'electronics', name: 'Electronics', level: 1, childrenSlugs: ['electronics/laptops'], metaTags: null, images: [] },
              ],
            },
          });
        }
        if (body.operationName === 'getCategoryTreeBySlugs') {
          return HttpResponse.json({
            data: {
              categoryTree: [
                { slug: 'electronics/laptops', name: 'Laptops', level: 2, parentSlug: 'electronics', childrenSlugs: [], metaTags: null, images: [] },
              ],
            },
          });
        }
        return HttpResponse.json({ data: {} });
      }),
    );

    const slugs = await getCategorySlugsFromFamilies(mockContext, ['electronics']);
    expect(slugs).toEqual(expect.arrayContaining(['electronics', 'electronics/laptops']));
    expect(slugs).toHaveLength(2);
  });

  test('getCategoryDataFromFamilies returns Map with full metadata', async () => {
    server.use(
      http.post('https://commerce.com/graphql', async ({ request }) => {
        const body = await request.json();
        if (body.operationName === 'getCategoryTree') {
          return HttpResponse.json({
            data: {
              categoryTree: [
                {
                  slug: 'electronics',
                  name: 'Electronics',
                  level: 1,
                  childrenSlugs: [],
                  metaTags: { title: 'Electronics', description: 'All electronics', keywords: 'tech' },
                  images: [{ url: 'https://img.com/elec.jpg', label: 'Electronics', roles: ['image'], customRoles: [] }],
                },
              ],
            },
          });
        }
        return HttpResponse.json({ data: { categoryTree: [] } });
      }),
    );

    const categoryMap = await getCategoryDataFromFamilies(mockContext, ['electronics']);
    expect(categoryMap).toBeInstanceOf(Map);
    expect(categoryMap.has('electronics')).toBe(true);

    const data = categoryMap.get('electronics');
    expect(data.name).toBe('Electronics');
    expect(data.metaTags.title).toBe('Electronics');
    expect(data.images).toHaveLength(1);
  });
});
