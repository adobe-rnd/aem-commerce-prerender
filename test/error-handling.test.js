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

const { validateAemAdminToken, validateConfigToken } = require('../actions/lib/tokenValidator');
const { JobFailedError, ERROR_CODES, handleError, createErrorResponse, createBatchError, createGlobalError, handleActionError } = require('../actions/lib/errorHandler');

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

describe('Token Validator', () => {
  const mockLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateAemAdminToken', () => {
    it('should pass validation for valid token', () => {
      const validToken = createTestJwtToken();
      expect(() => validateAemAdminToken(validToken, mockLogger)).not.toThrow();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'AEM_ADMIN_API_AUTH_TOKEN validation passed',
        expect.objectContaining({
          subject: 'test-subject',
          roles: ['preview', 'publish', 'config_admin']
        })
      );
    });

    it('should throw error for missing token', () => {
      expect(() => validateAemAdminToken(null, mockLogger)).toThrow('AEM_ADMIN_API_AUTH_TOKEN is required but not provided');
      expect(mockLogger.error).toHaveBeenCalledWith('Token validation failed: Missing AEM_ADMIN_API_AUTH_TOKEN');
    });

    it('should throw error for undefined token', () => {
      expect(() => validateAemAdminToken(undefined, mockLogger)).toThrow('AEM_ADMIN_API_AUTH_TOKEN is required but not provided');
    });

    it('should throw error for empty string token', () => {
      expect(() => validateAemAdminToken('', mockLogger)).toThrow('AEM_ADMIN_API_AUTH_TOKEN is required but not provided');
    });

    it('should throw error for invalid JWT format', () => {
      expect(() => validateAemAdminToken('invalid-token', mockLogger)).toThrow('Invalid JWT token structure - cannot decode payload');
    });

    it('should throw error for token with invalid issuer', () => {
      const tokenWithInvalidIssuer = createTestJwtToken({ iss: 'https://invalid.com/' });
      expect(() => validateAemAdminToken(tokenWithInvalidIssuer, mockLogger)).toThrow('Invalid token issuer');
    });

    it('should throw error for token without required roles', () => {
      const tokenWithoutRoles = createTestJwtToken({ roles: ['config_admin'] });
      expect(() => validateAemAdminToken(tokenWithoutRoles, mockLogger)).toThrow('Insufficient permissions - missing required roles');
    });

    it('should throw error for expired token', () => {
      const expiredToken = createTestJwtToken({ exp: Math.floor(Date.now() / 1000) - 3600 }); // 1 hour ago
      expect(() => validateAemAdminToken(expiredToken, mockLogger)).toThrow('AEM_ADMIN_API_AUTH_TOKEN has expired');
    });

    it('should work without logger', () => {
      const validToken = createTestJwtToken();
      expect(() => validateAemAdminToken(validToken)).not.toThrow();
    });
  });

  describe('validateConfigToken', () => {
    it('should pass validation for config with valid token', () => {
      const config = { adminAuthToken: createTestJwtToken() };
      expect(() => validateConfigToken(config, mockLogger)).not.toThrow();
    });

    it('should throw error for config without adminAuthToken', () => {
      const config = {};
      expect(() => validateConfigToken(config, mockLogger)).toThrow('Configuration missing adminAuthToken');
      expect(mockLogger.error).toHaveBeenCalledWith('Config validation failed: Missing adminAuthToken in config');
    });

    it('should throw error for null config', () => {
      expect(() => validateConfigToken(null, mockLogger)).toThrow('Configuration missing adminAuthToken');
    });
  });
});

