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

const { findDescription, getPrimaryImage, extractPathDetails, generatePriceString, prepareBaseTemplate } = require('../actions/pdp-renderer/lib');

describe('lib', () => {
    test('findDescription', () => {
        const product = {
            metaDescription: 'Meta description',
            shortDescription: 'Short description',
            description: 'Full description'
        };

        expect(findDescription(product)).toBe('Meta description');
        expect(findDescription(product, ['shortDescription', 'description'])).toBe('Short description');
        expect(findDescription({ ...product, shortDescription: null }, ['shortDescription', 'description'])).toBe('Full description');
        expect(findDescription({}, ['description'])).toBe('');
    });

    test('getPrimaryImage', () => {
        const product = {
            images: [
                { url: 'image1.jpg', roles: ['thumbnail'] },
                { url: 'image2.jpg', roles: ['image'] },
                { url: 'image3.jpg', roles: ['image', 'thumbnail'] }
            ]
        };

        expect(getPrimaryImage(product)).toEqual({ url: 'image2.jpg', roles: ['image'] });
        expect(getPrimaryImage(product, 'thumbnail')).toEqual({ url: 'image1.jpg', roles: ['thumbnail'] });
        expect(getPrimaryImage(null)).toBeUndefined();
        expect(getPrimaryImage({})).toBeUndefined();
        expect(getPrimaryImage({ images: [] })).toBeUndefined();
    });


    describe('extractPathDetails', () => {
        test('extract sku and urlKey from path', () => {
            expect(extractPathDetails('/products/my-url-key/my-sku', '/products/{urlKey}/{sku}')).toEqual({ sku: 'my-sku', urlKey: 'my-url-key' });
        });
        test('extract urlKey from path', () => {
            expect(extractPathDetails('/my-url-key', '/{urlKey}')).toEqual({ urlKey: 'my-url-key' });
        });
        test('throw error if path is too long', () => {
            expect(() => extractPathDetails('/products/my-url-key/my-sku', '/products/{urlKey}')).toThrow(`Invalid path. Expected '/products/{urlKey}' format.`);
        });
        test('throw error if static part of path does not match', () => {
            expect(() => extractPathDetails('/product/my-sku', '/products/{sku}')).toThrow(`Invalid path. Expected '/products/{sku}' format.`);
        });
        test('empty object for empty path', () => {
            expect(extractPathDetails('')).toEqual({});
        });
        test('empty object for null path', () => {
            expect(extractPathDetails(null)).toEqual({});
        });
    });

    test('generatePriceString', () => {
        const value100 = { amount: { value: 100, currency: 'EUR' }};
        const value80 = { amount: { value: 80, currency: 'EUR' }};
        const value60 = { amount: { value: 60, currency: 'EUR' }};

        // Range
        // Minimum discounted, maximum normal
        expect(generatePriceString({ priceRange: { minimum: { regular: value100, final: value80 }, maximum: { regular: value100, final: value100 }}})).toBe('<s>€100.00</s> €80.00-€100.00');

        // Minimum normal, maximum discounted
        expect(generatePriceString({ priceRange: { minimum: { regular: value100, final: value100 }, maximum: { regular: value100, final: value80 }}})).toBe('€100.00-<s>€100.00</s> €80.00');

        // Both discounted
        expect(generatePriceString({ priceRange: { minimum: { regular: value80, final: value60 }, maximum: { regular: value100, final: value80 }}})).toBe('<s>€80.00</s> €60.00-<s>€100.00</s> €80.00');

        // Equal range
        // With discount
        expect(generatePriceString({ priceRange: { minimum: { regular: value80, final: value60 }, maximum: { regular: value100, final: value60 }}})).toBe('<s>€80.00</s> €60.00');

        // Without discount
        expect(generatePriceString({ priceRange: { minimum: { regular: value80, final: value80 }, maximum: { regular: value80, final: value80 }}})).toBe('€80.00');

        // No range
        // With discount
        expect(generatePriceString({ price: { regular: value100, final: value80 }})).toBe('<s>€100.00</s> €80.00');

        // No discount
        expect(generatePriceString({ price: { regular: value100, final: value100 }})).toBe('€100.00');
    });

    describe('prepareBaseTemplate', () => {
        // Mock fetch globally for these tests
        const originalFetch = global.fetch;
        const mockTemplateHtml = '<div class="hero">Hero content</div><div class="product-recommendations">Recommendations</div>';

        beforeEach(() => {
            global.fetch = jest.fn();
        });

        afterEach(() => {
            global.fetch = originalFetch;
            jest.clearAllMocks();
        });

        test('should replace {locale} token when locale is provided and not default', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = 'https://content.com/{locale}/products/default';
            const blocks = ['product-recommendations'];
            const context = { locale: 'en' };

            await prepareBaseTemplate(url, blocks, context);

            expect(global.fetch).toHaveBeenCalledWith('https://content.com/en/products/default.plain.html');
        });

        test('should replace {locale} token with complex locale codes', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = 'https://content.com/{locale}/products/default';
            const blocks = ['product-recommendations'];
            const context = { locale: 'en/uk' };

            await prepareBaseTemplate(url, blocks, context);

            expect(global.fetch).toHaveBeenCalledWith('https://content.com/en/uk/products/default.plain.html');
        });

        test('should handle URL with multiple {locale} tokens (only replaces first occurrence)', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = 'https://content.com/{locale}/category/{locale}/products/default';
            const blocks = ['product-recommendations'];
            const context = { locale: 'fr' };

            await prepareBaseTemplate(url, blocks, context);

            // Current implementation only replaces the first {locale} occurrence
            expect(global.fetch).toHaveBeenCalledWith('https://content.com/fr/category/{locale}/products/default.plain.html');
        });

        test('should trim whitespace and trailing slash before locale replacement', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = '  https://content.com/{locale}/products/default/  ';
            const blocks = ['product-recommendations'];
            const context = { locale: 'de' };

            await prepareBaseTemplate(url, blocks, context);

            expect(global.fetch).toHaveBeenCalledWith('https://content.com/de/products/default.plain.html');
        });

        test('should not replace {locale} token when locale is "default"', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = 'https://content.com/{locale}/products/default';
            const blocks = ['product-recommendations'];
            const context = { locale: 'default' };

            await prepareBaseTemplate(url, blocks, context);

            expect(global.fetch).toHaveBeenCalledWith('https://content.com/{locale}/products/default.plain.html');
        });

        test('should not replace {locale} token when locale is not provided', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = 'https://content.com/{locale}/products/default';
            const blocks = ['product-recommendations'];
            const context = {};

            await prepareBaseTemplate(url, blocks, context);

            expect(global.fetch).toHaveBeenCalledWith('https://content.com/{locale}/products/default.plain.html');
        });

        test('should not replace {locale} token when locale is null', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = 'https://content.com/{locale}/products/default';
            const blocks = ['product-recommendations'];
            const context = { locale: null };

            await prepareBaseTemplate(url, blocks, context);

            expect(global.fetch).toHaveBeenCalledWith('https://content.com/{locale}/products/default.plain.html');
        });

        test('should not replace {locale} token when locale is undefined', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = 'https://content.com/{locale}/products/default';
            const blocks = ['product-recommendations'];
            const context = { locale: undefined };

            await prepareBaseTemplate(url, blocks, context);

            expect(global.fetch).toHaveBeenCalledWith('https://content.com/{locale}/products/default.plain.html');
        });

        test('should replace blocks with handlebars partials after locale replacement', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = 'https://content.com/{locale}/products/default';
            const blocks = ['hero', 'product-recommendations'];
            const context = { locale: 'es' };

            const result = await prepareBaseTemplate(url, blocks, context);

            expect(global.fetch).toHaveBeenCalledWith('https://content.com/es/products/default.plain.html');
            expect(result).toContain('{{> hero }}');
            expect(result).toContain('{{> product-recommendations }}');
        });

        test('should handle URL without {locale} token', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = 'https://content.com/products/default';
            const blocks = ['product-recommendations'];
            const context = { locale: 'en' };

            await prepareBaseTemplate(url, blocks, context);

            expect(global.fetch).toHaveBeenCalledWith('https://content.com/products/default.plain.html');
        });

        test('should handle empty blocks array', async () => {
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(mockTemplateHtml)
            });

            const url = 'https://content.com/{locale}/products/default';
            const blocks = [];
            const context = { locale: 'it' };

            const result = await prepareBaseTemplate(url, blocks, context);

            expect(global.fetch).toHaveBeenCalledWith('https://content.com/it/products/default.plain.html');
            expect(result).toBe('<div class="hero">Hero content</div><div class="product-recommendations">Recommendations</div>\n');
        });

        test('should decode HTML entities in the output (only &gt; is decoded)', async () => {
            const htmlWithEntities = '<div class="hero">&gt; Hero content &lt;</div>';
            global.fetch.mockResolvedValueOnce({
                text: () => Promise.resolve(htmlWithEntities)
            });

            const url = 'https://content.com/{locale}/products/default';
            const blocks = [];
            const context = { locale: 'pt' };

            const result = await prepareBaseTemplate(url, blocks, context);

            // Current implementation only decodes &gt; to >, not other entities
            expect(result).toContain('> Hero content &lt;');
            expect(result).not.toContain('&gt;');
            expect(result).toContain('&lt;'); // &lt; is not decoded in current implementation
        });
    });
});