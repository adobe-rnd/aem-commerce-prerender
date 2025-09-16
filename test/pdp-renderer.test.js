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

const cheerio = require('cheerio');
const { http, HttpResponse } = require('msw');

const { useMockServer, handlers } = require('./mock-server.js');

jest.mock('@adobe/aio-sdk', () => ({
  Core: {
    Logger: jest.fn()
  }
}))


const { Core } = require('@adobe/aio-sdk')
const mockLoggerInstance = { info: jest.fn(), debug: jest.fn(), error: jest.fn() }
Core.Logger.mockReturnValue(mockLoggerInstance)

const action = require('./../actions/pdp-renderer/index.js')
const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");

beforeEach(() => {
  Core.Logger.mockClear()
  mockLoggerInstance.info.mockReset()
  mockLoggerInstance.debug.mockReset()
  mockLoggerInstance.error.mockReset()
})

const fakeParams = {
  __ow_headers: {},
};

describe('pdp-renderer', () => {
  const server = useMockServer();

  describe('basic functionality', () => {
    test('main should be defined', () => {
      expect(action.main).toBeInstanceOf(Function)
    })

    test('should set logger to use LOG_LEVEL param', async () => {
      await action.main({ ...fakeParams, CONTENT_URL: 'https://content.com', LOG_LEVEL: 'fakeLevel' })
      expect(Core.Logger).toHaveBeenCalledWith(expect.any(String), { level: 'fakeLevel' })
    })

    test('should return an http response with error for invalid path', async () => {
      const response = await action.main({ ...fakeParams, CONTENT_URL: 'https://content.com'})
      expect(response).toEqual({
        error: {
          statusCode: 400,
          body: {
            error: 'Missing required parameters: sku or urlKey must be provided',
          },
        },
      })
    })
  })

  describe('product rendering', () => {
    test('render with product template', async () => {
      server.use(handlers.defaultProductTemplate);
      server.use(handlers.defaultProduct());

      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCTS_TEMPLATE: "https://content.com/products/default",
        PRODUCT_PAGE_URL_FORMAT: '/products/{urlKey}/{sku}',
        __ow_path: `/products/crown-summit-backpack/24-MB03`,
      });

      expect(response.body).toBeDefined();
      expect(typeof response.body).toBe('string');
      
      const $ = cheerio.load(response.body);
      expect($('.product-recommendations')).toHaveLength(1);
      expect($('body > main > div')).toHaveLength(2);
    });

    test('render without product template', async () => {
      server.use(handlers.defaultProduct());

      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/products/{urlKey}/{sku}',
        __ow_path: `/products/crown-summit-backpack/24-MB03`,
      });

      const $ = cheerio.load(response.body);
      expect($('main .product-details')).toHaveLength(1);
      expect($('main .product-recommendations')).toHaveLength(1);
    });

    test('render with localized product template', async () => {
      server.use(handlers.localizedProductTemplate);
      server.use(handlers.defaultProduct());

      let configRequestUrl;
      const mockConfig = require('./mock-responses/mock-config.json');
      server.use(http.get('https://content.com/en/config.json', async (req) => {
        configRequestUrl = req.request.url;
        return HttpResponse.json(mockConfig);
      }));

      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCTS_TEMPLATE: "https://content.com/{locale}/products/default",
        PRODUCT_PAGE_URL_FORMAT: '/{locale}/products/{urlKey}/{sku}',
        __ow_path: `/en/products/crown-summit-backpack/24-MB03`,
      });

      expect(response.body).toBeDefined();
      expect(typeof response.body).toBe('string');

      const $ = cheerio.load(response.body);
      expect($('.product-recommendations')).toHaveLength(1);
      expect($('body > main > div')).toHaveLength(2);
      expect(configRequestUrl).toBe('https://content.com/en/config.json');
    });
  })

  describe('product lookup methods', () => {
    test('get product by sku', async () => {
      server.use(handlers.defaultProduct());

      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/products/{sku}',
        __ow_path: `/products/24-MB03`,
      });

      const $ = cheerio.load(response.body);
      expect($('main .product-details h1').text()).toEqual('Crown Summit Backpack');
    });

    test('get product by urlKey', async () => {
      server.use(handlers.defaultProductLiveSearch());

      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/{urlKey}',
        __ow_path: `/crown-summit-backpack`,
      });
     
      const $ = cheerio.load(response.body);
      expect($('main .product-details h1').text()).toEqual('Crown Summit Backpack');
    });
  })

  describe('localization', () => {
    test('render product with locale', async () => {
      server.use(handlers.defaultProduct());

      let configRequestUrl;
      const mockConfig = require('./mock-responses/mock-config.json');
      server.use(http.get('https://content.com/en/config.json', async (req) => {
        configRequestUrl = req.request.url;
        return HttpResponse.json(mockConfig);
      }));

      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/{locale}/products/{sku}',
        __ow_path: `/en/products/24-MB03`,
      });

      expect(configRequestUrl).toBe('https://content.com/en/config.json');

      // Validate product
      const $ = cheerio.load(response.body);
      expect($('main .product-details h1').text()).toEqual('Crown Summit Backpack');

      // Validate product url in structured data
      const ldJson = JSON.parse($('head > script[type="application/ld+json"]').html());
      expect(ldJson.offers[0].url).toEqual('https://store.com/en/products/24-MB03');
    });
  })

  describe('error handling', () => {
    test('return 400 if neither sku nor urlKey are provided', async () => {
      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/{urlPath}',
        __ow_path: `/crown-summit-backpack`,
      });

      expect(response.error.statusCode).toEqual(400);
    });

    test('returns 404 if product does not exist', async () => {
      server.use(handlers.return404());

      const response = await action.main({
        STORE_URL: 'https://aemstore.net',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/products/{urlKey}/{sku}',
        __ow_path: '/products/crown-summit-backpack/sku-is-404',
      });

      expect(response.error.statusCode).toEqual(404);
    });
  })

  describe('product content rendering', () => {
    beforeEach(() => {
      server.use(handlers.defaultProduct());
    });

    const getProductResponse = async () => {
      return action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/products/{urlKey}/{sku}',
        __ow_path: `/products/crown-summit-backpack/24-MB03`,
      });
    };

    test('render images', async () => {
      const response = await getProductResponse();
      
      const $ = cheerio.load(response.body);

      expect(
          $('main .product-details h2:contains("Images")')
              .parent()
              .next()
              .find('img')
              .map((_, e) => $(e).prop('outerHTML'))
              .toArray()
      ).toEqual([
        '<img src="http://www.aemshop.net/media/catalog/product/m/b/mb03-black-0.jpg">',
        '<img src="http://www.aemshop.net/media/catalog/product/m/b/mb03-black-0_alt1.jpg">'
      ]);
    });

    test('render description', async () => {
      const response = await getProductResponse();
      
      const $ = cheerio.load(response.body);
      const descContainer = $('main .product-details h2:contains("Description")').parent().next();

      const descText = descContainer.find('p').text().trim();
      expect(descText).toContain('The Crown Summit Backpack is equally at home');

      const bullets = descContainer.find('li').map((_, e) => $(e).text().trim()).toArray();
      expect(bullets).toEqual([
        'Top handle.',
        'Grommet holes.',
        'Two-way zippers.',
        'H 20" x W 14" x D 12".',
        'Weight: 2 lbs, 8 oz. Volume: 29 L.'
      ]);
    });

    test('render price', async () => {
      const response = await getProductResponse();
      
      const $ = cheerio.load(response.body);

      expect(
          $('main .product-details h2:contains("Price")')
              .parent()
              .next()
              .text()
      ).toBe('$38.00');
    });

    test('render title', async () => {
      const response = await getProductResponse();
      
      const $ = cheerio.load(response.body);
      expect($('main .product-details h1').text()).toEqual('Crown Summit Backpack');
    });
  })

  describe('product options', () => {
    test('render product without options', async () => {
      server.use(handlers.defaultProduct());

      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/products/{urlKey}/{sku}',
        __ow_path: `/products/crown-summit-backpack/24-MB03`,
      });

      const $ = cheerio.load(response.body);
      expect($('body > main > div.product-details > div > div:contains("Options")')).toHaveLength(0);
    });

    test('render product with options', async () => {
      server.use(handlers.defaultComplexProduct());
      server.use(handlers.defaultVariant());

      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/products/{urlKey}/{sku}',
        __ow_path: `/products/crown-summit-backpack/24-MB03`,
      });

      const $ = cheerio.load(response.body);
      const optionsHeader = $('main .product-details h2:contains("Options")').first();
      expect(optionsHeader).toHaveLength(1);

      const optionsContainer = optionsHeader.parent().next();
      expect(optionsContainer.find('li').length).toBeGreaterThan(0);
    });
  })

  describe('SEO and metadata', () => {
    test('render metadata', async () => {
      server.use(handlers.defaultProduct());

      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/products/{urlKey}/{sku}',
        __ow_path: `/products/crown-summit-backpack/24-MB03`,
      });

      const $ = cheerio.load(response.body);
      expect($('head > meta')).toHaveLength(8);
      expect($('head > meta[name="description"]').attr('content')).toMatchInlineSnapshot(`"The Crown Summit Backpack is equally at home in a gym locker, study cube or a pup tent, so be sure yours is packed with books, a bag lunch, water bottles, yoga block, laptop, or whatever else you want in hand. Rugged enough for day hikes and camping trips, it has two large zippered compartments and padded, adjustable shoulder straps.Top handle.Grommet holes.Two-way zippers.H 20" x W 14" x D 12".Weight: 2 lbs, 8 oz. Volume: 29 L."`);
      expect($('head > meta[name="keywords"]').attr('content')).toEqual('backpack, hiking, camping');
      expect($('head > meta[name="image"]').attr('content')).toEqual('http://www.aemshop.net/media/catalog/product/m/b/mb03-black-0.jpg');
      expect($('head > meta[name="id"]').attr('content')).toEqual('7');
      expect($('head > meta[name="sku"]').attr('content')).toEqual('24-MB03');
      expect($('head > meta[name="__typename"]').attr('content')).toEqual('SimpleProductView');
      expect($('head > meta[property="og:type"]').attr('content')).toEqual('og:product');
    });

    test('render ld+json', async () => {
      server.use(handlers.defaultProduct());

      const response = await action.main({
        STORE_URL: 'https://store.com',
        CONTENT_URL: 'https://content.com',
        CONFIG_NAME: 'config',
        PRODUCT_PAGE_URL_FORMAT: '/products/{urlKey}/{sku}',
        __ow_path: `/products/crown-summit-backpack/24-MB03`,
      });

      const $ = cheerio.load(response.body);
      const ldJson = JSON.parse($('head > script[type="application/ld+json"]').html());
      expect(ldJson).toEqual({
        "@context": "http://schema.org",
        "@id": "https://store.com/products/crown-summit-backpack/24-MB03",
        "@type": "Product",
        "description": 'The Crown Summit Backpack is equally at home in a gym locker, study cube or a pup tent, so be sure yours is packed with books, a bag lunch, water bottles, yoga block, laptop, or whatever else you want in hand. Rugged enough for day hikes and camping trips, it has two large zippered compartments and padded, adjustable shoulder straps.Top handle.Grommet holes.Two-way zippers.H 20" x W 14" x D 12".Weight: 2 lbs, 8 oz. Volume: 29 L.',
        "gtin": "",
        "image": "http://www.aemshop.net/media/catalog/product/m/b/mb03-black-0.jpg",
        "name": "Crown Summit Backpack",
        "offers": [
          {
            "@type": "Offer",
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/NewCondition",
            "price": 38,
            "priceCurrency": "USD",
            "sku": "24-MB03",
            "url": "https://store.com/products/crown-summit-backpack/24-MB03",
          },
        ],
        "sku": "24-MB03",
      });
    });
  })
})

