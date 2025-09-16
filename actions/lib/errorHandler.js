/* Error handling utilities for AppBuilder actions */

/**
 * Custom error class for job-failing errors
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
 * Standard error codes used across the application
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
 * Creates a batch-level error (non-critical)
 */
function createBatchError(message, details = {}) {
    const error = new Error(message);
    error.code = ERROR_CODES.BATCH_ERROR;
    error.statusCode = 500;
    error.details = details;
    error.isJobFailed = false;
    return error;
}

/**
 * Creates a global error (critical, should fail the job)
 */
function createGlobalError(message, statusCode = 500, details = {}) {
    return new JobFailedError(message, ERROR_CODES.GLOBAL_ERROR, statusCode, details);
}

/**
 * Determines if an error should cause the job to fail
 */
function isCriticalError(error) {
    if (error.isJobFailed) {
        return true;
    }
    
    const criticalCodes = [
        ERROR_CODES.MISSING_AUTH_TOKEN,
        ERROR_CODES.EXPIRED_TOKEN,
        ERROR_CODES.INVALID_TOKEN_FORMAT,
        ERROR_CODES.INVALID_TOKEN_ISSUER,
        ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        ERROR_CODES.CONFIGURATION_ERROR,
        ERROR_CODES.PROCESSING_ERROR,
        ERROR_CODES.GLOBAL_ERROR
    ];
    
    return criticalCodes.includes(error.code);
}

/**
 * Handles errors in AppBuilder actions
 */
function handleError(error, logger) {
    const errorInfo = {
        message: error.message,
        code: error.code || ERROR_CODES.UNKNOWN_ERROR,
        statusCode: error.statusCode || 500,
        details: error.details || {},
        stack: error.stack
    };

    if (isCriticalError(error)) {
        logger?.error('Critical error occurred:', errorInfo);
        throw error;
    } else {
        logger?.warn('Non-critical error occurred:', errorInfo);
        return createErrorResponse(error);
    }
}

/**
 * Creates a standardized error response
 */
function createErrorResponse(error) {
    return {
        error: error.message,
        code: error.code || ERROR_CODES.UNKNOWN_ERROR,
        statusCode: error.statusCode || 500,
        details: error.details || {}
    };
}

module.exports = {
    JobFailedError,
    ERROR_CODES,
    createBatchError,
    createGlobalError,
    isCriticalError,
    handleError,
    createErrorResponse
};