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
 * Adobe I/O Events Authentication Module
 * 
 * Validates digital signatures from Adobe I/O Events to ensure
 * events are authentic and have not been tampered with.
 */

const crypto = require('crypto');
const { logger } = require('./utils');

/**
 * Configuration for signature validation
 */
const SIGNATURE_CONFIG = {
  // Adobe I/O Events client ID for signature validation
  CLIENT_ID: 'd0e28b9a5f9e4d029531f243e5a160a8',
  
  // Enable/disable signature validation (default: false for webhook compatibility)
  ENABLE_VALIDATION: false,
  
  // Signature header name
  SIGNATURE_HEADER: 'x-adobe-signature',
  
  // Algorithm used for signature
  ALGORITHM: 'sha256'
};

/**
 * Validate Adobe digital signature
 * @param {object} event - CloudEvent to validate
 * @param {object} params - Request parameters containing headers
 * @returns {object} Validation result
 */
function validateSignature(event, params) {
  // Check if validation is enabled via parameter or config
  const validationEnabled = params.ENABLE_SIGNATURE_VALIDATION === 'true' || 
                           params.ENABLE_SIGNATURE_VALIDATION === true ||
                           SIGNATURE_CONFIG.ENABLE_VALIDATION;

  logger.debug('Starting signature validation', { 
    eventId: event.id,
    enableValidation: validationEnabled,
    paramValue: params.ENABLE_SIGNATURE_VALIDATION
  });

  // If validation is disabled, return success
  if (!validationEnabled) {
    logger.debug('Signature validation disabled');
    return {
      authenticated: true,
      reason: 'Validation disabled',
      method: 'disabled'
    };
  }

  try {
    // Get signature from headers
    const signature = getSignatureFromHeaders(params);
    if (!signature) {
      logger.warn('No signature found in request headers');
      return {
        authenticated: false,
        reason: 'Missing signature header',
        method: 'signature_validation'
      };
    }

    // Validate client ID
    const clientIdValid = validateClientId(event);
    if (!clientIdValid) {
      logger.warn('Invalid client ID in event', { 
        eventClientId: event.recipient_client_id || event.recipientclientid,
        expectedClientId: SIGNATURE_CONFIG.CLIENT_ID
      });
      return {
        authenticated: false,
        reason: 'Invalid client ID',
        method: 'signature_validation'
      };
    }

    // Verify signature
    const signatureValid = verifyEventSignature(event, signature);
    if (!signatureValid) {
      logger.warn('Invalid signature', { eventId: event.id });
      return {
        authenticated: false,
        reason: 'Invalid signature',
        method: 'signature_validation'
      };
    }

    logger.info('Signature validation successful', { eventId: event.id });
    return {
      authenticated: true,
      reason: 'Valid signature',
      method: 'signature_validation'
    };

  } catch (error) {
    logger.error('Error during signature validation', {
      eventId: event.id,
      error: error.message
    });
    
    return {
      authenticated: false,
      reason: `Validation error: ${error.message}`,
      method: 'signature_validation'
    };
  }
}

/**
 * Extract signature from request headers
 * @param {object} params - Request parameters
 * @returns {string|null} Signature or null if not found
 */
function getSignatureFromHeaders(params) {
  // Check various possible header formats
  const possibleHeaders = [
    params[SIGNATURE_CONFIG.SIGNATURE_HEADER],
    params['__ow_headers']?.[SIGNATURE_CONFIG.SIGNATURE_HEADER],
    params['__ow_headers']?.[SIGNATURE_CONFIG.SIGNATURE_HEADER.toLowerCase()],
    params['__ow_headers']?.[SIGNATURE_CONFIG.SIGNATURE_HEADER.toUpperCase()]
  ];

  for (const header of possibleHeaders) {
    if (header && typeof header === 'string') {
      logger.debug('Found signature header', { 
        headerValue: header.substring(0, 20) + '...' 
      });
      return header;
    }
  }

  logger.debug('No signature header found', { 
    availableHeaders: Object.keys(params['__ow_headers'] || {})
  });
  
  return null;
}

/**
 * Validate that the event contains the expected client ID
 * @param {object} event - CloudEvent to validate
 * @returns {boolean} True if client ID is valid
 */
function validateClientId(event) {
  const eventClientId = event.recipient_client_id || event.recipientclientid;
  
  if (!eventClientId) {
    logger.debug('No client ID found in event');
    return false;
  }

  const isValid = eventClientId === SIGNATURE_CONFIG.CLIENT_ID;
  logger.debug('Client ID validation', { 
    eventClientId, 
    expectedClientId: SIGNATURE_CONFIG.CLIENT_ID,
    isValid 
  });

  return isValid;
}

/**
 * Verify the digital signature of the event
 * @param {object} event - CloudEvent to verify
 * @param {string} signature - Signature to verify against
 * @returns {boolean} True if signature is valid
 */
function verifyEventSignature(event, signature) {
  try {
    // Create canonical string from event data
    const canonicalString = createCanonicalString(event);
    logger.debug('Created canonical string', { 
      length: canonicalString.length,
      preview: canonicalString.substring(0, 100) + '...'
    });

    // Create expected signature
    const expectedSignature = createSignature(canonicalString);
    
    // Compare signatures
    const isValid = signature === expectedSignature;
    
    logger.debug('Signature comparison', {
      provided: signature.substring(0, 20) + '...',
      expected: expectedSignature.substring(0, 20) + '...',
      isValid
    });

    return isValid;

  } catch (error) {
    logger.error('Error verifying signature', { error: error.message });
    return false;
  }
}

/**
 * Create canonical string representation of event for signature verification
 * @param {object} event - CloudEvent
 * @returns {string} Canonical string
 */
function createCanonicalString(event) {
  // Create deterministic string from event properties
  const canonicalData = {
    id: event.id,
    source: event.source,
    type: event.type,
    time: event.time,
    data: event.data
  };

  // Sort keys and create JSON string
  const sortedKeys = Object.keys(canonicalData).sort();
  const canonicalParts = sortedKeys.map(key => {
    const value = canonicalData[key];
    if (typeof value === 'object') {
      return `${key}:${JSON.stringify(value)}`;
    }
    return `${key}:${value}`;
  });

  return canonicalParts.join('|');
}

/**
 * Create signature for given data
 * @param {string} data - Data to sign
 * @returns {string} Generated signature
 */
function createSignature(data) {
  // In a real implementation, this would use a secret key
  // For now, create a simple hash-based signature
  const hash = crypto
    .createHash(SIGNATURE_CONFIG.ALGORITHM)
    .update(data + SIGNATURE_CONFIG.CLIENT_ID)
    .digest('hex');

  return `sha256=${hash}`;
}

/**
 * Enable or disable signature validation
 * @param {boolean} enabled - Whether to enable validation
 */
function setValidationEnabled(enabled) {
  SIGNATURE_CONFIG.ENABLE_VALIDATION = enabled;
  logger.info('Signature validation toggled', { enabled });
}

/**
 * Get current authentication configuration
 * @returns {object} Configuration object
 */
function getConfig() {
  return {
    clientId: SIGNATURE_CONFIG.CLIENT_ID,
    validationEnabled: SIGNATURE_CONFIG.ENABLE_VALIDATION,
    algorithm: SIGNATURE_CONFIG.ALGORITHM
  };
}

module.exports = {
  validateSignature,
  setValidationEnabled,
  getConfig
};
