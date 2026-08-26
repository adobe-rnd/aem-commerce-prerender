# Rendering Logic & Customizations

## PDP (Product Detail Pages)

### Structured data

#### GTIN & Product Codes

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
  return (
    product?.attributes?.find((attr) => attr.name === 'gtin')?.value ||
    product?.attributes?.find((attr) => attr.name === 'upc')?.value ||
    product?.attributes?.find((attr) => attr.name === 'ean')?.value ||
    product?.attributes?.find((attr) => attr.name === 'isbn')?.value ||
    ''
  );
}
```

You can customize this function to use your own logic logic to retrieve the GTIN code, even from external sources, during the rendering process.

### Templates

The main customization point to define markup structure is [the templates folder](/actions/pdp-renderer/templates)
Those files follow the [Handlebars](https://handlebarsjs.com/) syntax and the referenced variables can be defined in [render.js](/actions/pdp-renderer/render.js)

## PLP (Product Listing Pages)

### Structured data

The PLP renderer generates [CollectionPage](https://schema.org/CollectionPage) JSON-LD with an `ItemList` of products and a `BreadcrumbList`. The logic is defined in [ldJson.js](/actions/plp-renderer/ldJson.js).

### Category Image Selection

The PLP renderer selects a category image for the `og:image` meta tag and general display. By default it prefers an image with the `BASE` role, falling back to the first available image.

From [render.js](/actions/plp-renderer/render.js):

```js
const categoryImage = categoryData.images?.find((img) => img.roles?.includes('BASE')) || categoryData.images?.[0];
```

You can customize this to match a different role (`SMALL`, `THUMBNAIL`, `SWATCH`) or a custom role defined in your catalog.

### Templates

PLP markup templates follow the same [Handlebars](https://handlebarsjs.com/) pattern as PDP. The templates are in [the templates folder](/actions/plp-renderer/templates) and the referenced variables can be defined in [render.js](/actions/plp-renderer/render.js).

## E2E Testing

End-to-end tests verify that the deployed `pdp-renderer` and `plp-renderer` actions return correctly structured HTML and JSON-LD. They run against your live Adobe I/O Runtime deployment.

### Configuration

Test inputs are defined in [`e2e/config.json`](/e2e/config.json):

```json
{
  "pdpSku": "ADB177",
  "plpSlug": "apparel"
}
```

- `pdpSku` -- the product SKU to use for PDP rendering tests
- `plpSlug` -- the category slug to use for PLP rendering tests

Update these values to match products and categories available in your catalog.

### Running the tests

```bash
npm run e2e
```

The tests validate structural correctness and field-level checks on the rendered HTML and JSON-LD, without asserting on catalog-specific values like product names or image domains.
