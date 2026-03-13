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

const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");
const cheerio = require("cheerio");
const striptags = require("striptags");
const { requestSaaS } = require("../utils");
const { CategoryProductsQuery } = require("../queries");
const {
  generateItemListLdJson,
  generateBreadcrumbListLdJson,
} = require("./ldJson");

const categoryTemplateCache = {};

/**
 * Builds the breadcrumb trail for a category by walking up parentSlug references.
 *
 * @param {Object} category - The target category.
 * @param {Map<string, Object>} categoriesMap - All resolved categories keyed by slug.
 * @param {string} storeUrl - Base store URL for constructing links.
 * @returns {Array<{name: string, slug: string, url: string}>}
 */
function buildBreadcrumbs(category, categoriesMap, storeUrl) {
  const crumbs = [];
  let current = category;

  while (current) {
    crumbs.unshift({
      name: current.name,
      slug: current.slug,
      url: `${storeUrl}/${current.slug}`,
    });
    if (current.parentSlug && categoriesMap.has(current.parentSlug)) {
      current = categoriesMap.get(current.parentSlug);
    } else {
      break;
    }
  }

  crumbs.unshift({ name: "Home", slug: "", url: storeUrl });
  return crumbs;
}

/**
 * Fetches the first page of products belonging to a category slug.
 *
 * @param {string} categorySlug - Category slug used as categoryPath filter.
 * @param {Object} context - Runtime context.
 * @returns {Promise<Array<{urlKey: string, sku: string, name: string}>>}
 */
async function getCategoryProducts(categorySlug, context) {
  const result = await requestSaaS(
    CategoryProductsQuery,
    "getCategoryProducts",
    { currentPage: 1, categoryPath: categorySlug },
    context,
  );
  return result.data.productSearch.items.map((item) => item.productView);
}

/**
 * Resolves child categories into presentable subcategory objects.
 *
 * @param {Object} category - Parent category.
 * @param {Map<string, Object>} categoriesMap - All resolved categories.
 * @param {string} storeUrl - Base store URL.
 * @returns {Array<{name: string, slug: string, url: string, description: string}>}
 */
function getSubcategories(category, categoriesMap, storeUrl) {
  if (!category.childrenSlugs?.length) return [];
  return category.childrenSlugs
    .filter((slug) => categoriesMap.has(slug))
    .map((slug) => {
      const child = categoriesMap.get(slug);
      return {
        name: child.name,
        slug: child.slug,
        url: `${storeUrl}/${child.slug}`,
        description: child.metaTags?.description || "",
      };
    });
}

/**
 * Fetches an authored AEM page and replaces specified blocks with Handlebars partials.
 *
 * @param {string} url - URL of the AEM template page.
 * @param {string[]} blocks - Block class names to replace with Handlebars partials.
 * @param {Object} context - Runtime context with siteToken, locale, etc.
 * @returns {Promise<string>} Adapted base template HTML.
 */
async function prepareBaseTemplate(url, blocks, context) {
  if (context.locale && context.locale !== "default") {
    url = url
      .replace(/\s+/g, "")
      .replace(/\/$/, "")
      .replace("{locale}", context.locale);
  }

  const { siteToken } = context;
  let options;

  if (typeof siteToken === "string" && siteToken.trim()) {
    options = { headers: { authorization: `token ${siteToken}` } };
  }

  const baseTemplateHtml = await fetch(`${url}.plain.html`, {
    ...options,
  }).then((resp) => resp.text());

  const $ = cheerio.load(`<main>${baseTemplateHtml}</main>`);

  blocks.forEach((block) => {
    const existing = $(`.${block}`);
    if (existing.length) {
      existing.replaceWith(`{{> ${block} }}`);
    } else {
      $("main").prepend(`{{> ${block} }}\n`);
    }
  });

  let adaptedBaseTemplate = $("main").prop("innerHTML");
  adaptedBaseTemplate = adaptedBaseTemplate.replace(/&gt;/g, ">") + "\n";

  return adaptedBaseTemplate;
}

/**
 * Renders a complete HTML page for a single category.
 *
 * @param {Object} category - Full category detail from the tree API.
 * @param {Map<string, Object>} categoriesMap - All resolved categories (for breadcrumbs/subcats).
 * @param {Object} context - Runtime context with storeUrl, pathFormat, logger, etc.
 * @returns {Promise<string>} Rendered HTML string.
 */
async function renderCategoryPage(category, categoriesMap, context) {
  const { storeUrl } = context;

  const breadcrumbs = buildBreadcrumbs(category, categoriesMap, storeUrl);
  const subcategories = getSubcategories(category, categoriesMap, storeUrl);
  const products = await getCategoryProducts(category.slug, context);

  const metaTitle =
    category.metaTags?.title || category.name || "Category";
  const metaDescription = striptags(category.metaTags?.description || "");
  const metaKeywords = category.metaTags?.keywords || "";
  const description = category.metaTags?.description || "";

  const itemListLdJson = generateItemListLdJson(category, products, context);
  const breadcrumbListLdJson = generateBreadcrumbListLdJson(breadcrumbs);

  const templateData = {
    metaTitle,
    metaDescription,
    metaKeywords,
    slug: category.slug,
    name: category.name,
    description,
    hasDescription: !!description,
    breadcrumbs,
    subcategories,
    hasSubcategories: subcategories.length > 0,
    itemListLdJson: JSON.stringify(itemListLdJson),
    breadcrumbListLdJson: JSON.stringify(breadcrumbListLdJson),
  };

  const [pageHbs, headHbs, categoryHbs] = ["page", "head", "category"].map(
    (t) =>
      fs.readFileSync(
        path.join(__dirname, "templates", `${t}.hbs`),
        "utf8",
      ),
  );

  Handlebars.registerPartial("category-details", categoryHbs);

  const blocksToReplace = ["category-details"];
  const localeKey = context.locale || "default";

  if (context.categoriesTemplate) {
    const categoriesTemplateURL = context.categoriesTemplate
      .replace(/\s+/g, "")
      .replace("{locale}", localeKey);
    if (!categoryTemplateCache[localeKey]) categoryTemplateCache[localeKey] = {};
    if (!categoryTemplateCache[localeKey].baseTemplate) {
      categoryTemplateCache[localeKey].baseTemplate = prepareBaseTemplate(
        categoriesTemplateURL,
        blocksToReplace,
        context,
      );
    }
    const baseTemplate = await categoryTemplateCache[localeKey].baseTemplate;
    Handlebars.registerPartial("content", baseTemplate);
  } else {
    Handlebars.registerPartial("content", `<div>${categoryHbs}</div>`);
  }

  const pageTemplate = Handlebars.compile(pageHbs);
  Handlebars.registerPartial("head", headHbs);

  return pageTemplate(templateData);
}

module.exports = { renderCategoryPage, buildBreadcrumbs };
