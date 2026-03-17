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
const actionUrl = `https://${namespace}.${hostname}/api/v1/web/${runtimePackage}/pdp-renderer`;

const sku = config.pdpSku;

function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function validateOffer(offer, expectedSku) {
  expect(offer['@type']).toBe('Offer');
  expect(offer.sku).toBe(expectedSku);
  expect(isValidUrl(offer.url)).toBe(true);
  expect(['https://schema.org/InStock', 'https://schema.org/OutOfStock']).toContain(offer.availability);
  expect(typeof offer.price).toBe('number');
  expect(typeof offer.priceCurrency).toBe('string');
  expect(offer.priceCurrency.length).toBeGreaterThan(0);
  expect(offer.itemCondition).toBe('https://schema.org/NewCondition');

  if (offer.priceSpecification) {
    expect(offer.priceSpecification['@type']).toBe('UnitPriceSpecification');
    expect(typeof offer.priceSpecification.priceType).toBe('string');
    expect(typeof offer.priceSpecification.price).toBe('number');
    expect(typeof offer.priceSpecification.priceCurrency).toBe('string');
  }
}

describe(`PDP e2e - SKU: ${sku}`, () => {
  let $;
  let ldJson;

  beforeAll(async () => {
    const res = await fetch(`${actionUrl}?sku=${sku}`);
    expect(res.status).toBe(200);
    const content = await res.text();
    $ = cheerio.load(content);
    ldJson = JSON.parse($('script[type="application/ld+json"]').html());
  }, 30000);

  test('h1 exists and is non-empty', () => {
    const h1 = $('h1').text().trim();
    expect(h1.length).toBeGreaterThan(0);
  });

  test('price is present and matches currency pattern', () => {
    const priceText = $('.product-details > div > div:contains("Price")').next().text().trim();
    expect(priceText.length).toBeGreaterThan(0);
    expect(priceText).toMatch(/\$[\d,.]+(-\$[\d,.]+)?/);
  });

  test('at least one image with a valid URL', () => {
    const images = $('.product-details > div > div:contains("Images")').next().find('img');
    expect(images.length).toBeGreaterThan(0);
    images.each((_, el) => {
      const src = $(el).attr('src');
      expect(isValidUrl(src)).toBe(true);
    });
  });

  test('meta description exists', () => {
    const metaDesc = $('meta[name="description"]');
    expect(metaDesc).toHaveLength(1);
  });

  test('LD+JSON is valid and has correct @context', () => {
    expect(ldJson).toBeDefined();
    expect(ldJson['@context']).toBe('http://schema.org');
  });

  test('LD+JSON @type is Product or ProductGroup', () => {
    expect(['Product', 'ProductGroup']).toContain(ldJson['@type']);
  });

  test('LD+JSON sku matches input', () => {
    expect(ldJson.sku).toBe(sku);
  });

  test('LD+JSON name is a non-empty string', () => {
    expect(typeof ldJson.name).toBe('string');
    expect(ldJson.name.length).toBeGreaterThan(0);
  });

  test('LD+JSON gtin is a string', () => {
    expect(typeof ldJson.gtin).toBe('string');
  });

  test('LD+JSON description is a string or null', () => {
    if (ldJson.description !== null) {
      expect(typeof ldJson.description).toBe('string');
    }
  });

  test('LD+JSON @id is a valid URL', () => {
    expect(isValidUrl(ldJson['@id'])).toBe(true);
  });

  test('LD+JSON image is a valid URL or null', () => {
    if (ldJson.image !== null) {
      expect(isValidUrl(ldJson.image)).toBe(true);
    }
  });

  test('LD+JSON offers array with valid entries (simple product only)', () => {
    if (ldJson['@type'] !== 'Product') return;
    expect(Array.isArray(ldJson.offers)).toBe(true);
    expect(ldJson.offers.length).toBeGreaterThan(0);
    ldJson.offers.forEach((offer) => validateOffer(offer, sku));
  });

  test('options section matches product type', () => {
    const optionsSection = $('.product-details > div > div:contains("Options")');
    if (ldJson['@type'] === 'ProductGroup') {
      expect(optionsSection.length).toBeGreaterThanOrEqual(1);
    } else {
      expect(optionsSection).toHaveLength(0);
    }
  });

  describe('ProductGroup-specific fields', () => {
    test('productGroupId matches sku', () => {
      if (ldJson?.['@type'] !== 'ProductGroup') return;
      expect(ldJson.productGroupId).toBe(sku);
    });

    test('variesBy is an array of non-empty strings', () => {
      if (ldJson?.['@type'] !== 'ProductGroup') return;
      expect(Array.isArray(ldJson.variesBy)).toBe(true);
      expect(ldJson.variesBy.length).toBeGreaterThan(0);
      ldJson.variesBy.forEach((v) => {
        expect(typeof v).toBe('string');
        expect(v.length).toBeGreaterThan(0);
      });
    });

    test('hasVariant is an array with valid variant entries', () => {
      if (ldJson?.['@type'] !== 'ProductGroup') return;
      expect(Array.isArray(ldJson.hasVariant)).toBe(true);
      expect(ldJson.hasVariant.length).toBeGreaterThan(0);

      ldJson.hasVariant.forEach((variant) => {
        expect(variant['@type']).toBe('Product');
        expect(typeof variant.sku).toBe('string');
        expect(variant.sku.length).toBeGreaterThan(0);
        expect(typeof variant.name).toBe('string');
        expect(variant.name.length).toBeGreaterThan(0);
        expect(typeof variant.gtin).toBe('string');

        if (variant.image !== null && variant.image !== undefined) {
          expect(isValidUrl(variant.image)).toBe(true);
        }

        expect(Array.isArray(variant.offers)).toBe(true);
        expect(variant.offers.length).toBeGreaterThan(0);
        variant.offers.forEach((offer) => validateOffer(offer, variant.sku));
      });
    });

    test('variants have at least one dynamic attribute from variesBy', () => {
      if (ldJson?.['@type'] !== 'ProductGroup') return;
      const axes = ldJson.variesBy.map((v) => {
        const match = v.match(/schema\.org\/(.+)$/);
        return match ? match[1] : v;
      });

      ldJson.hasVariant.forEach((variant) => {
        const hasAtLeastOneAxis = axes.some((axis) => variant[axis] !== undefined);
        expect(hasAtLeastOneAxis).toBe(true);
      });
    });
  });
});
