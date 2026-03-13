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

const { getCategoryUrl, getProductUrl } = require('../utils');

/**
 * Generates ItemList and BreadcrumbList JSON-LD for a PLP page.
 *
 * @param {Object} categoryData - Category metadata from the category tree.
 * @param {Array} products - Product items from productSearch.
 * @param {Array} breadcrumbs - Breadcrumb entries with { name, slug }.
 * @param {Object} context - The context object with storeUrl, locale, pathFormat.
 * @returns {{ itemListLdJson: string, breadcrumbLdJson: string }}
 */
function generatePlpLdJson(categoryData, products, breadcrumbs, context) {
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: categoryData.name,
    numberOfItems: products.length,
    itemListElement: products.map((product, index) => {
      const productUrl = getProductUrl(
        { sku: product.sku, urlKey: product.urlKey },
        context
      );
      const image = product.images?.find(img => img.roles?.includes('image'))?.url || null;

      return {
        '@type': 'ListItem',
        position: index + 1,
        name: product.name,
        url: productUrl,
        ...(image ? { image } : {}),
      };
    }),
  };

  const breadcrumbList = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: getCategoryUrl(crumb.slug, context),
    })),
  };

  return {
    itemListLdJson: JSON.stringify(itemList),
    breadcrumbLdJson: JSON.stringify(breadcrumbList),
  };
}

module.exports = { generatePlpLdJson };
