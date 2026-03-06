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

const {
  CategoriesQuery,
  ProductCountQuery,
  ProductsQuery,
} = require("../queries");
const { requestSaaS } = require("../utils");

// Limiting at 10,000 products per category
const MAX_PAGES_FETCHED = 20;

const accsMapper = ({ productView }) => ({
  urlKey: productView.urlKey,
  sku: productView.sku,
});

async function getAllCategories(context) {
  const categories = [];
  const categoriesResp = await requestSaaS(
    CategoriesQuery,
    "getCategories",
    {},
    context,
  );
  const items = categoriesResp.data.categories;
  for (const { urlPath, level, name } of items) {
    const index = parseInt(level);
    categories[index] = categories[index] || [];
    categories[index].push({ urlPath, name, level });
  }
  return categories;
}

async function getSkus(categoryPath, context) {
  let productsResp = await requestSaaS(
    ProductsQuery,
    "getProducts",
    { currentPage: 1, categoryPath },
    context,
  );
  const products = [...productsResp.data.productSearch.items.map(accsMapper)];
  let maxPage = productsResp.data.productSearch.page_info.total_pages;

  if (maxPage > MAX_PAGES_FETCHED) {
    console.warn(`Category ${categoryPath} has more than 10000 products.`);
    maxPage = MAX_PAGES_FETCHED;
  }

  for (let currentPage = 2; currentPage <= maxPage; currentPage++) {
    productsResp = await requestSaaS(
      ProductsQuery,
      "getProducts",
      { currentPage, categoryPath },
      context,
    );
    products.push(...productsResp.data.productSearch.items.map(accsMapper));
  }

  return products;
}

async function getAllSkus(context) {
  const productCountResp = await requestSaaS(
    ProductCountQuery,
    "getProductCount",
    { categoryPath: "" },
    context,
  );
  const productCount =
    productCountResp.data.productSearch?.page_info?.total_pages;

  if (!productCount) {
    throw new Error("Unknown product count.");
  }

  if (productCount <= 10000) {
    // we can get everything from the default category
    return getSkus("", context);
  }

  const products = new Set();
  // we have to traverse the category tree
  const categories = await getAllCategories(context);

  outer: for (const category of categories) {
    if (!category) continue;
    while (category.length) {
      const slice = category.splice(0, 50);
      const fetchedProducts = await Promise.all(
        slice.map((cat) => getSkus(cat.urlPath, context)),
      );
      fetchedProducts
        .flatMap((skus) => skus)
        .forEach((sku) => products.add(sku));
      if (products.size >= productCount) {
        // break if we got all products already
        break outer;
      }
    }
  }

  if (products.size !== productCount) {
    console.warn(
      `Expected ${productCount} products, but got ${products.size}.`,
    );
  }

  return [...products];
}

module.exports = { getAllSkus };
