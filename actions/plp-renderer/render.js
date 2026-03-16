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

const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { sanitize } = require('../renderUtils');
const { generatePlpLdJson } = require('./ldJson');
const { getCategoryUrl, getProductUrl } = require('../utils');
const { buildBreadcrumbs } = require('../categories');

let compiledTemplate;
function getCompiledTemplate() {
  if (!compiledTemplate) {
    const [pageHbs, headHbs, productListingHbs] = ['page', 'plp-head', 'product-listing'].map((template) =>
      fs.readFileSync(path.join(__dirname, 'templates', `${template}.hbs`), 'utf8'),
    );
    const handlebars = Handlebars.create();
    handlebars.registerPartial('head', headHbs);
    handlebars.registerPartial('content', productListingHbs);
    compiledTemplate = handlebars.compile(pageHbs);
  }
  return compiledTemplate;
}

/**
 * Generates the HTML for a category listing page.
 *
 * @param {Object} categoryData - Category metadata from the category tree.
 * @param {Array} products - Product items from productSearch (productView objects).
 * @param {Map} categoryMap - Full category map for breadcrumb resolution.
 * @param {Object} context - The context object with storeUrl, locale, pathFormat, logger.
 * @returns {string} Rendered HTML string.
 */
function generateCategoryHtml(categoryData, products, categoryMap, context) {
  const breadcrumbs = buildBreadcrumbs(categoryData.slug, categoryMap);

  // Build template data
  const categoryDescription = categoryData.metaTags?.description
    ? sanitize(categoryData.metaTags.description, 'all')
    : null;

  const categoryImage = categoryData.images?.find(
    (img) => img.roles?.includes('image') || img.customRoles?.includes('hero'),
  );

  const templateData = {
    categoryName: sanitize(categoryData.name, 'inline'),
    categoryDescription,
    slug: categoryData.slug,
    metaTitle: sanitize(categoryData.metaTags?.title || categoryData.name, 'no'),
    metaDescription: categoryData.metaTags?.description ? sanitize(categoryData.metaTags.description, 'no') : null,
    metaKeywords: categoryData.metaTags?.keywords ? sanitize(categoryData.metaTags.keywords, 'no') : null,
    metaImage: categoryImage?.url || null,
    breadcrumbs: breadcrumbs.map((crumb) => ({
      name: sanitize(crumb.name, 'inline'),
      url: getCategoryUrl(crumb.slug, context),
    })),
    products: products.map((product) => ({
      name: sanitize(product.name, 'inline'),
      url: getProductUrl({ urlKey: product.urlKey, sku: product.sku }, context),
      image: product.images?.find((img) => img.roles?.includes('image'))?.url || null,
    })),
    hasProducts: products.length > 0,
  };

  const ldJson = generatePlpLdJson(categoryData, products, breadcrumbs, context);

  const pageTemplate = getCompiledTemplate();

  return pageTemplate({
    ...templateData,
    ldJson,
  });
}

module.exports = { generateCategoryHtml };
