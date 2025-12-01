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

// Mock the request function before importing the module
const mockRequest = jest.fn();
jest.mock('../actions/utils', () => ({
  request: mockRequest
}));

const { validateAemAdminTokenWithApi, validateConfigTokenWithApi } = require('../actions/lib/tokenValidator');

// Helper function to create a valid JWT token for testing
function createTestJwtToken(payload = {}) {
  const defaultPayload = {
    "email": "test@adobe.com",
    "name": "Test User",
    "roles": ["preview", "publish", "config_admin"],
    "iat": Math.floor(Date.now() / 1000),
    "iss": "https://admin.hlx.page/",
    "aud": "test-audience",
    "sub": "test-subject",
    "exp": Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    "jti": "test-token-id"
  };
  
  const mergedPayload = { ...defaultPayload, ...payload };
  
  // Create a fake JWT structure (header.payload.signature)
  const header = Buffer.from(JSON.stringify({ "alg": "RS256", "typ": "JWT" })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(mergedPayload)).toString('base64url');
  const signature = 'fake-signature-for-testing';
  
  return `${header}.${payloadB64}.${signature}`;
}

describe('AEM Token API Validation', () => {
  const mockLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateAemAdminTokenWithApi', () => {
    it('should pass API validation for valid token', async () => {
      mockRequest.mockResolvedValue({ status: 'ok' });

      const validToken = createTestJwtToken();
      const result = await validateAemAdminTokenWithApi(validToken, 'test-org', 'test-site', mockLogger);
      
      expect(result).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith(
        'token-validation',
        'https://admin.hlx.page/config/test-org/sites/test-site.json',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'x-auth-token': validToken
          })
        }),
        10000
      );
    });

    it('should throw error for missing org or site', async () => {
      const validToken = createTestJwtToken();
      
      await expect(validateAemAdminTokenWithApi(validToken, null, 'test-site', mockLogger))
        .rejects.toThrow('Organization and site are required for API validation');
      
      await expect(validateAemAdminTokenWithApi(validToken, 'test-org', null, mockLogger))
        .rejects.toThrow('Organization and site are required for API validation');
    });

    it('should throw error for invalid token (401)', async () => {
      mockRequest.mockRejectedValue(new Error('Request failed (401): Unauthorized'));

      const validToken = createTestJwtToken(); // Use valid JWT structure for basic validation
      
      await expect(validateAemAdminTokenWithApi(validToken, 'test-org', 'test-site', mockLogger))
        .rejects.toThrow('AEM_ADMIN_API_AUTH_TOKEN is invalid or expired');
    });

    it('should throw error for invalid token (403)', async () => {
      mockRequest.mockRejectedValue(new Error('Request failed (403): Forbidden'));

      const validToken = createTestJwtToken(); // Use valid JWT structure for basic validation
      
      await expect(validateAemAdminTokenWithApi(validToken, 'test-org', 'test-site', mockLogger))
        .rejects.toThrow('AEM_ADMIN_API_AUTH_TOKEN is invalid or expired');
    });

    it('should fallback to basic validation on network error', async () => {
      mockRequest.mockRejectedValue(new Error('Network timeout'));

      const validToken = createTestJwtToken();
      const result = await validateAemAdminTokenWithApi(validToken, 'test-org', 'test-site', mockLogger);
      
      expect(result).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Token API validation failed due to network error, falling back to basic validation:',
        expect.objectContaining({
          message: 'Network timeout',
          code: 'NETWORK_ERROR'
        })
      );
    });
  });

  describe('validateConfigTokenWithApi', () => {
    it('should pass API validation for config with valid token', async () => {
      mockRequest.mockResolvedValue({ status: 'ok' });

      const config = { 
        adminAuthToken: createTestJwtToken(),
        org: 'test-org',
        site: 'test-site'
      };
      
      const result = await validateConfigTokenWithApi(config, mockLogger);
      expect(result).toBe(true);
    });

    it('should throw error for config without adminAuthToken', async () => {
      const config = { org: 'test-org', site: 'test-site' };
      
      await expect(validateConfigTokenWithApi(config, mockLogger))
        .rejects.toThrow('Configuration missing adminAuthToken');
    });

    it('should throw error for config without org or site', async () => {
      const config = { adminAuthToken: createTestJwtToken() };
      
      await expect(validateConfigTokenWithApi(config, mockLogger))
        .rejects.toThrow('Configuration missing org or site for API validation');
    });
  });
});




