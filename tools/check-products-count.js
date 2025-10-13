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

require('dotenv').config();

const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const { requestSaaS, requestPublishedProductsIndex } = require('../actions/utils');
const { GetAllSkusPaginatedQuery } = require('../actions/queries');
const filePath = path.resolve(__dirname, '..', 'app.config.yaml');

async function main() {
    let storeCodeYaml, storeUrlYaml, configNameYaml;
    try {
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const data = yaml.load(fileContents, 'utf8');
        const parameters = data?.application?.runtimeManifest?.packages['aem-commerce-ssg']?.parameters || {};
        ({
            COMMERCE_STORE_CODE: storeCodeYaml,
            COMMERCE_STORE_URL: storeUrlYaml,
            COMMERCE_CONFIG_NAME: configNameYaml
        } = parameters);
    } catch (e) {
        console.error('Error getting configuration from app.config.yaml file:', e);
    }

    const {
        COMMERCE_STORE_CODE: storeCode = storeCodeYaml,
        COMMERCE_STORE_URL: storeUrl = storeUrlYaml,
        COMMERCE_CONFIG_NAME: configName = configNameYaml,
        // eslint-disable-next-line no-undef
    } = process.env;

    const context = { storeCode: options.storecode, storeUrl: options.url, configName: options.config };
    const { total: actualCount } = await requestPublishedProductsIndex(context);
    let [productsCount, currentPage, expectedCount] = [-1, 1, 0];
    while (productsCount !== 0) {
        const { data: { productSearch: { items: products } } } = await requestSaaS(GetAllSkusPaginatedQuery, 'getAllSkusPaginated', { currentPage }, context);
        productsCount = products.length;
        expectedCount += productsCount;
        currentPage++;
    }

    if (actualCount !== expectedCount) {
        throw new Error(`Expected ${expectedCount} products, but found ${actualCount} products`);
    }
}

main().catch(console.error);
