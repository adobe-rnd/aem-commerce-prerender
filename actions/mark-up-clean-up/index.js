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

const { Core, Files } = require('@adobe/aio-sdk');
const { ObservabilityClient } = require('../lib/observability');
const { GetUrlKeyQuery } = require('../queries');
const { getRuntimeConfig } = require('../lib/runtimeConfig');
const {
  requestSaaS,
  requestSpreadsheet,
  PDP_FILE_EXT,
} = require('../utils');

/**
 * helper function for markUpCleanUP() below
 * check if the path of a published product is in the list of path of products queried from graphql
 * @param {*} publishedProduct 
 * @param {*} checkedProducts 
 * @returns 
 */
function urlkeymatch(publishedProduct, queriedProducts){
  let path = publishedProduct.path.split('/');
  path = path.pop();  
  const result = queriedProducts.some((product) => { 
    if (path === product.urlKey) {
      return true;
    }    
  });  
  return result;
}

/**
 * using published products index and graphql query to check for redundant markup file and delete from storage.  
 * @param {Object} context - The context object with logger and other utilities
 * @param {Object} filesLib - The files library instance from '@adobe/aio-sdk'
 */
async function markUpCleanUP(context, filesLib, logger) {
  
  try {    
    const publishedProducts = await requestSpreadsheet('published-products-index', null, context);  
    const publishedSkus = publishedProducts.data.map((product) => product.sku);
    let queryResult = await requestSaaS(GetUrlKeyQuery, 'getUrlKey', { skus: publishedSkus }, context);
    queryResult = queryResult.data.products    

    const redundantpublishedProducts = publishedProducts.data.filter((product) => !urlkeymatch(product, queryResult))
    context.counts.detected = redundantpublishedProducts.length;
    
    for (const product of redundantpublishedProducts) {
      try {        
        const result = await filesLib.delete(`/public/pdps${product.path}.${PDP_FILE_EXT}`);
        if (result.length > 0) {
          logger.info(`Deleted redundant markup at ${product.path}.${PDP_FILE_EXT} for product ${product.sku}`);
          context.counts.deleted++;          
        }
      } catch (e) {
        // ignore file does not exist error
        if (e.code !== 'ERROR_FILE_NOT_EXISTS') {
          logger.error('Error while cleanning up markup storage', e);
        }
      }
    };    
  } catch (e) {
    logger.error('Error while cleanning up markup storage', e);
  }

  return {...context.counts } ;
}

async function main(params) {
  const cfg = getRuntimeConfig(params);
  const logger = Core.Logger('main', { level: cfg.logLevel || 'info' });
  const observabilityClient = new ObservabilityClient(logger, { 
    token: cfg.adminAuthToken, 
    endpoint: cfg.logIngestorEndpoint,
    org: cfg.org,
    site: cfg.site
  });
  const filesLib = await Files.init(params.libInit || {});  

  const {
    // required
    pathFormat,
    locales,
    configName,
    configSheet,
    productsTemplate,
    storeUrl,
    contentUrl,
    logLevel,
    logIngestorEndpoint,
  } = cfg;

  const counts = { detected: 0, deleted: 0 };

  const sharedContext = {
    storeUrl,
    contentUrl,
    configName,
    configSheet,
    logger,
    counts,
    pathFormat,
    productsTemplate,
    logLevel,
    logIngestorEndpoint,
  }

  let activationResult = {status: {}};

  for (const locale of locales) {    
    const context = { ...sharedContext, startTime: new Date() };
    let tempLocale = 'default';
    if (locale) {
      context.locale = locale;
      tempLocale = locale;
    } 

    activationResult.status[tempLocale] = await markUpCleanUP(context, filesLib, logger);
  }

  await observabilityClient.sendActivationResult(activationResult);
  return activationResult;
}

exports.main = main