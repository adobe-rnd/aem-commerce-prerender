/*

Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.

*/

const { CategoriesQuery, ProductCountQuery, ProductsQuery } = require('../queries');
const { Core, Files } = require('@adobe/aio-sdk')
const { requestSaaS, FILE_PREFIX } = require('../utils');
const { Timings } = require('../lib/benchmark');

async function getSkus(categoryPath, context) {
  let productsResp = await requestSaaS(ProductsQuery, 'getProducts', { currentPage: 1, categoryPath }, context);
  const products = [...productsResp.data.productSearch.items.map(({ productView }) => (
    {
      urlKey: productView.urlKey,
      sku: productView.sku
    }
  ))];  
  let maxPage = productsResp.data.productSearch.page_info.total_pages;

  if (maxPage > 20) {
    console.warn(`Category ${categoryPath} has more than 10000 products.`);
    maxPage = 20;
  }

  for (let currentPage = 2; currentPage <= maxPage; currentPage++) {
    productsResp = await requestSaaS(ProductsQuery, 'getProducts', { currentPage, categoryPath }, context);
     products.push(...productsResp.data.productSearch.items.map(({ productView }) => (
      {
        urlKey: productView.urlKey,
        sku: productView.sku
      }
    )));
  }

  return products;
}

async function getAllCategories(context) {
  const categories = [];
  const categoriesResp = await requestSaaS(CategoriesQuery, 'getCategories', {}, context);
  const items = categoriesResp.data.categories;
  for (const {urlPath, level, name} of items) {
    const index = parseInt(level);
    categories[index] = categories[index] || [];
    categories[index].push({urlPath, name, level});
  }
  return categories;
}

async function getAllSkus(context) {
  const productCountResp = await requestSaaS(ProductCountQuery, 'getProductCount', { categoryPath: '' }, context);
  const productCount = productCountResp.data.productSearch?.page_info?.total_pages;

  if (!productCount) {
    throw new Error('Unknown product count.');
  }

  if (productCount <= 10000) {
    // we can get everything from the default category
    return getSkus('', context);
  }

  const products = new Set();
  // we have to traverse the category tree
  const categories = await getAllCategories(context);

  outer: for (const category of categories) {
    if (!category) continue;
    while (category.length) {
      const slice = category.splice(0, 50);
      const fetchedProducts = await Promise.all(slice.map((category) => getSkus(category.urlPath, context)));
      fetchedProducts.flatMap((skus) => skus).forEach((sku) => products.add(sku));
      if (products.size >= productCount) {
        // break if we got all products already
        break outer;
      }
    }
  }

  if (products.size !== productCount) {
    console.warn(`Expected ${productCount} products, but got ${products.size}.`);
  }

  return [...products];
}

async function main(params) {
  const logger = Core.Logger('main', { level: params.LOG_LEVEL || 'info' })
  const {
    SITE: siteName,
    ORG: orgName,
    CONTENT_URL: contentUrl,
    CONFIG_NAME: configName = 'configs',
    CONFIG_SHEET: configSheet,
  } = params;
  if (!siteName || !orgName || !contentUrl) {
    return {
      statusCode: 400,
      body: {
        status: 'error',
        message: 'missing required parameters'
      }
    }
  }
  const storeUrl = params.STORE_URL;
  const locales = params.LOCALES ? params.LOCALES.split(',') : [null];
  const sharedContext = {
    configName,
    configSheet,
    storeUrl,
    contentUrl,
    logger: logger,
  };

  const results = await Promise.all(locales.map(async (locale) => {
    const context = { ...sharedContext };
    if (locale) {
      context.locale = locale;
    }
    const timings = new Timings();
    const stateFilePrefix = locale || 'default';
    const allSkus = await getAllSkus(context);
    timings.sample('getAllSkus');
    const filesLib = await Files.init(params.libInit || {});
    timings.sample('saveFile');
    const productsFileName = `${FILE_PREFIX}/${stateFilePrefix}-products.json`;
    await filesLib.write(productsFileName, JSON.stringify(allSkus));
    return timings.measures;
  }));

  const response = {
    statusCode: 200,
    body: {
      status: 'completed',
      timings: results,
    }
  }
  return response;
}

exports.main = main
