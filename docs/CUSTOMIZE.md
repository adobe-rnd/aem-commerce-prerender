# Rendering Logic & Customizations

## Structured data

### GTIN & Product Codes

GTIN [is strongly recommended](https://support.google.com/merchants/answer/6324461) in the structured data but not mandatory.

From [ldJson.js](/actions/pdp-renderer/ldJson.js#L73)
```js
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
```

You can customize this function to use your own logic logic to retrieve the GTIN code, even from external sources, during the rendering process.

### Templates

The main customization point to define markup structure is [the templates folder](/actions/pdp-renderer/templates)
Those files follow the [Handlebars](https://handlebarsjs.com/) syntax and the referenced variables can be defined in [render.js](/actions/pdp-renderer/render.js)