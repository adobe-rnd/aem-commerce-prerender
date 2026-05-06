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

const striptags = require('striptags');
const cheerio = require('cheerio');
const { isValidUrl, STATE_FILE_EXT } = require('./utils');
const { JobFailedError, ERROR_CODES } = require('./lib/errorHandler');

const PUBLIC_HTML_DIR = '/public/pdps';

/**
 * Constructs the file-system path for a rendered HTML page.
 *
 * @param {string} pagePath - The page path (e.g. '/en/products/foo/sku123').
 * @returns {string} The full file path.
 */
function getHtmlFilePath(pagePath) {
  return `${PUBLIC_HTML_DIR}${pagePath}.html`;
}

/**
 * Extracts details from the path based on the provided format.
 * @param {string} path The path.
 * @param {string} format The format to extract details from the path.
 * @returns {Object} An object containing the extracted details.
 * @throws Throws an error if the path is invalid.
 */
function extractPathDetails(path, format) {
  if (!path) {
    return {};
  }

  const formatParts = format.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  if (formatParts.length !== pathParts.length) {
    throw new Error(`Invalid path. Expected '${format}' format.`);
  }

  const result = {};
  formatParts.forEach((part, index) => {
    if (part.startsWith('{') && part.endsWith('}')) {
      const key = part.substring(1, part.length - 1);
      result[key] = pathParts[index];
    } else if (part !== pathParts[index]) {
      throw new Error(`Invalid path. Expected '${format}' format.`);
    }
  });

  return result;
}

/**
 * Returns the base template for a page. It loads an Edge Delivery page and replaces
 * specified blocks with Handlebars partials.
 *
 * @param {string} url The URL to fetch the base template HTML from.
 * @param {Array<string>} blocks The list of block class names to replace with Handlebars partials.
 * @param {Object} context The context object.
 * @returns {Promise<string>} The adapted base template HTML as a string.
 */
async function prepareBaseTemplate(url, blocks, context) {
  if (context.locale && context.locale !== 'default') {
    url = url.replace(/\s+/g, '').replace(/\/$/, '').replace('{locale}', context.locale);
  }

  const { siteToken } = context;

  let options = undefined;

  // Site Validation: needs to be a non empty string
  if (typeof siteToken === 'string' && siteToken.trim()) {
    options = { headers: { authorization: `token ${siteToken}` } };
  }

  const templateUrl = `${url}.plain.html`;
  const resp = await fetch(templateUrl, { ...options });
  if (!resp.ok) {
    context.logger?.warn(`Products template not found (${resp.status}): ${templateUrl} — body content will be empty`);
  }
  const baseTemplateHtml = resp.ok ? await resp.text() : '';

  const $ = cheerio.load(`<main>${baseTemplateHtml}</main>`);

  blocks.forEach((block) => {
    $(`.${block}`).replaceWith(`{{> ${block} }}`);
  });

  let adaptedBaseTemplate = $('main').prop('innerHTML');
  adaptedBaseTemplate = adaptedBaseTemplate.replace(/&gt;/g, '>') + '\n';

  return adaptedBaseTemplate;
}

/**
 * Sanitizes HTML content by removing disallowed or unbalanced tags.
 * Supports three modes: 'all', 'inline', 'no'.
 * 'all': allows all block and inline tags supported by edge delivery.
 * 'inline': allows all inline tags supported by edge delivery.
 * 'no': allows no tags
 *
 * @param {string} html - HTML string to sanitize
 * @param {string} [mode='all'] - Sanitization mode
 * @returns {string} Sanitized HTML string
 */
function sanitize(html, mode = 'all') {
  const allowedInlineTags = ['a', 'br', 'code', 'del', 'em', 'img', 'strong', 'sub', 'sup', 'u'];
  const allowedAllTags = [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'pre',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    ...allowedInlineTags,
  ];

  if (mode === 'all') {
    return striptags(html, allowedAllTags);
  } else if (mode === 'inline') {
    return striptags(html, allowedInlineTags);
  } else if (mode === 'no') {
    return striptags(html);
  }
}

