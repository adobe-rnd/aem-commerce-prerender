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

const striptags = require('striptags');
const { getCategoryUrl, getProductUrl } = require('../utils');
const { getProductPrice, getGTIN, getBrand } = require('../renderUtils');

function buildOffer(product, productUrl) {
  const price = getProductPrice(product);
  if (!price) return null;

  return {
    '@type': 'Offer',
    url: productUrl,
    price: price.value,
    priceCurrency: price.currency,
    availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    itemCondition: 'https://schema.org/NewCondition',
  };
}

/**
 * Generates CollectionPage JSON-LD for a PLP page, containing an ItemList
 * of products and a BreadcrumbList.
 *
 * @param {Object} categoryData - Category metadata from the category tree.
 * @param {Array} products - Product items from productSearch.
 * @param {Array} breadcrumbs - Breadcrumb entries with { name, slug }.
 * @param {Object} context - The context object with storeUrl, locale, pathFormat.
 * @returns {string} JSON-LD string.
 */
function generatePlpLdJson(categoryData, products, breadcrumbs, context) {
  const itemList = {
    '@type': 'ItemList',
    name: categoryData.name,
    numberOfItems: products.length,
    itemListElement: products.map((product, index) => {
      const productUrl = getProductUrl({ sku: product.sku, urlKey: product.urlKey }, context);
      const image = product.images?.find((img) => img.roles?.includes('image'))?.url || null;
      const description = product.shortDescription
        ? striptags(product.shortDescription)
            .replace(/\r?\n|\r/g, '')
            .trim()
        : null;
      const offer = buildOffer(product, productUrl);
      const gtin = getGTIN(product);
      const brand = getBrand(product);

      const productItem = {
        '@type': 'Product',
        name: product.name,
        sku: product.sku,
        url: productUrl,
        ...(gtin ? { gtin } : {}),
        ...(brand ? { brand: { '@type': 'Brand', name: brand } } : {}),
        ...(image ? { image } : {}),
        ...(description ? { description } : {}),
        ...(offer ? { offers: [offer] } : {}),
      };

      return {
        '@type': 'ListItem',
        position: index + 1,
        item: productItem,
      };
    }),
  };

  const breadcrumbList = {
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: getCategoryUrl(crumb.slug, context),
    })),
  };

  const collectionPage = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: categoryData.name,
    breadcrumb: breadcrumbList,
    mainEntity: itemList,
  };

  return JSON.stringify(collectionPage);
}

module.exports = { generatePlpLdJson };
