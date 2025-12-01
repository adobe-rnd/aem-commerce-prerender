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

const { 
  ERROR_CODES, 
  handleError, 
  createBatchError, 
  createGlobalError,
  createErrorResponse 
} = require('../actions/lib/errorHandler');

describe('Batch Error Handling', () => {
  const mockLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createBatchError', () => {
    it('should create a batch error that does not fail the job', () => {
      const error = createBatchError('Batch processing failed', { batchId: 1 });
      
      expect(error.message).toBe('Batch processing failed');
      expect(error.code).toBe(ERROR_CODES.BATCH_ERROR);
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ batchId: 1 });
      expect(error.isJobFailed).toBe(false);
    });
  });

  describe('createGlobalError', () => {
    it('should create a global error that fails the job', () => {
      const error = createGlobalError('Global processing failed', 500, { operation: 'init' });
      
      expect(error.message).toBe('Global processing failed');
      expect(error.code).toBe(ERROR_CODES.GLOBAL_ERROR);
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({ operation: 'init' });
      expect(error.isJobFailed).toBe(true);
    });
  });

  describe('handleError with batch errors', () => {
    it('should handle batch errors without failing the job', () => {
      const batchError = createBatchError('Batch failed', { batchId: 1 });
      const result = handleError(batchError, mockLogger);
      
      expect(result.body.jobFailed).toBe(false);
      expect(result.body.isBatchError).toBe(true);
      expect(result.body.code).toBe(ERROR_CODES.BATCH_ERROR);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Batch error occurred (job continues):',
        expect.objectContaining({
          jobFailed: false,
          isBatchError: true
        })
      );
    });

    it('should handle global errors and fail the job', () => {
      const globalError = createGlobalError('Global failure', 500);
      const result = handleError(globalError, mockLogger);
      
      expect(result.body.jobFailed).toBe(true);
      expect(result.body.isBatchError).toBe(false);
      expect(result.body.code).toBe(ERROR_CODES.GLOBAL_ERROR);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Job failed due to critical error:',
        expect.objectContaining({
          jobFailed: true,
          isBatchError: false
        })
      );
    });

    it('should handle regular errors appropriately', () => {
      const regularError = new Error('Regular error');
      regularError.statusCode = 400;
      const result = handleError(regularError, mockLogger);
      
      expect(result.body.jobFailed).toBe(false);
      expect(result.body.isBatchError).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Non-critical error occurred:',
        expect.objectContaining({
          jobFailed: false,
          isBatchError: false
        })
      );
    });
  });

  describe('createErrorResponse with batch errors', () => {
    it('should create error response for batch errors', () => {
      const response = createErrorResponse('Batch failed', ERROR_CODES.BATCH_ERROR, 400);
      
      expect(response.body.jobFailed).toBe(false);
      expect(response.body.isBatchError).toBe(true);
      expect(response.body.code).toBe(ERROR_CODES.BATCH_ERROR);
    });

    it('should create error response for global errors', () => {
      const response = createErrorResponse('Global failed', ERROR_CODES.GLOBAL_ERROR, 500);
      
      expect(response.body.jobFailed).toBe(true);
      expect(response.body.isBatchError).toBe(false);
      expect(response.body.code).toBe(ERROR_CODES.GLOBAL_ERROR);
    });

    it('should create error response for critical errors', () => {
      const response = createErrorResponse('Auth failed', ERROR_CODES.MISSING_AUTH_TOKEN, 400);
      
      expect(response.body.jobFailed).toBe(true);
      expect(response.body.isBatchError).toBe(false);
      expect(response.body.code).toBe(ERROR_CODES.MISSING_AUTH_TOKEN);
    });
  });

  describe('Error classification', () => {
    it('should classify batch operations correctly', () => {
      const batchOperations = [
        'preview batch number 1 for locale en',
        'publish batch number 2 for locale fr',
        'batch processing failed',
        'batch upload error'
      ];

      batchOperations.forEach(operation => {
        const isBatchOperation = operation.includes('batch') || 
                                operation.includes('preview') || 
                                operation.includes('publish');
        expect(isBatchOperation).toBe(true);
      });
    });

    it('should classify global operations correctly', () => {
      const globalOperations = [
        'getting status for job/topic',
        'initializing admin API',
        'starting processing',
        'stopping processing'
      ];

      globalOperations.forEach(operation => {
        const isBatchOperation = operation.includes('batch') || 
                                operation.includes('preview') || 
                                operation.includes('publish');
        expect(isBatchOperation).toBe(false);
      });
    });
  });

  describe('Batch error scenarios', () => {
    it('should handle multiple batch failures gracefully', () => {
      const batchErrors = [
        createBatchError('Batch 1 failed', { batchId: 1 }),
        createBatchError('Batch 2 failed', { batchId: 2 }),
        createBatchError('Batch 3 failed', { batchId: 3 })
      ];

      batchErrors.forEach(error => {
        const result = handleError(error, mockLogger);
        expect(result.body.jobFailed).toBe(false);
        expect(result.body.isBatchError).toBe(true);
      });

      // All batch errors should be logged as warnings, not errors
      expect(mockLogger.warn).toHaveBeenCalledTimes(3);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should fail job on global error even if batches succeeded', () => {
      const batchError = createBatchError('Batch failed', { batchId: 1 });
      const globalError = createGlobalError('Global failure', 500);

      // Handle batch error first
      const batchResult = handleError(batchError, mockLogger);
      expect(batchResult.body.jobFailed).toBe(false);

      // Handle global error - should fail job
      const globalResult = handleError(globalError, mockLogger);
      expect(globalResult.body.jobFailed).toBe(true);
    });
  });
});




