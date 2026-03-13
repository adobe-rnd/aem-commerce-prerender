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

const { getProductUrl } = require("../utils");

/**
 * Generates an ItemList JSON-LD object for the products in a category.
 *
 * @param {Object} category - Category object with at least a `name` property.
 * @param {Array<Object>} products - Products returned by productSearch (urlKey, sku, name).
 * @param {Object} context - Runtime context with storeUrl and pathFormat.
 * @returns {Object} schema.org ItemList structured data.
 */
function generateItemListLdJson(category, products, context) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: category.name,
    numberOfItems: products.length,
    itemListElement: products.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: product.name || product.urlKey,
      url: getProductUrl(product, context) || `${context.storeUrl}/${product.urlKey}`,
    })),
  };
}

/**
 * Generates a BreadcrumbList JSON-LD object from a breadcrumbs array.
 *
 * @param {Array<{name: string, url: string}>} breadcrumbs - Ordered breadcrumb trail.
 * @returns {Object} schema.org BreadcrumbList structured data.
 */
function generateBreadcrumbListLdJson(breadcrumbs) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

module.exports = { generateItemListLdJson, generateBreadcrumbListLdJson };
