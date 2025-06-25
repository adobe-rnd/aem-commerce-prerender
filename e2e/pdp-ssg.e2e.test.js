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

const { Config } = require('@adobe/aio-sdk').Core;
const fetch = require('node-fetch');
const cheerio = require('cheerio');

// get action url
const namespace = Config.get('runtime.namespace')
const hostname = Config.get('cna.hostname') || 'adobeioruntime.net'
const runtimePackage = 'aem-commerce-ssg'
const actionUrl = `https://${namespace}.${hostname}/api/v1/web/${runtimePackage}/pdp-renderer`

test('simple product markup', async () => {
  const res = await fetch(`${actionUrl}/products/crown-summit-backpack/24-mb03`);
  const content = await res.text();

  // Parse markup and compare
  const $ = cheerio.load(content);

  // Validate H1
  expect($('h1').text()).toEqual('Crown Summit Backpack');

  // Validate price
  expect($('.product-details > div > div:contains("Price")').next().text()).toEqual('$38.00');

  // Validate images
  expect($('.product-details > div > div:contains("Images")').next().find('a').map((_, e) => $(e).prop('outerHTML')).toArray()).toMatchInlineSnapshot(`
[
  "<a href="http://www.aemshop.net/media/catalog/product/m/b/mb03-black-0.jpg">http://www.aemshop.net/media/catalog/product/m/b/mb03-black-0.jpg</a>",
  "<a href="http://www.aemshop.net/media/catalog/product/m/b/mb03-black-0_alt1.jpg">http://www.aemshop.net/media/catalog/product/m/b/mb03-black-0_alt1.jpg</a>",
]
`);

  // Validate no options
  expect($('.product-details > div > div:contains("Options")')).toHaveLength(0);

  // Validate description
  expect($('.product-details > div > div:contains("Description")').next().html().trim()).toMatchInlineSnapshot(`
"<p>The Crown Summit Backpack is equally at home in a gym locker, study cube or a pup tent, so be sure yours is packed with books, a bag lunch, water bottles, yoga block, laptop, or whatever else you want in hand. Rugged enough for day hikes and camping trips, it has two large zippered compartments and padded, adjustable shoulder straps.</p>
      <ul>
      <li>Top handle.</li>
      <li>Grommet holes.</li>
      <li>Two-way zippers.</li>
      <li>H 20" x W 14" x D 12".</li>
      <li>Weight: 2 lbs, 8 oz. Volume: 29 L.</li>
      <ul></ul></ul>"
`);

  // Validate LD-JSON
  const ldJson = JSON.parse($('script[type="application/ld+json"]').html());
  const expected = {
    "@context": "http://schema.org",
    "@type": "Product",
    "sku": "24-MB03",
    "name": "Crown Summit Backpack",
    "gtin": "",
    "description": "The Crown Summit Backpack is equally at home in a gym locker, study cube or a pup tent, so be sure yours is packed with books, a bag lunch, water bottles, yoga block, laptop, or whatever else you want in hand. Rugged enough for day hikes and camping trips, it has two large zippered compartments and padded, adjustable shoulder straps.Top handle.Grommet holes.Two-way zippers.H 20\" x W 14\" x D 12\".Weight: 2 lbs, 8 oz. Volume: 29 L.",
    "@id": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/crown-summit-backpack/24-MB03",
    "offers": [
      {
        "@type": "Offer",
        "sku": "24-MB03",
        "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/crown-summit-backpack/24-MB03",
        "availability": "https://schema.org/InStock",
        "price": 38,
        "priceCurrency": "USD",
        "itemCondition": "https://schema.org/NewCondition"
      }
    ],
    "image": "http://www.aemshop.net/media/catalog/product/m/b/mb03-black-0.jpg"
  };
  expect(ldJson).toEqual(expected);
});

