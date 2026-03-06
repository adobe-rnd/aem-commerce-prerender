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

const { requestSaaS } = require("../utils");
const { ProductsQuery } = require("../queries");

// Limiting at 10,000 products per category
const MAX_PAGES_FETCHED = 20;
const CONCURRENCY = 5;
const pLimitPromise = import("p-limit").then(({ default: pLimit }) =>
  pLimit(CONCURRENCY),
);

const acoMapper = ({ productView }) => ({
  urlKey: productView.urlKey,
  sku: productView.sku,
  categories: (productView.categories || []).map((c) => c.slug),
});

async function getAllSkus(context) {
  const categoryPath = ""; // we are fetching all products from the catalog for ACO
  const productsResp = await requestSaaS(
    ProductsQuery,
    "getProducts",
    { currentPage: 1, categoryPath },
    context,
  );
  const products = productsResp.data.productSearch.items.map(acoMapper);
  let maxPage = productsResp.data.productSearch.page_info.total_pages;

  if (maxPage > MAX_PAGES_FETCHED) {
    console.warn(`Catalog has more than 10000 products.`);
    maxPage = MAX_PAGES_FETCHED;
  }

  const limit = await pLimitPromise;
  const pages = Array.from({ length: maxPage - 1 }, (_, i) => i + 2);
  const results = await Promise.all(
    pages.map((page) =>
      limit(() =>
        requestSaaS(
          ProductsQuery,
          "getProducts",
          { currentPage: page, categoryPath },
          context,
        ),
      ),
    ),
  );
  for (const resp of results) {
    products.push(...resp.data.productSearch.items.map(acoMapper));
  }

  return products;
}

module.exports = { getAllSkus };
