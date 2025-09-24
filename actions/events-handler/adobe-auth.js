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
 * Adobe Authentication Module
 * 
 * Handles Adobe I/O Events digital signature validation
 */

const crypto = require('crypto');
const fetch = require('node-fetch');
const { logger } = require('./utils');

/**
 * Download Adobe public key for signature verification
 */
async function downloadPublicKey(keyUrl) {
  try {
    logger.debug('Downloading public key', { keyUrl });
    
    const response = await fetch(keyUrl, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Adobe-Events-Handler/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to download public key: ${response.status} ${response.statusText}`);
    }
    
    const publicKey = await response.text();
    logger.debug('Public key downloaded successfully');
    
    return publicKey;
    
  } catch (error) {
    logger.error('Error downloading public key', error);
    throw error;
  }
}

/**
 * Validate Adobe I/O Events digital signature
 */
async function validateAdobeSignature(event, headers, payload, config) {
  try {
    logger.info('Validating Adobe digital signatures');
    
    // Check for signature headers
    const signature1 = headers['x-adobe-digital-signature-1'];
    const signature2 = headers['x-adobe-digital-signature-2'];
    const keyPath1 = headers['x-adobe-public-key1-path'];
    const keyPath2 = headers['x-adobe-public-key2-path'];
    
    if (!signature1 && !signature2) {
      logger.warn('No Adobe digital signatures found in headers');
      return { valid: false, reason: 'No signatures found' };
    }
    
    // Check recipient_client_id
    if (event.recipient_client_id && event.recipient_client_id !== config.CLIENT_ID) {
      logger.warn('Event recipient_client_id mismatch', {
        expected: config.CLIENT_ID,
        received: event.recipient_client_id
      });
      return { valid: false, reason: 'Client ID mismatch' };
    }
    
    // Prepare payload for signature verification
    const payloadToVerify = typeof payload === 'string' ? payload : JSON.stringify(payload);
    
    let validSignatureFound = false;
    
    // Verify first signature
    if (signature1 && keyPath1) {
      try {
        logger.debug('Validating signature 1');
        const publicKey1 = await downloadPublicKey(keyPath1);
        
        const verifier = crypto.createVerify('SHA256');
        verifier.update(payloadToVerify);
        
        const isValid = verifier.verify(publicKey1, signature1, 'base64');
        if (isValid) {
          validSignatureFound = true;
          logger.info('Signature 1 validation successful');
        } else {
          logger.warn('Signature 1 validation failed');
        }
      } catch (error) {
        logger.warn('Error validating signature 1', { error: error.message });
      }
    }
    
    // Verify second signature (if first failed)
    if (!validSignatureFound && signature2 && keyPath2) {
      try {
        logger.debug('Validating signature 2');
        const publicKey2 = await downloadPublicKey(keyPath2);
        
        const verifier = crypto.createVerify('SHA256');
        verifier.update(payloadToVerify);
        
        const isValid = verifier.verify(publicKey2, signature2, 'base64');
        if (isValid) {
          validSignatureFound = true;
          logger.info('Signature 2 validation successful');
        } else {
          logger.warn('Signature 2 validation failed');
        }
      } catch (error) {
        logger.warn('Error validating signature 2', { error: error.message });
      }
    }
    
    if (validSignatureFound) {
      logger.info('Adobe digital signature validation successful');
      return { valid: true };
    } else {
      logger.error('All signature validations failed');
      return { valid: false, reason: 'Invalid signatures' };
    }
    
  } catch (error) {
    logger.error('Error during signature validation', error);
    return { valid: false, reason: error.message };
  }
}

/**
 * Perform authentication check for event
 */
async function authenticateEvent(event, params, config) {
  if (!config.ENABLE_SIGNATURE_VALIDATION) {
    logger.debug('Adobe signature validation disabled');
    return { authenticated: true, reason: 'Validation disabled' };
  }
  
  // In Runtime Action headers are passed via __ow_headers
  const headers = params.__ow_headers || {};
  
  logger.debug('Checking for Adobe signature headers', {
    hasSignature1: !!(headers['x-adobe-digital-signature-1']),
    hasSignature2: !!(headers['x-adobe-digital-signature-2']),
    hasKeyPath1: !!(headers['x-adobe-public-key1-path']),
    hasKeyPath2: !!(headers['x-adobe-public-key2-path'])
  });
  
  if (headers['x-adobe-digital-signature-1'] || headers['x-adobe-digital-signature-2']) {
    const signatureValidation = await validateAdobeSignature(event, headers, params, config);
    
    if (!signatureValidation.valid) {
      logger.error('Adobe signature validation failed', {
        reason: signatureValidation.reason,
        eventId: event.id
      });
      
      return {
        authenticated: false,
        reason: signatureValidation.reason,
        statusCode: 401
      };
    }
    
    return { authenticated: true, reason: 'Signature validation passed' };
    
  } else {
    logger.warn('No Adobe signatures found, but validation is enabled');
    
    // In development can skip, in production - block
    if (process.env.NODE_ENV === 'production') {
      return {
        authenticated: false,
        reason: 'No Adobe digital signatures found',
        statusCode: 401
      };
    }
    
    return { 
      authenticated: true, 
      reason: 'Development mode - signatures not required' 
    };
  }
}

module.exports = {
  downloadPublicKey,
  validateAdobeSignature,
  authenticateEvent
};

