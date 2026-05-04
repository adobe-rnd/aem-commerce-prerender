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

const cheerio = require('cheerio');
const { generateCategoryHtml } = require('../actions/plp-renderer/render');

/**
 * @param {import('cheerio').CheerioAPI} $
 * @returns {object}
 */
function readPlpLdJson($) {
  const raw = $('script[type="application/ld+json"]').first().html();
  expect(raw).toBeTruthy();
  try {
    return JSON.parse(raw);
  } catch (err) {
    const preview = String(raw).slice(0, 200);
    throw new Error(
      `Failed to parse PLP JSON-LD (script[type="application/ld+json"]): ${err.message}. Raw (first 200 chars): ${preview}`,
    );
  }
}

/**
 * Slug cells from any direct child row of .product-list-page whose first column is "urlPath".
 * Matches by row shape, not row index (so new blocks above the urlPath row do not break the test).
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {string[]}
 */
function getUrlPathRowSlugs($) {
  const slugs = [];
  $('.product-list-page > div').each((_, row) => {
    const cells = $(row).children('div');
    if (cells.length >= 2 && $(cells[0]).text().trim() === 'urlPath') {
      slugs.push($(cells[1]).text().trim());
    }
  });
  return slugs;
}

describe('plp-renderer generateCategoryHtml', () => {
  const pathFormat = '/products/{urlKey}/{sku}';

  const categoryMap = new Map([
    ['electronics', { name: 'Electronics', slug: 'electronics' }],
    ['electronics/laptops', { name: 'Laptops', slug: 'electronics/laptops' }],
  ]);

  const categoryData = {
    name: 'Laptops',
    slug: 'electronics/laptops',
    metaTags: {
      title: 'Buy Laptops',
      description: 'Best <b>laptops</b> for work',
      keywords: ['laptop', 'sale'],
    },
    images: [{ url: 'https://cdn.example/cat.jpg', roles: ['BASE'] }],
  };

  const products = [
    {
      __typename: 'SimpleProductView',
      name: 'MacBook Pro',
      sku: 'mbp-16',
      urlKey: 'macbook-pro',
      inStock: true,
      shortDescription: 'A powerful laptop',
      images: [{ url: 'https://img.com/mbp.jpg', roles: ['image'] }],
      price: { final: { amount: { value: 1999, currency: 'USD' } } },
    },
  ];

  const baseContext = {
    storeUrl: 'https://example.com',
    pathFormat,
    locale: 'en',
    logger: { debug: jest.fn() },
  };

  test('renders full PLP with breadcrumbs, products, metadata, and CollectionPage JSON-LD', () => {
    const html = generateCategoryHtml(categoryData, products, categoryMap, baseContext);

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);

    const $ = cheerio.load(html);

    expect($('title').text()).toBe('Buy Laptops');
    expect($('h1').text()).toBe('Laptops');
    expect($('meta[name="description"]').attr('content')).toBe('Best laptops for work');
    expect($('meta[name="keywords"]').attr('content')).toBe('laptop, sale');
    expect($('meta[property="og:url"]').attr('content')).toBe('https://example.com/en/electronics/laptops');

    // urlPath row: must match categoryData.slug (regression guard vs breadcrumbs / og:url)
    expect(getUrlPathRowSlugs($)).toEqual([categoryData.slug]);

    const crumbs = $('.breadcrumb ol li a')
      .map((_, el) => ({ href: $(el).attr('href'), text: $(el).text() }))
      .get();
    expect(crumbs).toEqual([
      { href: 'https://example.com/en/electronics', text: 'Electronics' },
      { href: 'https://example.com/en/electronics/laptops', text: 'Laptops' },
    ]);

    const productLink = $('.product-list-page ul li a').first();
    expect(productLink.attr('href')).toBe('https://example.com/products/macbook-pro/mbp-16');
    expect(productLink.find('h3').text()).toBe('MacBook Pro');
    expect(productLink.find('img').attr('src')).toBe('https://img.com/mbp.jpg');

    const ld = readPlpLdJson($);
    expect(ld['@type']).toBe('CollectionPage');
    expect(ld.name).toBe('Laptops');
    expect(ld.mainEntity['@type']).toBe('ItemList');
    expect(ld.mainEntity.numberOfItems).toBe(1);
    expect(ld.mainEntity.itemListElement[0].item.name).toBe('MacBook Pro');
  });

  test('renders PLP with no products (no product list block, empty ItemList)', () => {
    const html = generateCategoryHtml(categoryData, [], categoryMap, baseContext);
    const $ = cheerio.load(html);

    expect(getUrlPathRowSlugs($)).toEqual([categoryData.slug]);
    expect($('.product-list-page ul')).toHaveLength(0);

    const ld = readPlpLdJson($);
    expect(ld['@type']).toBe('CollectionPage');
    expect(ld.mainEntity.numberOfItems).toBe(0);
    expect(ld.mainEntity.itemListElement).toEqual([]);
  });

  test('urlPath block keeps canonical slug; og:url and breadcrumbs use sanitized segments', () => {
    const slugWithDoubleHyphen = 'parts-a/seals--gaskets-b';
    const categoryMapHyphen = new Map([
      ['parts-a', { name: 'Parts A', slug: 'parts-a' }],
      ['parts-a/seals--gaskets-b', { name: 'Seals', slug: slugWithDoubleHyphen }],
    ]);
    const categoryDataHyphen = {
      name: 'Seals',
      slug: slugWithDoubleHyphen,
      metaTags: { title: 'Seals' },
      images: [],
    };

    const html = generateCategoryHtml(categoryDataHyphen, [], categoryMapHyphen, baseContext);
    const $ = cheerio.load(html);

    expect(getUrlPathRowSlugs($)).toEqual([slugWithDoubleHyphen]);
    expect($('meta[property="og:url"]').attr('content')).toBe(
      'https://example.com/en/parts-a/seals-gaskets-b',
    );

    const crumbHrefs = $('.breadcrumb ol li a')
      .map((_, el) => $(el).attr('href'))
      .get();
    expect(crumbHrefs).toEqual([
      'https://example.com/en/parts-a',
      'https://example.com/en/parts-a/seals-gaskets-b',
    ]);
  });
});
