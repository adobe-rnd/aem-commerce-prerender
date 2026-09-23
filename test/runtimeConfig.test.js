/*
Copyright 2026 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

const { getRuntimeConfig } = require('../actions/lib/runtimeConfig');

describe('getRuntimeConfig PLP_PRODUCTS_PER_PAGE', () => {
  const baseParams = {
    CONTENT_URL: 'https://content.com',
  };

  test('defaults to 9 when not provided', () => {
    const cfg = getRuntimeConfig({ ...baseParams });
    expect(cfg.plpProductsPerPage).toBe(9);
  });

  test('allows an explicit 0 to disable product listing', () => {
    const cfg = getRuntimeConfig({ ...baseParams, PLP_PRODUCTS_PER_PAGE: 0 });
    expect(cfg.plpProductsPerPage).toBe(0);
  });

  test('allows "0" as a string to disable product listing', () => {
    const cfg = getRuntimeConfig({ ...baseParams, PLP_PRODUCTS_PER_PAGE: '0' });
    expect(cfg.plpProductsPerPage).toBe(0);
  });

  test('falls back to 9 for invalid values', () => {
    const cfg = getRuntimeConfig({ ...baseParams, PLP_PRODUCTS_PER_PAGE: 'not-a-number' });
    expect(cfg.plpProductsPerPage).toBe(9);
  });

  test('respects an explicit positive override', () => {
    const cfg = getRuntimeConfig({ ...baseParams, PLP_PRODUCTS_PER_PAGE: 24 });
    expect(cfg.plpProductsPerPage).toBe(24);
  });
});