/**
 * Constructs a file path for state/data files.
 *
 * @param {string} prefix - The file prefix (e.g. FILE_PREFIX or PLP_FILE_PREFIX).
 * @param {string} stateKey - The state key (typically locale or 'default').
 * @param {string} extension - The file extension.
 * @returns {string} The constructed file path.
 */
function getFileLocation(prefix, stateKey, extension) {
  return `${prefix}/${stateKey}.${extension}`;
}

/**
 * Loads poller state from the cloud file system.
 *
 * @param {string} locale - The locale (or store code).
 * @param {Object} aioLibs - { filesLib }.
 * @param {string} filePrefix - The file prefix for this poller's state files.
 * @param {string} dataKey - The property name on the state object (e.g. 'skus' or 'categories').
 * @returns {Promise<Object>} State object with { locale, [dataKey]: { ... } }.
 */
async function loadState(locale, aioLibs, filePrefix, dataKey) {
  const { filesLib } = aioLibs;
  const stateObj = { locale, [dataKey]: {} };
  try {
    const stateKey = locale || 'default';
    const fileLocation = getFileLocation(filePrefix, stateKey, STATE_FILE_EXT);
    const buffer = await filesLib.read(fileLocation);
    const stateData = buffer?.toString();
    if (stateData) {
      const lines = stateData.split('\n');
      stateObj[dataKey] = lines.reduce((acc, line) => {
        const [key, time, hash] = line.split(',');
        if (key) {
          acc[key] = { lastRenderedAt: new Date(parseInt(time)), hash };
        }
        return acc;
      }, {});
    }
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    stateObj[dataKey] = {};
  }
  return stateObj;
}

/**
 * Saves poller state to the cloud file system.
 *
 * @param {Object} state - The state object with { locale, [dataKey]: { ... } }.
 * @param {Object} aioLibs - { filesLib }.
 * @param {string} filePrefix - The file prefix for this poller's state files.
 * @param {string} dataKey - The property name on the state object (e.g. 'skus' or 'categories').
 * @returns {Promise<void>}
 */
async function saveState(state, aioLibs, filePrefix, dataKey) {
  const { filesLib } = aioLibs;
  const stateKey = state.locale || 'default';
  const fileLocation = getFileLocation(filePrefix, stateKey, STATE_FILE_EXT);
  const csvData = Object.entries(state[dataKey])
    .filter(([, { lastRenderedAt }]) => Boolean(lastRenderedAt))
    .map(([key, { lastRenderedAt, hash }]) => `${key},${lastRenderedAt.getTime()},${hash || ''}`)
    .join('\n');
  return await filesLib.write(fileLocation, csvData);
}

/**
 * Deletes poller state from the cloud file system.
 *
 * @param {string} locale - The locale key.
 * @param {Object} filesLib - The Files library instance.
 * @param {string} filePrefix - The file prefix for this poller's state files.
 * @returns {Promise<void>}
 */
async function deleteState(locale, filesLib, filePrefix) {
  const stateKey = `${locale}`;
  const fileLocation = getFileLocation(filePrefix, stateKey, STATE_FILE_EXT);
  await filesLib.delete(fileLocation);
}

/**
 * Checks if an item should be previewed & published based on hash comparison.
 *
 * @param {{ currentHash: string, newHash: string }} item
 * @returns {boolean}
 */
function shouldPreviewAndPublish({ currentHash, newHash }) {
  return newHash && currentHash !== newHash;
}

/**
 * Processes a published batch: updates state entries for successfully
 * published records and increments the appropriate counters.
 *
 * @param {Object} publishedBatch - The batch result from AdminAPI.
 * @param {Object} state - The current poller state.
 * @param {Object} counts - Mutable counters ({ published, failed, ... }).
 * @param {Array} items - The rendered items that were submitted for publishing.
 * @param {Object} aioLibs - { filesLib }.
 * @param {Object} options
 * @param {string} options.dataKey - State property name (e.g. 'skus' or 'categories').
 * @param {string} options.keyField - Record identifier field (e.g. 'sku' or 'slug').
 * @param {string} options.filePrefix - File prefix for saving state.
 */
