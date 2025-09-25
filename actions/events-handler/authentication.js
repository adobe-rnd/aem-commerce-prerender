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
 * 
 * Adobe I/O Events uses HMAC-SHA256 signatures:
 * 1. Adobe signs the raw JSON payload with your CLIENT_SECRET
 * 2. The signature is sent in the 'x-adobe-signature' header
 * 3. Format: "sha256={hmac_hex}" 
 * 4. We recreate the signature and compare
 * 
 * @see https://developer.adobe.com/events/docs/guides/
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
    // Adobe I/O Events typically signs the raw JSON payload
    const rawPayload = JSON.stringify(event);
    logger.debug('Using raw payload for signature verification', { 
      length: rawPayload.length,
      preview: rawPayload.substring(0, 100) + '...'
    });

    // Create expected signature using raw payload
    const expectedSignature = createSignature(rawPayload);
    
    // Normalize signatures (remove sha256= prefix if present)
    const normalizedProvided = signature.startsWith('sha256=') ? signature.substring(7) : signature;
    const normalizedExpected = expectedSignature.startsWith('sha256=') ? expectedSignature.substring(7) : expectedSignature;
    
    // Compare signatures (case-insensitive)
    const isValid = normalizedProvided.toLowerCase() === normalizedExpected.toLowerCase();
    
    logger.debug('Signature comparison', {
      provided: normalizedProvided.substring(0, 16) + '...',
      expected: normalizedExpected.substring(0, 16) + '...',
      isValid
    });

    return isValid;

  } catch (error) {
    logger.error('Error verifying signature', { error: error.message });
    return false;
  }
}


/**
 * Create HMAC signature for given data using CLIENT_SECRET
 * @param {string} data - Data to sign
 * @returns {string} Generated HMAC signature
 */
function createSignature(data) {
  // Get client secret from environment variables
  const clientSecret = process.env.CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error('CLIENT_SECRET environment variable is required for signature creation');
  }

  // Create HMAC signature using CLIENT_SECRET (standard for webhook validation)
  const hmac = crypto
    .createHmac(SIGNATURE_CONFIG.ALGORITHM, clientSecret)
    .update(data, 'utf8')
    .digest('hex');

  return `sha256=${hmac}`;
}

module.exports = {
  validateSignature
};