describe('generateProductHtml', () => {
  const { generateProductHtml } = require('../actions/pdp-renderer/render');
  const mockConfig = require('./mock-responses/mock-config.json');
  const server = useMockServer();
  const defaultContext = {
    logger: { debug: jest.fn() },
    storeUrl: 'https://store.com',
    contentUrl: 'https://content.com', 
    configName: 'config',
  };

  // Mock the getConfig function to avoid HTTP requests
  beforeEach(() => {
    // Add config handler to mock server
    server.use(
      http.get('https://content.com/config.json', () => {
        return HttpResponse.json(mockConfig);
      })
    );
  });

  describe('error handling', () => {
    test('throws 404 when neither sku nor urlKey provided', async () => {
      await expect(generateProductHtml(null, null, defaultContext))
        .rejects
        .toThrow('Either sku or urlKey must be provided');
    });

    test('throws 404 when product not found', async () => {
      // Use both handlers for 404 responses
      server.use(handlers.return404());
      server.use(handlers.returnLiveSearch404());
      
      // Mock the config to be pre-loaded to avoid the HTTP request
      const contextWithConfig = {
        ...defaultContext,
        config: mockConfig.data.reduce((acc, { key, value }) => ({ ...acc, [key]: value }), {})
      };
      
      await expect(generateProductHtml('NON-EXISTENT', null, contextWithConfig))
        .rejects
        .toThrow('Product not found');
        
      await expect(generateProductHtml(null, 'non-existent-product', contextWithConfig))
        .rejects
        .toThrow('Product not found');
    });
  });

  describe('HTML generation', () => {
    test('generates HTML with product template', async () => {
      server.use(handlers.defaultProduct());
      
      // Mock the template fetch
      const templateHtml = fs.readFileSync(path.join(__dirname, 'mock-responses', 'product-default.html'), 'utf8');
      server.use(
        http.get('https://content.com/products/default.plain.html', () => {
          return HttpResponse.text(templateHtml);
        })
      );

      // Mock the config to be pre-loaded
      const contextWithConfig = {
        ...defaultContext,
        productsTemplate: 'https://content.com/products/default',
        config: mockConfig.data.reduce((acc, { key, value }) => ({ ...acc, [key]: value }), {})
      };

      const html = await generateProductHtml('24-MB03', null, contextWithConfig);

      expect(html).toContain('Crown Summit Backpack');
      expect(html).toContain('product-recommendations');
    });

    test('generates HTML without product template', async () => {
      server.use(handlers.defaultProduct());

      // Mock the config to be pre-loaded
      const contextWithConfig = {
        ...defaultContext,
        config: mockConfig.data.reduce((acc, { key, value }) => ({ ...acc, [key]: value }), {})
      };

      const html = await generateProductHtml('24-MB03', null, contextWithConfig);

      expect(html).toContain('Crown Summit Backpack');
      expect(html).not.toContain('product-recommendations');
    });

    test('generates HTML using urlKey', async () => {
      server.use(handlers.defaultProductLiveSearch());

      // Mock the config to be pre-loaded
      const contextWithConfig = {
        ...defaultContext,
        config: mockConfig.data.reduce((acc, { key, value }) => ({ ...acc, [key]: value }), {})
      };

      const html = await generateProductHtml(null, 'crown-summit-backpack', contextWithConfig);

      expect(html).toContain('Crown Summit Backpack');
    });
  });
});