async function processPublishedBatch(publishedBatch, state, counts, items, aioLibs, { dataKey, keyField, filePrefix }) {
  const { records } = publishedBatch;
  records.forEach((record) => {
    if (record.previewedAt && record.publishedAt) {
      const item = items.find((i) => i[keyField] === record[keyField]);
      state[dataKey][record[keyField]] = {
        lastRenderedAt: record.renderedAt,
        hash: item?.newHash,
      };
      counts.published++;
    } else {
      counts.failed++;
    }
  });
  await saveState(state, aioLibs, filePrefix, dataKey);
}

/**
 * Validates that all required parameters are present and that storeUrl (if
 * provided) is a valid URL. Throws JobFailedError on failure.
 *
 * @param {Object} params - The parameters object.
 * @param {string[]} requiredParams - List of required parameter names.
 */
function validateRequiredParams(params, requiredParams) {
  const missingParams = requiredParams.filter((param) => !params[param]);
  if (missingParams.length > 0) {
    throw new JobFailedError(
      `Missing required parameters: ${missingParams.join(', ')}`,
      ERROR_CODES.VALIDATION_ERROR,
      400,
      { missingParams },
    );
  }

  if (params.storeUrl && !isValidUrl(params.storeUrl)) {
    throw new JobFailedError('Invalid storeUrl', ERROR_CODES.VALIDATION_ERROR, 400);
  }
}

/**
 * Finds the description of a product based on a priority list of fields.
 * @param {Object} product The product object.
 * @param {Array<string>} priority The list of fields to check for the description, in order of priority.
 * @returns {string} The description of the product.
 */
function findDescription(product, priority = ['metaDescription', 'shortDescription', 'description']) {
  return (
    priority
      .map((d) => product[d]?.trim() || '')
      .map((d) => striptags(d))
      .map((d) => d.replace(/\r?\n|\r/g, ''))
      .find((d) => d.length > 0) || ''
  );
}

/**
 * Returns the first image of a product based on the specified role or the first image if no role is specified.
 * @param {Object} product The product.
 * @param {string} [role='image'] The role of the image to find.
 * @returns {Object|undefined} The primary image object or undefined if not found.
 */
function getPrimaryImage(product, role = 'image') {
  if (role) {
    return product?.images?.find((img) => img.roles.includes(role));
  }

  return product?.images?.length > 0 ? product?.images?.[0] : undefined;
}

/**
 * Generates a list of image URLs for a product, ensuring the primary image is first.
 *
 * @param {string} primary The URL of the primary image.
 * @param {Array<Object>} images The list of image objects.
 * @returns {Array<string>} The list of image URLs with the primary image first.
 */
function getImageList(primary, images) {
  const imageList = images?.map((img) => img.url);
  if (primary) {
    const primaryImageIndex = imageList.indexOf(primary);
    if (primaryImageIndex > -1) {
      imageList.splice(primaryImageIndex, 1);
      imageList.unshift(primary);
    }
  }
  return imageList;
}

/**
 * Returns a number formatter for the specified locale and currency.
 *
 * @param {string} [locale] The locale to use for formatting. Defaults to us-en.
 * @param {string} [currency] The currency code to use for formatting. Defaults to USD.
 * @returns {Intl.NumberFormat} The number formatter.
 */
function getFormatter(locale = 'us-en', currency) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: !currency || currency === 'NONE' ? 'USD' : currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Generates a formatted price string of a simple or complex product.
 *
 * @param {Object} product Product object.
 * @param {string} [localeCode] Locale code for formatting. Defaults to us-en.
 * @returns {string} Formatted price string.
 */
