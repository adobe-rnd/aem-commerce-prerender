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

const { requestSaaS } = require("./utils");
const {
  CategoriesQuery,
  CategoryTreeQuery,
  CategoryTreeBySlugsQuery,
} = require("./queries");

const MAX_TREE_DEPTH = 3;

/**
 * Checks whether category families are configured (not the [null] default).
 *
 * @param {Array} families - The categoryFamilies array from runtime config.
 * @returns {boolean}
 */
function hasFamilies(families) {
  return Array.isArray(families) && families.length > 0;
}

/**
 * Resolves all categories belonging to the given ACO category families,
 * returning a Map of slug → full category metadata.
 *
 * Uses BFS traversal of the categoryTree API:
 *  1. Query each family's root categories and their immediate childrenSlugs.
 *  2. Query those children (with depth) to retrieve their descendants.
 *  3. Repeat until no unresolved childrenSlugs remain.
 *
 * Handles trees of arbitrary depth even when the API caps depth at
 * MAX_TREE_DEPTH per call — each iteration advances up to that many levels.
 *
 * Shared by getCategorySlugsFromFamilies and getCategoryDataFromFamilies.
 *
 * @param {Object} context - Request context (config, logger, headers, etc.).
 * @param {string[]} families - ACO category family identifiers.
 * @returns {Promise<Map<string, Object>>} Map of category slug to category metadata.
 */
async function fetchCategoryTree(context, families) {
  console.debug("Getting category data from families:", families);
  const categoryMap = new Map();

  for (const family of families) {
    console.debug("Getting category data from family:", family);
    // Get root-level categories for this family
    const firstLevel = await requestSaaS(
      CategoryTreeQuery,
      "getCategoryTree",
      { family },
      context,
    );

    let pending = [];
    for (const cat of firstLevel.data.categoryTree) {
      categoryMap.set(cat.slug, cat);
      pending.push(...(cat.childrenSlugs || []));
    }

    // BFS: resolve children level by level until no new slugs remain
    while (pending.length) {
      // Mark pending as seen before querying to prevent re-processing
      for (const slug of pending) {
        if (!categoryMap.has(slug)) categoryMap.set(slug, null);
      }

      const childrenRes = await requestSaaS(
        CategoryTreeBySlugsQuery,
        "getCategoryTreeBySlugs",
        { family, slugs: pending, depth: MAX_TREE_DEPTH },
        context,
      );

      // First pass: capture any descendant slugs included due to depth traversal
      for (const cat of childrenRes.data.categoryTree) {
        categoryMap.set(cat.slug, cat);
      }

      // Second pass: collect only new childrenSlugs for next iteration
      pending = [];
      for (const cat of childrenRes.data.categoryTree) {
        for (const child of cat.childrenSlugs || []) {
          if (!categoryMap.has(child)) pending.push(child);
        }
      }
    }
  }
  console.debug("Category slugs resolved:", [...categoryMap.keys()]);

  return categoryMap;
}

/**
 * Resolves all category slugs belonging to the given ACO category families.
 *
 * Uses BFS traversal of the categoryTree API via fetchCategoryTree.
 *
 * @param {Object} context - Request context (config, logger, headers, etc.).
 * @param {string[]} families - ACO category family identifiers.
 * @returns {Promise<string[]>} Flat array of all unique category slugs.
 */
async function getCategorySlugsFromFamilies(context, families) {
  const categoryMap = await fetchCategoryTree(context, families);
  return [...categoryMap.keys()];
}

/**
 * Resolves all categories with full metadata from the given ACO category families.
 *
 * Uses BFS traversal of the categoryTree API via fetchCategoryTree.
 *
 * @param {Object} context - Request context (config, logger, headers, etc.).
 * @param {string[]} families - ACO category family identifiers.
 * @returns {Promise<Map<string, Object>>} Map of category slug to category metadata.
 */
async function getCategoryDataFromFamilies(context, families) {
  return fetchCategoryTree(context, families);
}

/**
 * Last-resort fallback: converts a slug segment to a human-readable name
 * when the category is not found in the map (e.g. if a childSlug was
 * referenced but not returned by the API).
 * E.g. "computers-tablets" → "Computers Tablets"
 *
 * Callers should always prefer category.name from the API response.
 */
function humanizeSlugSegment(segment) {
  return segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Derives breadcrumb trail from a category slug path.
 *
 * @param {string} slug - The category slug (e.g. "electronics/computers-tablets/laptops").
 * @param {Map<string, Object>} categoryMap - The category map for name resolution.
 * @returns {Array<{name: string, slug: string}>} Breadcrumb entries.
 */
function buildBreadcrumbs(slug, categoryMap) {
  const segments = slug.split("/");
  const breadcrumbs = [];

  for (let i = 0; i < segments.length; i++) {
    const ancestorSlug = segments.slice(0, i + 1).join("/");
    const category = categoryMap.get(ancestorSlug);
    const name = category?.name || humanizeSlugSegment(segments[i]);
    breadcrumbs.push({ name, slug: ancestorSlug });
  }

  return breadcrumbs;
}

/**
 * Retrieves all ACCS categories grouped by level.
 *
 * Returns a sparse array indexed by category level so callers can iterate
 * shallowest levels first (used for the early-exit optimization when
 * fetching products by category).
 *
 * @param {Object} context - Request context (config, logger, headers, etc.).
 * @returns {Promise<string[][]>} Sparse array where index N holds urlPath strings at level N.
 */
async function getCategories(context) {
  const categoriesRes = await requestSaaS(
    CategoriesQuery,
    "getCategories",
    {},
    context,
  );
  const byLevel = [];
  for (const { urlPath, level } of categoriesRes.data.categories) {
    const idx = parseInt(level);
    byLevel[idx] = byLevel[idx] || [];
    byLevel[idx].push(urlPath);
  }
  return byLevel;
}

module.exports = {
  getCategorySlugsFromFamilies,
  getCategoryDataFromFamilies,
  getCategories,
  hasFamilies,
  buildBreadcrumbs,
};
