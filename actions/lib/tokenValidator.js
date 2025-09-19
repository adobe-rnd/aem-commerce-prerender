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

const { request } = require('../utils');

/**
 * Decodes JWT token without verification (for reading expiration)
 * @param {string} token - JWT token to decode
 * @returns {Object|null} Decoded payload or null if invalid
 */
function decodeJwtPayload(token) {
    try {
        // JWT has 3 parts separated by dots: header.payload.signature
        const parts = token.split('.');
        if (parts.length !== 3) {
            return null;
        }
        
        // Decode the payload (second part)
        const payload = parts[1];
        // Add padding if needed for base64 decoding
        const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
        const decoded = Buffer.from(paddedPayload, 'base64url').toString('utf8');
        
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

/**
 * Checks if JWT token is expired
 * @param {string} token - JWT token to check
 * @param {Object} logger - Logger instance for error logging
 * @returns {boolean} True if token is expired
 */
function isTokenExpired(token, logger) {
    const payload = decodeJwtPayload(token);
    
    if (!payload) {
        logger?.warn('Unable to decode token payload for expiration check');
        return false; // If we can't decode, assume not expired to avoid false positives
    }
    
    if (!payload.exp) {
        logger?.debug('Token does not contain expiration claim (exp)');
        return false; // No expiration claim means token doesn't expire
    }
    
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const expired = payload.exp < now;
    
    if (expired) {
        const expiredDate = new Date(payload.exp * 1000).toISOString();
        logger?.warn(`Token expired at ${expiredDate}`);
    } else {
        const expirationDate = new Date(payload.exp * 1000).toISOString();
        logger?.debug(`Token expires at ${expirationDate}`);
    }
    
    return expired;
}

/**
 * Validates AEM-specific token structure and claims
 * @param {string} token - JWT token to validate
 * @param {Object} logger - Logger instance for error logging
 * @returns {Object} Decoded payload if valid
 * @throws {Error} If token structure is invalid
 */
function validateAemTokenStructure(token, logger) {
    const payload = decodeJwtPayload(token);
    
    if (!payload) {
        const error = new Error('Invalid JWT token structure - cannot decode payload');
        error.statusCode = 400;
        error.code = 'INVALID_TOKEN_FORMAT';
        logger?.error('Token validation failed: Cannot decode JWT payload');
        throw error;
    }
    
    // Check required AEM fields
    const requiredFields = ['iss', 'sub', 'aud', 'roles'];
    const missingFields = requiredFields.filter(field => !payload[field]);
    
    if (missingFields.length > 0) {
        const error = new Error(`Invalid AEM token - missing required fields: ${missingFields.join(', ')}`);
        error.statusCode = 400;
        error.code = 'INVALID_TOKEN_FORMAT';
        logger?.error(`Token validation failed: Missing required fields: ${missingFields.join(', ')}`);
        throw error;
    }
    
    // Validate issuer
    if (payload.iss !== 'https://admin.hlx.page/') {
        const error = new Error(`Invalid token issuer: expected 'https://admin.hlx.page/', got '${payload.iss}'`);
        error.statusCode = 400;
        error.code = 'INVALID_TOKEN_ISSUER';
        logger?.error(`Token validation failed: Invalid issuer ${payload.iss}`);
        throw error;
    }
    
    // Validate roles array
    if (!Array.isArray(payload.roles)) {
        const error = new Error('Invalid token - roles must be an array');
        error.statusCode = 400;
        error.code = 'INVALID_TOKEN_FORMAT';
        logger?.error('Token validation failed: roles is not an array');
        throw error;
    }
    
    // Check for required admin roles
    const requiredRoles = ['preview', 'publish'];
    const hasRequiredRoles = requiredRoles.every(role => payload.roles.includes(role));
    
    if (!hasRequiredRoles) {
        const missingRoles = requiredRoles.filter(role => !payload.roles.includes(role));
        const error = new Error(`Insufficient permissions - missing required roles: ${missingRoles.join(', ')}`);
        error.statusCode = 403;
        error.code = 'INSUFFICIENT_PERMISSIONS';
        logger?.error(`Token validation failed: Missing required roles: ${missingRoles.join(', ')}`);
        throw error;
    }
    
    logger?.debug('AEM token structure validation passed', {
        subject: payload.sub,
        roles: payload.roles,
        issuer: payload.iss
    });
    
    return payload;
}

/**
 * Validates AEM Admin API Auth Token
 * @param {string} token - The token to validate
 * @param {Object} logger - Logger instance for error logging
 * @throws {Error} If token validation fails
 */
function validateAemAdminToken(token, logger) {
    if (!token) {
        const error = new Error('AEM_ADMIN_API_AUTH_TOKEN is required but not provided');
        error.statusCode = 400;
        error.code = 'MISSING_AUTH_TOKEN';
        logger?.error('Token validation failed: Missing AEM_ADMIN_API_AUTH_TOKEN');
        throw error;
    }

    // Validate AEM-specific token structure and claims (this will catch format issues)
    const payload = validateAemTokenStructure(token, logger);

    // Check if token is expired
    if (isTokenExpired(token, logger)) {
        const error = new Error('AEM_ADMIN_API_AUTH_TOKEN has expired');
        error.statusCode = 401;
        error.code = 'EXPIRED_TOKEN';
        logger?.error('Token validation failed: AEM_ADMIN_API_AUTH_TOKEN has expired');
        throw error;
    }

    logger?.info('AEM_ADMIN_API_AUTH_TOKEN validation passed', {
        subject: payload.sub,
        roles: payload.roles,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'never'
    });
    return true;
}

/**
 * Validates AEM Admin API Auth Token against AEM API
 * @param {string} token - The token to validate
 * @param {string} org - Organization name
 * @param {string} site - Site name
 * @param {Object} logger - Logger instance for error logging
 * @returns {Promise<boolean>} True if token is valid
 * @throws {Error} If token validation fails
 */
async function validateAemAdminTokenWithApi(token, org, site, logger) {
    // First do basic validation
    validateAemAdminToken(token, logger);

    if (!org || !site) {
        const error = new Error('Organization and site are required for API validation');
        error.statusCode = 400;
        error.code = 'MISSING_ORG_SITE';
        logger?.error('API validation failed: Missing org or site');
        throw error;
    }

    try {
        // Try to make a simple request to AEM admin API to validate the token
        const adminUrl = `https://admin.hlx.page/config/${org}/sites/${site}.json`;
        const req = {
            method: 'GET',
            headers: {
                'User-Agent': 'AEM Commerce Poller / 1.0',
                'x-auth-token': token
            }
        };

        logger?.info(`Validating token against AEM API: ${adminUrl}`);
        
        // Make a request to check if the token is valid
        // This endpoint should return 200 if token is valid, 401/403 if invalid
        await request('token-validation', adminUrl, req, 10000); // 10 second timeout
        
        logger?.info('AEM_ADMIN_API_AUTH_TOKEN API validation passed');
        return true;
    } catch (error) {
        // Check if it's an authentication error
        if (error.message.includes('401') || error.message.includes('403')) {
            const authError = new Error('AEM_ADMIN_API_AUTH_TOKEN is invalid or expired');
            authError.statusCode = 401;
            authError.code = 'INVALID_TOKEN_API';
            authError.details = { originalError: error.message };
            logger?.error('Token API validation failed: Invalid or expired token');
            throw authError;
        }
        
        // For other errors (network, timeout, etc.), log but don't fail validation
        logger?.warn('Token API validation failed due to network error, falling back to basic validation:', {
            message: error.message,
            code: 'NETWORK_ERROR'
        });
        
        // Return true since basic validation passed
        return true;
    }
}

/**
 * Validates that config has required fields for token validation
 * @param {Object} config - Configuration object containing adminAuthToken
 * @param {Object} logger - Logger instance for error logging
 * @param {boolean} requireOrgSite - Whether org and site are required
 * @throws {Error} If config validation fails
 */
function validateConfigStructure(config, logger, requireOrgSite = false) {
    if (!config || !config.adminAuthToken) {
        const error = new Error('Configuration missing adminAuthToken');
        error.statusCode = 400;
        error.code = 'MISSING_CONFIG_TOKEN';
        logger?.error('Config validation failed: Missing adminAuthToken in config');
        throw error;
    }

    if (requireOrgSite && (!config.org || !config.site)) {
        const error = new Error('Configuration missing org or site for API validation');
        error.statusCode = 400;
        error.code = 'MISSING_ORG_SITE';
        logger?.error('Config API validation failed: Missing org or site');
        throw error;
    }
}

/**
 * Validates AEM Admin API Auth Token and throws if invalid
 * @param {Object} config - Configuration object containing adminAuthToken
 * @param {Object} logger - Logger instance for error logging
 * @throws {Error} If token validation fails
 */
function validateConfigToken(config, logger) {
    validateConfigStructure(config, logger);
    return validateAemAdminToken(config.adminAuthToken, logger);
}

/**
 * Validates AEM Admin API Auth Token against AEM API using config
 * @param {Object} config - Configuration object containing adminAuthToken, org, site
 * @param {Object} logger - Logger instance for error logging
 * @returns {Promise<boolean>} True if token is valid
 * @throws {Error} If token validation fails
 */
async function validateConfigTokenWithApi(config, logger) {
    validateConfigStructure(config, logger, true);
    return validateAemAdminTokenWithApi(config.adminAuthToken, config.org, config.site, logger);
}

module.exports = {
    validateAemAdminToken,
    validateAemAdminTokenWithApi,
    validateConfigToken,
    validateConfigTokenWithApi
};
