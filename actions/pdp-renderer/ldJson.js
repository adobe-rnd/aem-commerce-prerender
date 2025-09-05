const { requestSaaS, getProductUrl } = require('../utils');
const { findDescription, getPrimaryImage } = require('./lib');
const { VariantsQuery } = require('../queries');

function getOffer(product, url) {
  const { sku, inStock, price } = product;
  const finalPriceCurrency = (price?.final?.amount?.currency || 'NONE') === 'NONE' ? 'USD' : price?.final?.amount?.currency;
  const regularPriceCurrency = (price?.regular?.amount?.currency || 'NONE') === 'NONE' ? 'USD' : price?.regular?.amount?.currency;

  const offer = {
    '@type': 'Offer',
    sku,
    url,
    availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    price: price?.final?.amount?.value,
    priceCurrency: finalPriceCurrency,
    itemCondition: 'https://schema.org/NewCondition',
  };

  if (price?.final?.amount?.value < price?.regular?.amount?.value) {
    offer.priceSpecification = {
      '@type': 'UnitPriceSpecification',
      priceType: 'https://schema.org/ListPrice',
      price: price?.regular?.amount?.value,
      priceCurrency: regularPriceCurrency,
    };
  }

  return offer;
}

async function getVariants(baseProduct, url, axes, context) {
  const { logger } = context;
  const variantsData = await requestSaaS(VariantsQuery, 'VariantsQuery', { sku: baseProduct.sku }, context);
  const variants = variantsData.data.variants.variants;

  return variants.map(variant => {
    if (!variant.product) {
      logger.error(`Variant of product ${baseProduct?.sku} is null. Variant data is not correctly synchronized.`, variant);
      throw new Error('Product variant is null');
    }

    const variantImage = getPrimaryImage(variant.product, null);
    const variantUrl = new URL(url);
    variantUrl.searchParams.append('optionsUIDs', variant.selections.sort().join(','));

    const ldJson = {
      '@type': 'Product',
      sku: variant.product.sku,
      name: variant.product.name,
      gtin: getGTIN(variant.product),
      image: variantImage ? variantImage.url : (() => {
        const fallbackImage = getPrimaryImage(baseProduct, null);
        return fallbackImage ? fallbackImage.url : null;
      })(),
      offers: [getOffer(variant.product, variantUrl.toString())],
    };
    for (let axis of axes) {
      const attribute = variant.product.attributes.find(attr => attr.name === axis);
      if (attribute) {
        ldJson[axis] = attribute.value;
      }
    }

    return ldJson;
  });
}

/**
 * Extracts the GTIN (Global Trade Item Number) from a product's attributes.
 * Checks for GTIN, UPC, or EAN attributes as defined in the Catalog.
 * 
 * @param {Object} product - The product object containing attributes
 * @returns {string} The GTIN value if found, empty string otherwise
 */
function getGTIN(product) {
  return product?.attributes?.find(attr => attr.name === 'gtin')?.value
    || product?.attributes?.find(attr => attr.name === 'upc')?.value
    || product?.attributes?.find(attr => attr.name === 'ean')?.value
    || product?.attributes?.find(attr => attr.name === 'isbn')?.value
    || '';
}

async function generateLdJson(product, context) {
  const { name, sku, __typename } = product;
  const image = getPrimaryImage(product);
  const url = getProductUrl(product, context);
  const gtin = getGTIN(product);

  let ldJson;
  if (__typename === 'SimpleProductView') {
    ldJson = {
      '@context': 'http://schema.org',
      '@type': 'Product',
      sku,
      name,
      gtin,
      description: findDescription(product, ['shortDescription', 'metaDescription', 'description']),
      '@id': url,
      offers: [getOffer(product, url)],
    };
  } else if (__typename === 'ComplexProductView') {
    const axes = product.options.map(({ id }) => id);

    const schemaOrgProperties = ['color', 'size'];

    ldJson = {
      '@context': 'http://schema.org',
      '@type': 'ProductGroup',
      sku,
      productGroupId: sku,
      name,
      gtin,
      variesBy: axes.map(axis => schemaOrgProperties.includes(axis) ? `https://schema.org/${axis}` : axis),
      description: findDescription(product, ['shortDescription', 'metaDescription', 'description']),
      '@id': url,
      hasVariant: await getVariants(product, url, axes, context),
    };
  } else {
    throw new Error('Unsupported product type');
  }

  if (image) {
    ldJson.image = image.url;
  } else {
    ldJson.image = null;
  }

  return JSON.stringify(ldJson);
}

module.exports = { generateLdJson };
