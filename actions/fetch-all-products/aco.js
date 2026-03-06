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

const pLimit = require("p-limit");
const { requestSaaS } = require("../utils");
const { ProductsQuery } = require("../queries");

const acoMapper = ({ productView }) => ({
  urlKey: productView.urlKey,
  sku: productView.sku,
  categories: (productView.categories || []).map((c) => c.slug),
});

async function getSkus(
  categoryPath,
  context,
  { mapItem, pageLimit = 20, concurrency = 1 } = {},
) {
  let productsResp = await requestSaaS(
    ProductsQuery,
    "getProducts",
    { currentPage: 1, categoryPath },
    context,
  );
  const products = productsResp.data.productSearch.items.map(mapItem);
  let maxPage = productsResp.data.productSearch.page_info.total_pages;

  if (pageLimit !== Infinity && maxPage > pageLimit) {
    console.warn(
      `Category ${categoryPath} has more than ${pageLimit * 500} products.`,
    );
    maxPage = pageLimit;
  }

  if (concurrency > 1 && maxPage > 1) {
    const limit = pLimit(concurrency);
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
      products.push(...resp.data.productSearch.items.map(mapItem));
    }
  } else {
    for (let currentPage = 2; currentPage <= maxPage; currentPage++) {
      productsResp = await requestSaaS(
        ProductsQuery,
        "getProducts",
        { currentPage, categoryPath },
        context,
      );
      products.push(...productsResp.data.productSearch.items.map(mapItem));
    }
  }

  return products;
}

async function getAllSkus(context) {
  return getSkus("", context, {
    mapItem: acoMapper,
    pageLimit: Infinity,
    concurrency: 5,
  });
}

module.exports = { getAllSkus };