describe('Meta Tags Template', () => {
  let headTemplate;
  beforeAll(() => {
    const headTemplateFile = fs.readFileSync(path.join(__dirname, '..', 'actions', 'pdp-renderer', 'templates', `head.hbs`), 'utf8');
    headTemplate = Handlebars.compile(headTemplateFile);
  });

  test('template renders with no params passed', () => {
    const result = headTemplate();
    expect(result).toMatchInlineSnapshot(`
"<head>
  <meta charset="UTF-8">
  <title></title>

  <meta property="og:type" content="og:product">

  <script type="application/ld+json"></script>
</head>

"
`);
  });

  test('renders meta tags with all parameters provided', () => {
    const result = headTemplate({
      metaDescription: "Product Description",
      metaKeyword: "foo, bar",
      metaImage: "https://example.com/image.jpg",
      lastModifiedAt: "2023-10-01",
      sku: "12345",
      externalId: "67890"
    });

    expect(result).toMatchInlineSnapshot(`
"<head>
  <meta charset="UTF-8">
  <title></title>

  <meta name="description" content="Product Description"><meta name="keywords" content="foo, bar"><meta name="image" content="https://example.com/image.jpg"><meta name="id" content="67890"><meta name="sku" content="12345"><meta property="og:type" content="og:product">

  <script type="application/ld+json"></script>
</head>

"
`);
  });

  test('renders only required meta tags when minimal parameters provided', () => {
    const result = headTemplate({ sku: "12345" });

    expect(result).toMatchInlineSnapshot(`
"<head>
  <meta charset="UTF-8">
  <title></title>

  <meta name="sku" content="12345"><meta property="og:type" content="og:product">

  <script type="application/ld+json"></script>
</head>

"
`);
  });
});
