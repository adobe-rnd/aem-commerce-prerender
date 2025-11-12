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
    BATCH_ERROR: 'BATCH_ERROR',           // Individual batch error
    GLOBAL_ERROR: 'GLOBAL_ERROR',          // Global error that should fail the job
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Creates a batch-level error (non-critical)
 */
function createBatchError(message, details = {}) {
    const error = new Error(message);
    error.code = ERROR_CODES.BATCH_ERROR;
    error.statusCode = 400;
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
        ERROR_CODES.GLOBAL_ERROR,
        ERROR_CODES.UNKNOWN_ERROR
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
        stack: error.stack,
        jobFailed: isCriticalError(error),
        isBatchError: error.code === ERROR_CODES.BATCH_ERROR
    };

    if (isCriticalError(error)) {
        logger?.error('Job failed due to critical error:', errorInfo);
        return createErrorResponse(error);
    } else {
        if (error.code === ERROR_CODES.BATCH_ERROR) {
            logger?.warn('Batch error occurred (job continues):', errorInfo);
        } else {
            logger?.warn('Non-critical error occurred:', errorInfo);
        }
        return createErrorResponse(error);
    }
}

/**
 * Creates a standardized error response
 */
function createErrorResponse(message, code, statusCode = 500, details = {}) {
    const errorObj = typeof message === 'object' ? message : { message, code, statusCode, details };
    const finalCode = errorObj.code || code || ERROR_CODES.UNKNOWN_ERROR;
    
    // For string message calls (from tests), check the code parameter
    const isJobFailed = typeof message === 'string' 
        ? isCriticalError({ code: finalCode }) 
        : isCriticalError(errorObj);
    
    return {
        statusCode: errorObj.statusCode || statusCode,
        body: {
            error: true,
            message: errorObj.message || message,
            code: finalCode,
            details: errorObj.details || details,
            jobFailed: isJobFailed,
            isBatchError: finalCode === ERROR_CODES.BATCH_ERROR
        }
    };
}


/**
 * Handles errors in AppBuilder action main functions
 * @param {Error} error - The error to handle
 * @param {Object} loggerOrOptions - Logger instance or options object
 * @param {Object} [loggerOrOptions.logger] - Logger instance (if options object)
 * @param {string} [loggerOrOptions.actionName] - Action name for logging context
 * @returns {Object|never} Returns error response for non-critical errors, throws for critical errors
 */
function handleActionError(error, loggerOrOptions = {}) {
    // Support both logger directly or options object
    const logger = loggerOrOptions.logger || loggerOrOptions;
    const actionName = loggerOrOptions.actionName || 'action';
    
    // Create logger if not provided
    const finalLogger = logger && typeof logger.error === 'function' 
        ? logger 
        : require('@adobe/aio-sdk').Core.Logger('main', { level: 'error' });
    
    if (isCriticalError(error)) {
        finalLogger.error(`${actionName} failed due to critical error:`, {
            message: error.message,
            code: error.code,
            statusCode: error.statusCode
        });
        throw error;
    }
    
    // For non-critical errors, return error response
    finalLogger.warn('Non-critical error occurred:', {
        message: error.message,
        code: error.code || ERROR_CODES.UNKNOWN_ERROR
    });
    
    return {
        statusCode: error.statusCode || 500,
        body: {
            error: true,
            message: error.message,
            code: error.code || ERROR_CODES.UNKNOWN_ERROR,
            jobFailed: false
        }
    };
}

module.exports = {
    JobFailedError,
    ERROR_CODES,
    createBatchError,
    createGlobalError,
    isCriticalError,
    handleError,
    createErrorResponse,
    handleActionError
};