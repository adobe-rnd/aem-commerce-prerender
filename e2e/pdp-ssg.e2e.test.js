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
  const res = await fetch(`${actionUrl}/products-ssg/bezier-tee/ADB177`);
  const content = await res.text();

  // Parse markup and compare
  const $ = cheerio.load(content);

  // Validate H1
  expect($('h1').text()).toEqual('Bezier tee');

  // Validate price
  expect($('.product-details > div > div:contains("Price")').next().text()).toEqual('$23.00');

  // Validate images
  expect($('.product-details > div > div:contains("Images")').next().find('a').map((_, e) => $(e).prop('outerHTML')).toArray()).toMatchInlineSnapshot(`
[
  "<a href="http://www.aemshop.net/media/catalog/product/adobestoredata/ADB177.jpg">http://www.aemshop.net/media/catalog/product/adobestoredata/ADB177.jpg</a>",
  "<a href="http://www.aemshop.net/media/catalog/product/adobestoredata/ADB177-2.jpg">http://www.aemshop.net/media/catalog/product/adobestoredata/ADB177-2.jpg</a>",
  "<a href="http://www.aemshop.net/media/catalog/product/adobestoredata/ADB177-3.jpg">http://www.aemshop.net/media/catalog/product/adobestoredata/ADB177-3.jpg</a>",
]
`);

  // Validate no options
  expect($('.product-details > div > div:contains("Options")')).toHaveLength(0);

  // Validate description
  expect($('.product-details > div > div:contains("Description")').next().html().trim()).toEqual('<div><span>This is an anodized aluminum push-action pen with a soft capacitive stylus. The stylus pen can be used for writing on paper and clicking on touch screen. The stylus helps protect your screen from smudges and increase sensitivity.Choose from different colored pens. Ink color: black.Adobe wordmark laser engraved near clip.<br><br></span></div>');

  // Validate LD-JSON
  const ldJson = JSON.parse($('script[type="application/ld+json"]').html());
  const expected = {
    "@context": "http://schema.org",
    "@type": "Product",
    "sku": "ADB177",
    "name": "Bezier tee",
    "gtin": "",
    "description": "Bezier tee",
    "@id": "https://main--aem-boilerplate-commerce-staging--hlxsites.aem.live/products-ssg/bezier-tee/ADB177",
    "offers": [
      {
        "@type": "Offer",
        "sku": "ADB177",
        "url": "https://main--aem-boilerplate-commerce-staging--hlxsites.aem.live/products-ssg/bezier-tee/ADB177",
        "availability": "https://schema.org/InStock",
        "price": 23,
        "priceCurrency": "USD",
        "itemCondition": "https://schema.org/NewCondition"
      }
    ],
    "image": "http://www.aemshop.net/media/catalog/product/adobestoredata/ADB177.jpg"
  };
  expect(ldJson).toEqual(expected);
});

test('complex product markup', async () => {
  const res = await fetch(`${actionUrl}/products-ssg/ssg-configurable-product/ssgconfig123`);
  const content = await res.text();

  // Parse markup and compare
  const $ = cheerio.load(content);

  // Validate H1
  expect($('h1').text()).toEqual('BYOM Configurable Product');

  // Validate price
  expect($('.product-details > div > div:contains("Price")').next().text()).toEqual('$40.00-$80.00');

  // Validate images
  expect($('.product-details > div > div:contains("Images")').next().find('img').map((_, e) => $(e).prop('outerHTML')).toArray()).toMatchInlineSnapshot(`
[
  "<img src="http://www.aemshop.net/media/catalog/product/a/d/adb124.jpg">",
]
`);

  // Validate options
  expect($('.product-details > div > div:contains("Options")')).toHaveLength(1);
  const optionsHtml = $('.product-details > div > div:contains("Options")').next().html().trim();

  expect(optionsHtml).toEqual(`<ul>
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
            </ul>`);

  // Validate description
  expect($('meta[name="description"]').attr('content')).toEqual('SSG Configurable Product');

  // Validate LD-JSON
  const ldJson = JSON.parse($('script[type="application/ld+json"]').html());
  const expected = {
    "@context": "http://schema.org",
    "@type": "ProductGroup",
    "sku": "SSGCONFIG123",
    "productGroupId": "SSGCONFIG123",
    "name": "BYOM Configurable Product",
    "gtin": "",
    "variesBy": [
      "https://schema.org/color"
    ],
    "description": "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
    "@id": "https://main--aem-boilerplate-commerce-staging--hlxsites.aem.live/products-ssg/ssg-configurable-product/SSGCONFIG123",
    "hasVariant": [
      {
        "@type": "Product",
        "sku": "SSGCONFIG123-blue",
        "name": "BYOM Configurable Product-blue",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/a/d/adb402_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "SSGCONFIG123-blue",
            "url": "https://main--aem-boilerplate-commerce-staging--hlxsites.aem.live/products-ssg/ssg-configurable-product/SSGCONFIG123?optionsUIDs=Y29uZmlndXJhYmxlLzI3OS80NQ%3D%3D",
            "availability": "https://schema.org/InStock",
            "price": 60,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "color": "blue"
      },
      {
        "@type": "Product",
        "sku": "SSGCONFIG123-green",
        "name": "BYOM Configurable Product-green",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/a/d/adb412_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "SSGCONFIG123-green",
            "url": "https://main--aem-boilerplate-commerce-staging--hlxsites.aem.live/products-ssg/ssg-configurable-product/SSGCONFIG123?optionsUIDs=Y29uZmlndXJhYmxlLzI3OS80Mg%3D%3D",
            "availability": "https://schema.org/InStock",
            "price": 80,
            "priceCurrency": "USD",
            "itemCondition": "https://schema.org/NewCondition"
          }
        ],
        "color": "green"
      },
      {
        "@type": "Product",
        "sku": "SSGCONFIG123-red",
        "name": "BYOM Configurable Product-red",
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/a/d/adb187_1.jpg",
        "offers": [
          {
            "@type": "Offer",
            "sku": "SSGCONFIG123-red",
            "url": "https://main--aem-boilerplate-commerce-staging--hlxsites.aem.live/products-ssg/ssg-configurable-product/SSGCONFIG123?optionsUIDs=Y29uZmlndXJhYmxlLzI3OS8zOQ%3D%3D",
            "availability": "https://schema.org/InStock",
            "price": 40,
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
  const res = await fetch(`${actionUrl}/bezier-tee?pathFormat=/{urlKey}`);
  const content = await res.text();

  // Parse markup and compare
  const $ = cheerio.load(content);

  // Validate H1
  expect($('h1').text()).toEqual('Bezier tee');
})