describe('Error Handler', () => {
  const mockLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('JobFailedError', () => {
    it('should create error with all properties', () => {
      const error = new JobFailedError('Test error', 'TEST_CODE', 400, { detail: 'test' });
      
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ detail: 'test' });
      expect(error.isJobFailed).toBe(true);
      expect(error.name).toBe('JobFailedError');
    });

    it('should create error with defaults', () => {
      const error = new JobFailedError('Test error');
      
      expect(error.message).toBe('Test error');
      expect(error.code).toBeUndefined();
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({});
      expect(error.isJobFailed).toBe(true);
    });
  });

  describe('handleError', () => {
    it('should handle JobFailedError and mark job as failed', () => {
      const error = new JobFailedError('Critical error', 'CRITICAL', 500);
      const result = handleError(error, mockLogger);
      
      expect(result.statusCode).toBe(500);
      expect(result.body.jobFailed).toBe(true);
      expect(result.body.message).toBe('Critical error');
      expect(result.body.code).toBe('CRITICAL');
      expect(mockLogger.error).toHaveBeenCalledWith('Job failed due to critical error:', expect.objectContaining({
        message: 'Critical error',
        code: 'CRITICAL',
        jobFailed: true,
        isBatchError: false
      }));
    });

    it('should handle regular error and mark job as not failed', () => {
      const error = new Error('Regular error');
      error.statusCode = 400;
      const result = handleError(error, mockLogger);
      
      expect(result.statusCode).toBe(400);
      expect(result.body.jobFailed).toBe(false);
      expect(result.body.message).toBe('Regular error');
      expect(result.body.code).toBe(ERROR_CODES.UNKNOWN_ERROR);
      expect(mockLogger.warn).toHaveBeenCalledWith('Non-critical error occurred:', expect.objectContaining({
        message: 'Regular error',
        code: ERROR_CODES.UNKNOWN_ERROR,
        jobFailed: false,
        isBatchError: false
      }));
    });

    it('should handle missing auth token as job failed', () => {
      const error = new Error('Missing token');
      error.code = ERROR_CODES.MISSING_AUTH_TOKEN;
      const result = handleError(error, mockLogger);
      
      expect(result.body.jobFailed).toBe(true);
    });

    it('should work without logger', () => {
      const error = new Error('Test error');
      const result = handleError(error);
      
      expect(result.statusCode).toBe(500);
      expect(result.body.error).toBe(true);
    });
  });

  describe('handleActionError', () => {
    it('should throw critical errors', () => {
      const criticalError = new JobFailedError('Critical failure', ERROR_CODES.MISSING_AUTH_TOKEN, 401);
      
      expect(() => handleActionError(criticalError, mockLogger)).toThrow(JobFailedError);
      expect(mockLogger.error).toHaveBeenCalledWith('action failed due to critical error:', {
        message: 'Critical failure',
        code: ERROR_CODES.MISSING_AUTH_TOKEN,
        statusCode: 401
      });
    });

    it('should return error response for non-critical errors', () => {
      const nonCriticalError = new Error('Non-critical failure');
      nonCriticalError.statusCode = 400;
      nonCriticalError.code = 'SOME_ERROR';
      
      const result = handleActionError(nonCriticalError, mockLogger);
      
      expect(result.statusCode).toBe(400);
      expect(result.body.error).toBe(true);
      expect(result.body.message).toBe('Non-critical failure');
      expect(result.body.code).toBe('SOME_ERROR');
      expect(result.body.jobFailed).toBe(false);
      
      expect(mockLogger.warn).toHaveBeenCalledWith('Non-critical error occurred:', {
        message: 'Non-critical failure',
        code: 'SOME_ERROR'
      });
    });

    it('should work with options object and custom action name', () => {
      const error = new Error('Test error');
      
      const result = handleActionError(error, { 
        logger: mockLogger, 
        actionName: 'Custom Action' 
      });
      
      expect(result.statusCode).toBe(500);
      expect(result.body.jobFailed).toBe(false);
    });

    it('should create logger if not provided', () => {
      const error = new Error('Test error');
      
      const result = handleActionError(error);
      
      expect(result.statusCode).toBe(500);
      expect(result.body.error).toBe(true);
    });
  });

  describe('createErrorResponse', () => {
    it('should create error response with all parameters', () => {
      const response = createErrorResponse('Test error', 'TEST_CODE', 400, { detail: 'test' });
      
      expect(response.statusCode).toBe(400);
      expect(response.body.error).toBe(true);
      expect(response.body.message).toBe('Test error');
      expect(response.body.code).toBe('TEST_CODE');
      expect(response.body.details).toEqual({ detail: 'test' });
      expect(response.body.jobFailed).toBe(false);
    });

    it('should create error response with defaults', () => {
      const response = createErrorResponse('Test error');
      
      expect(response.statusCode).toBe(500);
      expect(response.body.code).toBe(ERROR_CODES.UNKNOWN_ERROR);
      expect(response.body.details).toEqual({});
      expect(response.body.jobFailed).toBe(true);
    });

    it('should mark job as failed for critical error codes', () => {
      const response = createErrorResponse('Missing token', ERROR_CODES.MISSING_AUTH_TOKEN, 400);
      
      expect(response.body.jobFailed).toBe(true);
    });
  });

  describe('Batch and Global Error Functions', () => {
    it('should create batch error that does not fail job', () => {
      const error = createBatchError('Batch failed', { batchId: 1 });
      
      expect(error.message).toBe('Batch failed');
      expect(error.code).toBe(ERROR_CODES.BATCH_ERROR);
      expect(error.isJobFailed).toBe(false);
      expect(error.details).toEqual({ batchId: 1 });
    });

    it('should create global error that fails job', () => {
      const error = createGlobalError('Global failed', 500, { operation: 'init' });
      
      expect(error.message).toBe('Global failed');
      expect(error.code).toBe(ERROR_CODES.GLOBAL_ERROR);
      expect(error.isJobFailed).toBe(true);
      expect(error.details).toEqual({ operation: 'init' });
    });

    it('should handle batch errors without failing job', () => {
      const batchError = createBatchError('Batch failed');
      const result = handleError(batchError, mockLogger);
      
      expect(result.body.jobFailed).toBe(false);
      expect(result.body.isBatchError).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Batch error occurred (job continues):',
        expect.objectContaining({
          jobFailed: false,
          isBatchError: true
        })
      );
    });

    it('should handle global errors and fail job', () => {
      const globalError = createGlobalError('Global failed');
      const result = handleError(globalError, mockLogger);
      
      expect(result.body.jobFailed).toBe(true);
      expect(result.body.isBatchError).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Job failed due to critical error:',
        expect.objectContaining({
          jobFailed: true,
          isBatchError: false
        })
      );
    });
  });
});
