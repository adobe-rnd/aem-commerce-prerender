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

const { graphql, HttpResponse } = require('msw');

const { generateLdJson } = require('../actions/pdp-renderer/ldJson');
const { useMockServer, handlers } = require('./mock-server.js');

describe('ldJson', () => {

    const mockContext = { contentUrl: 'https://content.com', storeUrl: 'https://example.com', configName: 'config', logger: { debug: jest.fn(), error: jest.fn() }, pathFormat: '/products/{urlKey}/{sku}' };
    const server = useMockServer();

    beforeEach(() => {
        mockContext.logger.error.mockClear();
    });

    test('generate ldJson for simple product', async () => {
        const product = {
            __typename: 'SimpleProductView',
            name: 'Simple Product',
            sku: 'simple-sku',
            urlKey: 'simple-product',
            shortDescription: 'short description',
            metaDescription: 'meta description',
            description: 'full description',
            price: {
                final: {
                    amount: {
                        value: 100,
                        currency: 'EUR'
                    }
                },
                regular: {
                    amount: {
                        value: 120,
                        currency: 'EUR'
                    }
                }
            },
            inStock: true,
            images: [
                { url: 'image1.jpg', roles: ['image'] }
            ]
        };

        const ldJson = await generateLdJson(product, mockContext);
        const expectedLdJson = JSON.stringify({
            '@context': 'http://schema.org',
            '@type': 'Product',
            sku: 'simple-sku',
            name: 'Simple Product',
            gtin: '',
            description: 'short description',
            '@id': 'https://example.com/products/simple-product/simple-sku',
            offers: [{
                '@type': 'Offer',
                sku: 'simple-sku',
                url: 'https://example.com/products/simple-product/simple-sku',
                availability: 'https://schema.org/InStock',
                price: 100,
                priceCurrency: 'EUR',
                itemCondition: 'https://schema.org/NewCondition',
                priceSpecification: {
                    '@type': 'UnitPriceSpecification',
                    priceType: 'https://schema.org/ListPrice',
                    price: 120,
                    priceCurrency: 'EUR'
                }
            }],
            image: 'image1.jpg'
        });

        expect(ldJson).toBe(expectedLdJson);
    });

    test('generate ldJson for complex product', async () => {
        const product = {
            __typename: 'ComplexProductView',
            name: 'Complex Product',
            sku: 'complex-sku',
            urlKey: 'complex-product',
            shortDescription: 'short description',
            metaDescription: 'meta description',
            description: 'full description',
            options: [
                { id: 'color' },
                { id: 'size' }
            ],
            priceRange: {},
            inStock: true,
            images: [
                { url: 'image1.jpg', roles: ['image'] }
            ]
        };
        server.use(handlers.defaultVariant());

        const ldJson = await generateLdJson(product, mockContext);
        const expectedLdJson = JSON.stringify({
            '@context': 'http://schema.org',
            '@type': 'ProductGroup',
            sku: 'complex-sku',
            productGroupId: 'complex-sku',
            name: 'Complex Product',
            gtin: '',
            variesBy: ['https://schema.org/color', 'https://schema.org/size'],
            description: 'short description',
            '@id': 'https://example.com/products/complex-product/complex-sku',
            hasVariant: [
                {
                    '@type': 'Product',
                    sku: 'complex-sku-L-Green',
                    name: 'Complex Product (L,Green)',
                    gtin: '',
                    image: 'green-image.jpg',
                    offers: [{
                        '@type': 'Offer',
                        sku: 'complex-sku-L-Green',
                        url: 'https://example.com/products/complex-product/complex-sku?optionsUIDs=color-green%2Csize-l',
                        availability: 'https://schema.org/OutOfStock',
                        price: 30,
                        priceCurrency: 'USD',
                        itemCondition: 'https://schema.org/NewCondition',
                        priceSpecification: {
                            '@type': 'UnitPriceSpecification',
                            priceType: 'https://schema.org/ListPrice',
                            price: 52,
                            priceCurrency: 'USD'
                        }
                    }],
                    color: 'Green',
                    size: 'L'
                },
                {
                    '@type': 'Product',
                    sku: 'complex-sku-M-Red',
                    name: 'Complex Product (M,Red)',
                    gtin: '',
                    image: 'red-image.jpg',
                    offers: [{
                        '@type': 'Offer',
                        sku: 'complex-sku-M-Red',
                        url: 'https://example.com/products/complex-product/complex-sku?optionsUIDs=color-red%2Csize-m',
                        availability: 'https://schema.org/InStock',
                        price: 52,
                        priceCurrency: 'USD',
                        itemCondition: 'https://schema.org/NewCondition',
                    }],
                    color: 'Red',
                    size: 'M'
                }
            ],
            image: 'image1.jpg'
        });

        expect(ldJson).toBe(expectedLdJson);
    });

    test('fail for unsupported product type', async () => {
        const product = { __typename: 'unsupported' };
        const context = {};
        await expect(generateLdJson(product, context)).rejects.toThrow('Unsupported product type');
    });

    test('fail for null variant', async () => {
        const product = {
            __typename: 'ComplexProductView',
            name: 'Complex Product',
            sku: 'complex-sku',
            urlKey: 'complex-product',
            shortDescription: 'short description',
            metaDescription: 'meta description',
            description: 'full description',
            options: [
                { id: 'color' },
                { id: 'size' }
            ],
            priceRange: {},
            inStock: true,
            images: [
                { url: 'image1.jpg', roles: ['image'] }
            ]
        };

        server.use(graphql.query('VariantsQuery', () => HttpResponse.json({
            data: {
                variants: {
                    variants: [
                        {
                            selections: [
                                'color-green',
                                'size-l'
                            ],
                            product: null
                        }
                    ]
                }
            }
        })));

        await expect(generateLdJson(product, mockContext)).rejects.toThrow('Product variant is null');
        expect(mockContext.logger.error).toHaveBeenCalled();
    })
});