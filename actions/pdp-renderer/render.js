const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { findDescription, prepareBaseTemplate, getPrimaryImage, generatePriceString, getImageList, sanitize } = require('./lib');
const { generateLdJson } = require('./ldJson');
const { requestSaaS, getProductUrl } = require('../utils');
const { ProductQuery, ProductByUrlKeyQuery } = require('../queries');

const productTemplateCache = {};
// according to https://www.aem.live/developer/markup-reference

function toTemplateProductData(baseProduct) {
  const primaryImage = getPrimaryImage(baseProduct)?.url;

  return {
    name: sanitize(baseProduct.name, 'inline'),
    description: sanitize(baseProduct.description, 'all'),
    externalId: sanitize(baseProduct.externalId, 'no'),
    sku: sanitize(baseProduct.sku, 'no'),
    __typename: sanitize(baseProduct.__typename, 'no'),
    metaDescription: findDescription(baseProduct),
    metaKeyword: sanitize(baseProduct.metaKeyword, 'no'),
    metaTitle: sanitize(baseProduct.metaTitle, 'no') || sanitize(baseProduct.name, 'no') || 'Product Details',
    metaImage: primaryImage,
    primaryImage: primaryImage,
    options: baseProduct.options ? [...baseProduct.options] : null,
    hasImages: baseProduct.images?.length > 0,
    imageList: getImageList(primaryImage, baseProduct.images),
    priceString: generatePriceString(baseProduct),
  };
}

async function generateProductHtml(sku, urlKey, context) {
  if (!sku && !urlKey) {
    const error = new Error('Either sku or urlKey must be provided');
    error.statusCode = 404;
    throw error;
  }
  const logger = context.logger;
  let baseProduct;
  if (sku) {
    const baseProductData = await requestSaaS(ProductQuery, 'ProductQuery', { sku }, context);
    if (!baseProductData?.data?.products || baseProductData?.data?.products?.length === 0) {
      const error = new Error('Product not found');
      error.statusCode = 404;
      throw error;
    }
    baseProduct = baseProductData.data.products[0];
  } else if (urlKey) {
    const baseProductData = await requestSaaS(ProductByUrlKeyQuery, 'ProductByUrlKey', { urlKey }, context);
    if (!baseProductData?.data?.productSearch || baseProductData?.data?.productSearch?.items?.length === 0) {
      const error = new Error('Product not found');
      error.statusCode = 404;
      throw error;
    }
    baseProduct = baseProductData.data.productSearch.items[0].productView;
  }
  logger.debug('Retrieved base product', JSON.stringify(baseProduct, null, 4));

  if (baseProduct.options && baseProduct.options.length > 0) {
    baseProduct.options = baseProduct.options.map((option) => {
      const baseUrl = getProductUrl(baseProduct, context);
      if (Array.isArray(option.values)) {
        option.values = option.values.map((value) => ({
          title: sanitize(value.title, 'inline'),
          url: baseUrl.toLowerCase() + '?optionsUIDs=' + value.id,
        }));
        option.values.sort((a, b) => a.title.localeCompare(b.title));
      }
      return {
        title: sanitize(option.title, 'inline'),
        id: sanitize(option.id, 'no'),
        required: sanitize(option.required, 'no'),
        values: option.values
      };
    });
  }

  // Assign meta tag data for template
  const templateProductData = toTemplateProductData(baseProduct);

  // Generate LD-JSON
  const ldJson = await generateLdJson(baseProduct, context);

  // Load the Handlebars template
  const [pageHbs, headHbs, productDetailsHbs] = ['page', 'head', 'product-details'].map((template) => fs.readFileSync(path.join(__dirname, 'templates', `${template}.hbs`), 'utf8'));
  const pageTemplate = Handlebars.compile(pageHbs);
  Handlebars.registerPartial('head', headHbs);
  Handlebars.registerPartial('product-details', productDetailsHbs);

  // Retrieve default product page as template
  const blocksToReplace = ['product-details'];

  const localeKey = context.locale || 'default';

  if (context.productsTemplate) {
    const productsTemplateURL = context.productsTemplate.replace(/\s+/g, '').replace('{locale}', localeKey);
    if (!productTemplateCache[localeKey]) productTemplateCache[localeKey] = {};
    if (!productTemplateCache[localeKey].baseTemplate) productTemplateCache[localeKey].baseTemplate = prepareBaseTemplate(productsTemplateURL, blocksToReplace, context);
    const baseTemplate = await productTemplateCache[localeKey].baseTemplate;
    Handlebars.registerPartial('content', baseTemplate);
  } else {
    // Use product details block as sole content if no products template is defined
    Handlebars.registerPartial('content', productDetailsHbs);
  }

  return pageTemplate({
    ...templateProductData,
    ldJson,
  });
}

module.exports = {
  generateProductHtml,
};
