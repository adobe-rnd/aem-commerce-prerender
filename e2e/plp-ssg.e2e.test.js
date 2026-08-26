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

const { Config } = require('@adobe/aio-sdk').Core;
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const config = require('./config.json');

const namespace = Config.get('runtime.namespace');
const hostname = Config.get('cna.hostname') || 'adobeioruntime.net';
const runtimePackage = 'aem-commerce-ssg';
const actionUrl = `https://${namespace}.${hostname}/api/v1/web/${runtimePackage}/plp-renderer`;

const slug = config.plpSlug;

function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function validateOffer(offer) {
  expect(offer['@type']).toBe('Offer');
  expect(isValidUrl(offer.url)).toBe(true);
  expect(['https://schema.org/InStock', 'https://schema.org/OutOfStock']).toContain(offer.availability);
  expect(typeof offer.price).toBe('number');
  expect(typeof offer.priceCurrency).toBe('string');
  expect(offer.priceCurrency.length).toBeGreaterThan(0);
  expect(offer.itemCondition).toBe('https://schema.org/NewCondition');
}

describe(`PLP e2e - slug: ${slug}`, () => {
  let $;
  let ldJson;

  beforeAll(async () => {
    const res = await fetch(`${actionUrl}?slug=${slug}`);
    expect(res.status).toBe(200);
    const content = await res.text();
    $ = cheerio.load(content);
    ldJson = JSON.parse($('script[type="application/ld+json"]').html());
  }, 30000);

  test('h1 exists and is non-empty', () => {
    const h1 = $('h1').text().trim();
    expect(h1.length).toBeGreaterThan(0);
  });

  test('title is non-empty', () => {
    const title = $('title').text().trim();
    expect(title.length).toBeGreaterThan(0);
  });

  test('og tags are present and non-empty', () => {
    for (const property of ['og:type', 'og:title', 'og:url']) {
      const content = $(`meta[property="${property}"]`).attr('content');
      expect(content).toBeTruthy();
    }
  });

  test('optional meta tags have non-empty content when present', () => {
    for (const [attr, name] of [
      ['name', 'description'],
      ['name', 'keywords'],
      ['name', 'image'],
      ['property', 'og:description'],
      ['property', 'og:image'],
    ]) {
      const el = $(`meta[${attr}="${name}"]`);
      if (el.length) {
        expect(el.attr('content')).toBeTruthy();
      }
    }
  });

  test('breadcrumb nav exists with at least one link', () => {
    const breadcrumbLinks = $('nav.breadcrumb a');
    expect(breadcrumbLinks.length).toBeGreaterThan(0);
    breadcrumbLinks.each((_, el) => {
      const href = $(el).attr('href');
      expect(typeof href).toBe('string');
      expect(href.length).toBeGreaterThan(0);
    });
  });

  test('at least one product in the listing', () => {
    const productItems = $('.product-listing li');
    expect(productItems.length).toBeGreaterThan(0);
  });

  test('each product has a link', () => {
    const productItems = $('.product-listing li');
    productItems.each((_, el) => {
      const link = $(el).find('a');
      expect(link.length).toBeGreaterThan(0);
      const href = link.attr('href');
      expect(typeof href).toBe('string');
      expect(href.length).toBeGreaterThan(0);
    });
  });

  test('product images have valid URLs', () => {
    const images = $('.product-listing li img');
    images.each((_, el) => {
      const src = $(el).attr('src');
      expect(isValidUrl(src)).toBe(true);
    });
  });

  test('LD+JSON is valid with correct @context and @type', () => {
    expect(ldJson).toBeDefined();
    expect(ldJson['@context']).toBe('https://schema.org');
    expect(ldJson['@type']).toBe('CollectionPage');
  });

  test('LD+JSON name is a non-empty string', () => {
    expect(typeof ldJson.name).toBe('string');
    expect(ldJson.name.length).toBeGreaterThan(0);
  });

  describe('LD+JSON breadcrumb', () => {
    test('breadcrumb is a BreadcrumbList with entries', () => {
      expect(ldJson.breadcrumb).toBeDefined();
      expect(ldJson.breadcrumb['@type']).toBe('BreadcrumbList');
      expect(Array.isArray(ldJson.breadcrumb.itemListElement)).toBe(true);
      expect(ldJson.breadcrumb.itemListElement.length).toBeGreaterThan(0);
    });

    test('each breadcrumb entry has valid fields', () => {
      ldJson.breadcrumb.itemListElement.forEach((entry) => {
        expect(entry['@type']).toBe('ListItem');
        expect(typeof entry.position).toBe('number');
        expect(entry.position).toBeGreaterThan(0);
        expect(typeof entry.name).toBe('string');
        expect(entry.name.length).toBeGreaterThan(0);
        expect(isValidUrl(entry.item)).toBe(true);
      });
    });
  });

  describe('LD+JSON mainEntity (ItemList)', () => {
    test('mainEntity is an ItemList', () => {
      expect(ldJson.mainEntity).toBeDefined();
      expect(ldJson.mainEntity['@type']).toBe('ItemList');
      expect(typeof ldJson.mainEntity.name).toBe('string');
      expect(ldJson.mainEntity.name.length).toBeGreaterThan(0);
      expect(typeof ldJson.mainEntity.numberOfItems).toBe('number');
      expect(ldJson.mainEntity.numberOfItems).toBeGreaterThan(0);
    });

    test('itemListElement has at least one entry', () => {
      expect(Array.isArray(ldJson.mainEntity.itemListElement)).toBe(true);
      expect(ldJson.mainEntity.itemListElement.length).toBeGreaterThan(0);
    });

    test('each product entry has required fields', () => {
      ldJson.mainEntity.itemListElement.forEach((entry) => {
        expect(entry['@type']).toBe('ListItem');
        expect(typeof entry.position).toBe('number');
        expect(entry.position).toBeGreaterThan(0);

        const product = entry.item;
        expect(product['@type']).toBe('Product');
        expect(typeof product.name).toBe('string');
        expect(product.name.length).toBeGreaterThan(0);
        expect(typeof product.sku).toBe('string');
        expect(product.sku.length).toBeGreaterThan(0);
        expect(isValidUrl(product.url)).toBe(true);
      });
    });

    test('optional product fields have correct types when present', () => {
      ldJson.mainEntity.itemListElement.forEach((entry) => {
        const product = entry.item;

        if (product.gtin !== undefined) {
          expect(typeof product.gtin).toBe('string');
        }

        if (product.brand !== undefined) {
          expect(product.brand['@type']).toBe('Brand');
          expect(typeof product.brand.name).toBe('string');
          expect(product.brand.name.length).toBeGreaterThan(0);
        }

        if (product.image !== undefined) {
          expect(isValidUrl(product.image)).toBe(true);
        }

        if (product.description !== undefined) {
          expect(typeof product.description).toBe('string');
          expect(product.description.length).toBeGreaterThan(0);
        }

        if (product.offers !== undefined) {
          expect(Array.isArray(product.offers)).toBe(true);
          expect(product.offers.length).toBeGreaterThan(0);
          product.offers.forEach(validateOffer);
        }
      });
    });
  });
});
