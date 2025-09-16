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

/**
 * Error handling utilities for AEM Commerce Prerender
 */

/**
 * Custom error class for job failures
 */
class JobFailedError extends Error {
    constructor(message, code, statusCode = 500, details = {}) {
        super(message);
        this.name = 'JobFailedError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.isJobFailed = true;
    }
}

/**
 * Error codes for different types of failures
 */
const ERROR_CODES = {
    MISSING_AUTH_TOKEN: 'MISSING_AUTH_TOKEN',
    INVALID_TOKEN: 'INVALID_TOKEN',
    EXPIRED_TOKEN: 'EXPIRED_TOKEN',
    INVALID_TOKEN_FORMAT: 'INVALID_TOKEN_FORMAT',
    INVALID_TOKEN_ISSUER: 'INVALID_TOKEN_ISSUER',
    INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
    CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    AEM_API_ERROR: 'AEM_API_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    PROCESSING_ERROR: 'PROCESSING_ERROR',
    BATCH_ERROR: 'BATCH_ERROR',           // Ошибка отдельного батча
    GLOBAL_ERROR: 'GLOBAL_ERROR',          // Глобальная ошибка, которая должна фейлить job
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Handles errors and determines if job should fail
 * @param {Error} error - The error to handle
 * @param {Object} logger - Logger instance
 * @param {Object} context - Additional context for error handling
 * @returns {Object} Error response object
 */
function handleError(error, logger, context = {}) {
    // Determine if this is a job-failing error
    // Batch errors should NOT fail the entire job
    const isJobFailed = error.isJobFailed || 
                       error.statusCode >= 500 || 
                       error.code === ERROR_CODES.MISSING_AUTH_TOKEN ||
                       error.code === ERROR_CODES.INVALID_TOKEN ||
                       error.code === ERROR_CODES.EXPIRED_TOKEN ||
                       error.code === ERROR_CODES.INVALID_TOKEN_FORMAT ||
                       error.code === ERROR_CODES.INVALID_TOKEN_ISSUER ||
                       error.code === ERROR_CODES.INSUFFICIENT_PERMISSIONS ||
                       error.code === ERROR_CODES.CONFIGURATION_ERROR ||
                       error.code === ERROR_CODES.GLOBAL_ERROR;

    // Batch errors are not job-failing errors
    const isBatchError = error.code === ERROR_CODES.BATCH_ERROR;

    const errorResponse = {
        statusCode: error.statusCode || 500,
        body: {
            error: true,
            message: error.message,
            code: error.code || ERROR_CODES.UNKNOWN_ERROR,
            jobFailed: isJobFailed && !isBatchError,
            isBatchError: isBatchError,
            details: error.details || {}
        }
    };

    // Log the error with appropriate level based on error type
    if (isJobFailed && !isBatchError) {
        logger?.error('Job failed due to critical error:', {
            message: error.message,
            code: error.code || ERROR_CODES.UNKNOWN_ERROR,
            stack: error.stack,
            context,
            ...errorResponse.body
        });
    } else if (isBatchError) {
        logger?.warn('Batch error occurred (job continues):', {
            message: error.message,
            code: error.code || ERROR_CODES.UNKNOWN_ERROR,
            context,
            ...errorResponse.body
        });
    } else {
        logger?.warn('Non-critical error occurred:', {
            message: error.message,
            code: error.code || ERROR_CODES.UNKNOWN_ERROR,
            context,
            ...errorResponse.body
        });
    }

    return errorResponse;
}

/**
 * Wraps async functions with error handling
 * @param {Function} fn - Async function to wrap
 * @param {Object} logger - Logger instance
 * @param {Object} context - Additional context
 * @returns {Function} Wrapped function
 */
function withErrorHandling(fn, logger, context = {}) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            const errorResponse = handleError(error, logger, context);
            
            // If job should fail, throw the error
            if (errorResponse.body.jobFailed) {
                throw new JobFailedError(
                    error.message,
                    error.code || ERROR_CODES.UNKNOWN_ERROR,
                    error.statusCode || 500,
                    error.details || {}
                );
            }
            
            // For non-critical errors, return the error response
            return errorResponse;
        }
    };
}

/**
 * Validates required parameters and throws if missing
 * @param {Object} params - Parameters to validate
 * @param {Array<string>} requiredParams - Array of required parameter names
 * @param {Object} logger - Logger instance
 * @throws {JobFailedError} If required parameters are missing
 */
function validateRequiredParams(params, requiredParams, logger) {
    const missingParams = requiredParams.filter(param => !params[param]);
    
    if (missingParams.length > 0) {
        const error = new JobFailedError(
            `Missing required parameters: ${missingParams.join(', ')}`,
            ERROR_CODES.VALIDATION_ERROR,
            400,
            { missingParams }
        );
        logger?.error('Parameter validation failed:', { missingParams });
        throw error;
    }
}

/**
 * Creates a standardized error response
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @param {number} statusCode - HTTP status code
 * @param {Object} details - Additional error details
 * @returns {Object} Error response object
 */
function createErrorResponse(message, code = ERROR_CODES.UNKNOWN_ERROR, statusCode = 500, details = {}) {
    const isBatchError = code === ERROR_CODES.BATCH_ERROR;
    const isJobFailed = statusCode >= 500 || 
                       code === ERROR_CODES.MISSING_AUTH_TOKEN || 
                       code === ERROR_CODES.INVALID_TOKEN || 
                       code === ERROR_CODES.EXPIRED_TOKEN ||
                       code === ERROR_CODES.INVALID_TOKEN_FORMAT ||
                       code === ERROR_CODES.INVALID_TOKEN_ISSUER ||
                       code === ERROR_CODES.INSUFFICIENT_PERMISSIONS ||
                       code === ERROR_CODES.CONFIGURATION_ERROR ||
                       code === ERROR_CODES.GLOBAL_ERROR;

    return {
        statusCode,
        body: {
            error: true,
            message,
            code,
            jobFailed: isJobFailed && !isBatchError,
            isBatchError: isBatchError,
            details
        }
    };
}

/**
 * Creates a batch error that won't fail the entire job
 * @param {string} message - Error message
 * @param {Object} details - Additional error details
 * @returns {JobFailedError} Batch error instance
 */
function createBatchError(message, details = {}) {
    const error = new JobFailedError(message, ERROR_CODES.BATCH_ERROR, 400, details);
    error.isJobFailed = false; // Override to prevent job failure
    return error;
}

/**
 * Creates a global error that will fail the entire job
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @param {Object} details - Additional error details
 * @returns {JobFailedError} Global error instance
 */
function createGlobalError(message, statusCode = 500, details = {}) {
    return new JobFailedError(message, ERROR_CODES.GLOBAL_ERROR, statusCode, details);
}

module.exports = {
    JobFailedError,
    ERROR_CODES,
    handleError,
    withErrorHandling,
    validateRequiredParams,
    createErrorResponse,
    createBatchError,
    createGlobalError
};