function generatePriceString(product, localeCode = 'us-en') {
  const { price, priceRange } = product;
  let currency = priceRange ? priceRange?.minimum?.regular?.amount?.currency : price?.regular?.amount?.currency;
  const format = getFormatter(localeCode, currency).format;
  let priceString = '';

  if (priceRange) {
    const hasRange = priceRange.minimum.final.amount.value !== priceRange.maximum.final.amount.value;
    if (hasRange) {
      const minimumDiscounted = priceRange.minimum.regular.amount.value > priceRange.minimum.final.amount.value;
      if (minimumDiscounted) {
        priceString = `<s>${format(priceRange.minimum.regular.amount.value)}</s> ${format(priceRange.minimum.final.amount.value)}`;
      } else {
        priceString = `${format(priceRange.minimum.final.amount.value)}`;
      }
      priceString += '-';
      const maximumDiscounted = priceRange.maximum.regular.amount.value > priceRange.maximum.final.amount.value;
      if (maximumDiscounted) {
        priceString += `<s>${format(priceRange.maximum.regular.amount.value)}</s> ${format(priceRange.maximum.final.amount.value)}`;
      } else {
        priceString += `${format(priceRange.maximum.final.amount.value)}`;
      }
    } else {
      const isDiscounted = priceRange.minimum.regular.amount.value > priceRange.minimum.final.amount.value;
      if (isDiscounted) {
        priceString = `<s>${format(priceRange.minimum.regular.amount.value)}</s> ${format(priceRange.minimum.final.amount.value)}`;
      } else {
        priceString = `${format(priceRange.minimum.final.amount.value)}`;
      }
    }
  } else if (price) {
    const isDiscounted = price.regular.amount.value > price.final.amount.value;
    if (isDiscounted) {
      priceString = `<s>${format(price.regular.amount.value)}</s> ${format(price.final.amount.value)}`;
    } else {
      priceString = `${format(price.final.amount.value)}`;
    }
  }
  return priceString;
}

/**
 * Extracts the final price amount from a product, handling both simple (price)
 * and complex (priceRange) product types. For complex products the minimum
 * price is used.
 *
 * @param {Object} product The product object.
 * @returns {{ value: number, currency: string } | null}
 */
function getProductPrice(product) {
  const priceAmount = product.price?.final?.amount || product.priceRange?.minimum?.final?.amount;
  if (!priceAmount) return null;

  const currency = !priceAmount.currency || priceAmount.currency === 'NONE' ? 'USD' : priceAmount.currency;
  return { value: priceAmount.value, currency };
}

/**
 * Extracts the GTIN (Global Trade Item Number) from a product's attributes.
 * Checks for GTIN, UPC, EAN, or ISBN attributes.
 *
 * @param {Object} product - The product object containing attributes.
 * @returns {string} The GTIN value if found, empty string otherwise.
 */
function getGTIN(product) {
  return (
    product?.attributes?.find((attr) => attr.name === 'gtin')?.value ||
    product?.attributes?.find((attr) => attr.name === 'upc')?.value ||
    product?.attributes?.find((attr) => attr.name === 'ean')?.value ||
    product?.attributes?.find((attr) => attr.name === 'isbn')?.value ||
    ''
  );
}

/**
 * Extracts the brand name from a product's attributes.
 *
 * @param {Object} product - The product object containing attributes.
 * @returns {string} The brand value if found, empty string otherwise.
 */
function getBrand(product) {
  return product?.attributes?.find((attr) => attr.name === 'brand')?.value || '';
}

module.exports = {
  extractPathDetails,
  prepareBaseTemplate,
  sanitize,
  PUBLIC_HTML_DIR,
  getHtmlFilePath,
  getFileLocation,
  loadState,
  saveState,
  deleteState,
  shouldPreviewAndPublish,
  processPublishedBatch,
  validateRequiredParams,
  findDescription,
  getPrimaryImage,
  getImageList,
  getFormatter,
  generatePriceString,
  getProductPrice,
  getGTIN,
  getBrand,
};
