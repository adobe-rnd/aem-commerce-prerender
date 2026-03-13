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
  if(context.locale && context.locale !== 'default') {
    url = url.replace(/\s+/g, '').replace(/\/$/, '').replace('{locale}', context.locale);
  }

  const { siteToken } = context;

  let options = undefined;

  // Site Validation: needs to be a non empty string
  if (typeof siteToken === 'string' && siteToken.trim()) {
   options = {headers:{'authorization': `token ${siteToken}`}}
  }

  const baseTemplateHtml = await fetch(`${url}.plain.html`, {...options}).then(resp => resp.text());

  const $ = cheerio.load(`<main>${baseTemplateHtml}</main>`);

  blocks.forEach(block => {
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
  const allowedInlineTags = [ 'a', 'br', 'code', 'del', 'em', 'img', 'strong', 'sub', 'sup', 'u' ];
  const allowedAllTags = [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre',
    ...allowedInlineTags,
    'table', 'tbody', 'td', 'th', 'thead', 'tr',
  ];

  if (mode === 'all') {
    return striptags(html, allowedAllTags);
  } else if (mode === 'inline') {
    return striptags(html, allowedInlineTags);
  } else if (mode === 'no') {
    return striptags(html);
  }
}

module.exports = { extractPathDetails, prepareBaseTemplate, sanitize };