test('complex product markup', async () => {
  const res = await fetch(`${actionUrl}/products/hollister-backyard-sweatshirt/mh05`);
  const content = await res.text();

  // Parse markup and compare
  const $ = cheerio.load(content);

  // Validate H1
  expect($('h1').text()).toEqual('Hollister Backyard Sweatshirt');

  // Validate price
  expect($('.product-details > div > div:contains("Price")').next().text()).toEqual('$2.00-$52.00');

  // Validate images
  expect($('.product-details > div > div:contains("Images")').next().find('img').map((_, e) => $(e).prop('outerHTML')).toArray()).toMatchInlineSnapshot(`
[
  "<img src="http://www.aemshop.net/media/catalog/product/a/d/adb124.jpg">",
]
`);

  // Validate options
  expect($('.product-details > div > div:contains("Options")')).toHaveLength(1);
  expect($('.product-details > div > div:contains("Options")').next().html().trim()).toMatchInlineSnapshot(`
"<ul>
              <li>
                <h3>Color</h3>
                option id <em>color</em>
                required <em>false</em>
                <ul>
                  <li>
                    <a href="https://main--aem-boilerplate-commerce-staging--hlxsites.aem.live/products-ssg/ssg-configurable-product/ssgconfig123?optionsUIDs=Y29uZmlndXJhYmxlLzI3OS80NQ==">blue <em>in stock</em></a>
                  </li>
                  <li>
                    <a href="https://main--aem-boilerplate-commerce-staging--hlxsites.aem.live/products-ssg/ssg-configurable-product/ssgconfig123?optionsUIDs=Y29uZmlndXJhYmxlLzI3OS80Mg==">green <em>in stock</em></a>
                  </li>
                  <li>
                    <a href="https://main--aem-boilerplate-commerce-staging--hlxsites.aem.live/products-ssg/ssg-configurable-product/ssgconfig123?optionsUIDs=Y29uZmlndXJhYmxlLzI3OS8zOQ==">red <em>in stock</em></a>
                  </li>
                </ul>
              </li>
            </ul>"
`);

  // Validate description
  expect($('.product-details > div > div:contains("Description")').next().html().trim()).toMatchInlineSnapshot(`
"<p>Kick off your weekend in the Hollister Backyard Sweatshirt. Whether you're raking leaves or flipping burgers, this comfy layer blocks the bite of the crisp autumn air. Puffy thick from hood to hem, it traps heat against your core.</p>
      <p>• Cream crewneck sweatshirt with navy sleeves/trim.<br>• Relaxed fit. <br>• Ribbed cuffs and hem. <br>• Machine wash/dry.</p>"
`);

  // Validate LD-JSON
  const ldJson = JSON.parse($('script[type="application/ld+json"]').html());
  const expected = {
    "@context": "http://schema.org",
    "@type": "ProductGroup",
    "sku": "MH05",
    "productGroupId": "MH05",
    "name": "Hollister Backyard Sweatshirt",
    "gtin": "",
    "variesBy": [
      "https://schema.org/size",
      "https://schema.org/color"
    ],
    "description": "Kick off your weekend in the Hollister Backyard Sweatshirt. Whether you're raking leaves or flipping burgers, this comfy layer blocks the bite of the crisp autumn air. Puffy thick from hood to hem, it traps heat against your core.&bull; Cream crewneck sweatshirt with navy sleeves/trim.&bull; Relaxed fit. &bull; Ribbed cuffs and hem. &bull; Machine wash/dry.",
    "@id": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05",
    "hasVariant": [
      {
        "@type": "Product",
        "sku": "MH05-L-Green",
        "name": "Hollister Backyard Sweatshirt-L-Green",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-green_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-L-Green",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8xODQ%3D%2CY29uZmlndXJhYmxlLzU1Ni81MzI%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "L",
        "color": "Green"
      },
      {
        "@type": "Product",
        "sku": "MH05-L-Red",
        "name": "Hollister Backyard Sweatshirt-L-Red",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-red_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-L-Red",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8xOTk%3D%2CY29uZmlndXJhYmxlLzU1Ni81MzI%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "L",
        "color": "Red"
      },
      {
        "@type": "Product",
        "sku": "MH05-L-White",
        "name": "Hollister Backyard Sweatshirt-L-White",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-white_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-L-White",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8yMDI%3D%2CY29uZmlndXJhYmxlLzU1Ni81MzI%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "L",
        "color": "White"
      },
      {
        "@type": "Product",
        "sku": "MH05-M-Green",
        "name": "Hollister Backyard Sweatshirt-M-Green",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-green_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-M-Green",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8xODQ%3D%2CY29uZmlndXJhYmxlLzU1Ni81Mjk%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "M",
        "color": "Green"
      },
      {
        "@type": "Product",
        "sku": "MH05-M-Red",
        "name": "Hollister Backyard Sweatshirt-M-Red",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-red_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-M-Red",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8xOTk%3D%2CY29uZmlndXJhYmxlLzU1Ni81Mjk%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "M",
        "color": "Red"
      },
      {
        "@type": "Product",
        "sku": "MH05-M-White",
        "name": "Hollister Backyard Sweatshirt-M-White",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-white_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-M-White",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8yMDI%3D%2CY29uZmlndXJhYmxlLzU1Ni81Mjk%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "M",
        "color": "White"
      },
      {
        "@type": "Product",
        "sku": "MH05-S-Green",
        "name": "Hollister Backyard Sweatshirt-S-Green",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-green_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-S-Green",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8xODQ%3D%2CY29uZmlndXJhYmxlLzU1Ni81MjY%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "S",
        "color": "Green"
      },
      {
        "@type": "Product",
        "sku": "MH05-S-Red",
        "name": "Hollister Backyard Sweatshirt-S-Red",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-red_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-S-Red",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8xOTk%3D%2CY29uZmlndXJhYmxlLzU1Ni81MjY%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "S",
        "color": "Red"
      },
      {
        "@type": "Product",
        "sku": "MH05-S-White",
        "name": "Hollister Backyard Sweatshirt-S-White",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-white_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-S-White",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8yMDI%3D%2CY29uZmlndXJhYmxlLzU1Ni81MjY%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "S",
        "color": "White"
      },
      {
        "@type": "Product",
        "sku": "MH05-XL-Green",
        "name": "Hollister Backyard Sweatshirt-XL-Green",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-green_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-XL-Green",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8xODQ%3D%2CY29uZmlndXJhYmxlLzU1Ni81MzU%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "XL",
        "color": "Green"
      },
      {
        "@type": "Product",
        "sku": "MH05-XL-Red",
        "name": "Hollister Backyard Sweatshirt-XL-Red",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-red_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-XL-Red",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8xOTk%3D%2CY29uZmlndXJhYmxlLzU1Ni81MzU%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "XL",
        "color": "Red"
      },
      {
        "@type": "Product",
        "sku": "MH05-XL-White",
        "name": "Hollister Backyard Sweatshirt-XL-White",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-white_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-XL-White",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8yMDI%3D%2CY29uZmlndXJhYmxlLzU1Ni81MzU%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "XL",
        "color": "White"
      },
      {
        "@type": "Product",
        "sku": "MH05-XS-Green",
        "name": "Hollister Backyard Sweatshirt-XS-Green",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-green_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-XS-Green",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8xODQ%3D%2CY29uZmlndXJhYmxlLzU1Ni81MjM%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "XS",
        "color": "Green"
      },
      {
        "@type": "Product",
        "sku": "MH05-XS-Red",
        "name": "Hollister Backyard Sweatshirt-XS-Red",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-red_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-XS-Red",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8xOTk%3D%2CY29uZmlndXJhYmxlLzU1Ni81MjM%3D",
            "availability": "https://schema.org/InStock",
            "price": 52,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "XS",
        "color": "Red"
      },
      {
        "@type": "Product",
        "sku": "MH05-XS-White",
        "name": "Hollister Backyard Sweatshirt-XS-White",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-white_main_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "MH05-XS-White",
            "url": "https://main--aem-commerce-ssg-storefront--adobe-rnd.aem.live/products/hollister-backyard-sweatshirt/MH05?optionsUIDs=Y29uZmlndXJhYmxlLzI3Ny8yMDI%3D%2CY29uZmlndXJhYmxlLzU1Ni81MjM%3D",
            "availability": "https://schema.org/InStock",
            "price": 40,
            "priceCurrency": "NONE",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "size": "XS",
        "color": "White"
      }
    ],
    "image": "http://www.aemshop.net/media/catalog/product/m/h/mh05-white_main_1.jpg"
  };
  expect(ldJson).toEqual(expected);
});

test('product by urlKey', async () => {
  const res = await fetch(`${actionUrl}/crown-summit-backpack?pathFormat=/{urlKey}`);
  const content = await res.text();

  // Parse markup and compare
  const $ = cheerio.load(content);

  // Validate H1
  expect($('h1').text()).toEqual('Crown Summit Backpack');
})
