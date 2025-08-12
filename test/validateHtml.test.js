/*
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE/2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under this License.
*/

const { validateHtml } = require('../actions/lib/validateHtml');

describe('validateHtml', () => {
  describe('input validation', () => {
    test('should return error for non-string input', () => {
      expect(validateHtml(null)).toEqual({
        valid: false,
        reason: 'Input must be a string'
      });

      expect(validateHtml(undefined)).toEqual({
        valid: false,
        reason: 'Input must be a string'
      });

      expect(validateHtml(123)).toEqual({
        valid: false,
        reason: 'Input must be a string'
      });

      expect(validateHtml({})).toEqual({
        valid: false,
        reason: 'Input must be a string'
      });
    });

    test('should return valid for empty string', () => {
      expect(validateHtml('')).toEqual({
        valid: true,
        reason: 'Empty string is valid'
      });

      expect(validateHtml('   ')).toEqual({
        valid: true,
        reason: 'Empty string is valid'
      });
    });
  });

  describe('valid HTML', () => {
    test('should validate simple HTML', () => {
      expect(validateHtml('<p>Hello World</p>')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should validate nested HTML', () => {
      expect(validateHtml('<div><p>Hello <strong>World</strong></p></div>')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should validate complex nested HTML', () => {
      const complexHtml = `
        <html>
          <head>
            <title>Test Page</title>
          </head>
          <body>
            <div class="container">
              <header>
                <h1>Main Title</h1>
                <nav>
                  <ul>
                    <li><a href="/">Home</a></li>
                    <li><a href="/about">About</a></li>
                  </ul>
                </nav>
              </header>
              <main>
                <article>
                  <h2>Article Title</h2>
                  <p>Article content with <em>emphasis</em> and <strong>strong text</strong>.</p>
                </article>
              </main>
            </div>
          </body>
        </html>
      `;

      expect(validateHtml(complexHtml)).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should validate HTML with attributes', () => {
      expect(validateHtml('<div class="test" id="main" data-value="123">Content</div>')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });
  });

  describe('self-closing tags', () => {
    test('should validate self-closing tags', () => {
      expect(validateHtml('<img src="image.jpg" alt="Image" />')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });

      expect(validateHtml('<br/>')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });

      expect(validateHtml('<input type="text" />')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should validate HTML with mixed self-closing and regular tags', () => {
      expect(validateHtml('<div><img src="img.jpg" /><p>Text</p></div>')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should validate all self-closing tag types', () => {
      const selfClosingTags = [
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'
      ];

      selfClosingTags.forEach(tag => {
        expect(validateHtml(`<${tag} />`)).toEqual({
          valid: true,
          reason: 'HTML is valid'
        });
      });
    });
  });

  describe('invalid HTML', () => {
    test('should detect unclosed tags', () => {
      expect(validateHtml('<div>Content')).toEqual({
        valid: false,
        reason: 'Unclosed tags: div'
      });

      expect(validateHtml('<div><p>Content')).toEqual({
        valid: false,
        reason: 'Unclosed tags: p, div'
      });
    });

        test('should detect mismatched tags', () => {
      expect(validateHtml('<div>Content</p>')).toEqual({
        valid: false,
        reason: 'Mismatched tags: expected </div> but found </p> at line 1, position 12'
      });

      expect(validateHtml('<div><p>Content</div></p>')).toEqual({
        valid: false,
        reason: 'Mismatched tags: expected </p> but found </div> at line 1, position 15'
      });
    });

        test('should detect unexpected closing tags', () => {
      expect(validateHtml('</div>')).toEqual({
        valid: false,
        reason: 'Unexpected closing tag </div> at line 1, position 0'
      });

      expect(validateHtml('Content</p>')).toEqual({
        valid: false,
        reason: 'Unexpected closing tag </p> at line 1, position 7'
      });
    });

    test('should detect complex mismatched structure', () => {
      const invalidHtml = `
        <div>
          <header>
            <h1>Title</h1>
          </div>
          <main>
            <p>Content</p>
          </header>
        </main>
      `;

      expect(validateHtml(invalidHtml)).toEqual({
        valid: false,
        reason: 'Mismatched tags: expected </header> but found </div> at line 5, position 10'
      });
    });
  });

  describe('line and position reporting', () => {
    test('should report correct line numbers for single line', () => {
      expect(validateHtml('<div>Content</p>')).toEqual({
        valid: false,
        reason: 'Mismatched tags: expected </div> but found </p> at line 1, position 12'
      });
    });

    test('should report correct line numbers for multi-line', () => {
      const multiLineHtml = `
        <div>
          <p>First paragraph</p>
          <p>Second paragraph</p>
        </div>
        <p>Unclosed paragraph
      `;

      expect(validateHtml(multiLineHtml)).toEqual({
        valid: false,
        reason: 'Unclosed tags: p'
      });
    });

    test('should report correct position within line', () => {
      expect(validateHtml('  <div>Content</span>')).toEqual({
        valid: false,
        reason: 'Mismatched tags: expected </div> but found </span> at line 1, position 14'
      });
    });
  });

  describe('edge cases', () => {
    test('should handle HTML with comments', () => {
      expect(validateHtml('<div><!-- Comment -->Content</div>')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should handle HTML with DOCTYPE', () => {
      expect(validateHtml('<!DOCTYPE html><html><body>Content</body></html>')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should handle HTML with script tags', () => {
      expect(validateHtml('<div><script>console.log("test");</script></div>')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should handle HTML with style tags', () => {
      expect(validateHtml('<div><style>.test { color: red; }</style></div>')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should handle HTML with special characters in attributes', () => {
      expect(validateHtml('<div data-test="value with \'quotes\' and double quotes">Content</div>')).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });
  });

  describe('real-world scenarios', () => {
    test('should validate product description HTML', () => {
      const productDescription = `
        <div class="product-description">
          <h3>Product Features</h3>
          <ul>
            <li>High quality material</li>
            <li>Comfortable fit</li>
            <li>Available in multiple colors</li>
          </ul>
          <p>This product is made with <strong>premium materials</strong> and designed for <em>maximum comfort</em>.</p>
        </div>
      `;

      expect(validateHtml(productDescription)).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should validate meta description with HTML', () => {
      const metaDescription = 'Product description with <strong>bold text</strong> and <em>italic emphasis</em>.';

      expect(validateHtml(metaDescription)).toEqual({
        valid: true,
        reason: 'HTML is valid'
      });
    });

    test('should detect issues in product description', () => {
      const invalidDescription = `
        <div class="product-info">
          <h3>Product Details</h3>
          <p>Product description here
          <ul>
            <li>Feature 1</li>
            <li>Feature 2</li>
          </div>
        </ul>
      `;

      expect(validateHtml(invalidDescription)).toEqual({
        valid: false,
        reason: 'Mismatched tags: expected </ul> but found </div> at line 8, position 10'
      });
    });
  });
});
