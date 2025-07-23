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
 * Finds the description of a product based on a priority list of fields.
 * @param {Object} product The product object.
 * @param {Array<string>} priority The list of fields to check for the description, in order of priority.
 * @returns {string} The description of the product.
 */
function findDescription(product, priority = ['metaDescription', 'shortDescription', 'description']) {
  return priority
    .map(d => product[d]?.trim() || '')
    .map(d => striptags(d))
    .map(d => d.replace(/\r?\n|\r/g, ''))
    .find(d => d.length > 0) || '';
}

/**
 * Returns the first image of a product based on the specified role or the first image if no role is specified.
 * @param {Object} product The product.
 * @param {string} [role='image'] The role of the image to find.
 * @returns {Object|undefined} The primary image object or undefined if not found.
 */
function getPrimaryImage(product, role = 'image') {
  if (role) {
    return product?.images?.find(img => img.roles.includes(role));
  }

  return product?.images?.length > 0 ? product?.images?.[0] : undefined;
}

/**
 * Returns the base template for a product detail page. It loads a Edge Delivery page and replaces specified blocks with Handlebars partials.
 *
 * @param {string} url The URL to fetch the base template HTML from.
 * @param {Array<string>} blocks The list of block class names to replace with Handlebars partials.
 * @returns {Promise<string>} The adapted base template HTML as a string.
 */
async function prepareBaseTemplate(url, blocks, context) {
  if(context.locale && context.locale !== 'default') {
    url = url.replace(/\s+/g, '').replace(/\/$/, '').replace('{locale}', context.locale);
  }

  const baseTemplateHtml = await fetch(`${url}.plain.html`).then(resp => resp.text());

  const $ = cheerio.load(`<main>${baseTemplateHtml}</main>`);

  blocks.forEach(block => {
      $(`.${block}`).replaceWith(`{{> ${block} }}`);
  });

  let adaptedBaseTemplate = $('main').prop('innerHTML');
  adaptedBaseTemplate = adaptedBaseTemplate.replace(/&gt;/g, '>') + '\n';

  return adaptedBaseTemplate;
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
      currency: (!currency || currency === 'NONE') ? 'USD' : currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
  });
};

/**
 * Generates a formatted price string of a simple or complex product.
 * 
 * @param {Object} product Product object.
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
 * Generates a list of image URLs for a product, ensuring the primary image is first.
 * 
 * @param {string} primary The URL of the primary image.
 * @param {Array<Object>} images The list of image objects.
 * @returns {Array<string>} The list of image URLs with the primary image first.
 */
function getImageList(primary, images) {
  const imageList = images?.map(img => img.url);
  if (primary) {
    const primaryImageIndex = imageList.indexOf(primary);
    if (primaryImageIndex > -1) {
      imageList.splice(primaryImageIndex, 1);
      imageList.unshift(primary);
    }
  }
  return imageList;
}

module.exports = { extractPathDetails, findDescription, getPrimaryImage, prepareBaseTemplate, generatePriceString, getImageList };
