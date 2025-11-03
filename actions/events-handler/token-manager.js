/**
 * Adobe I/O Access Token Manager - Simplified Version
 * 
 * Manages Adobe I/O access tokens with automatic refresh and persistent storage.
 */

const fetch = require('node-fetch');

/**
 * Token Manager class
 */
class TokenManager {
  constructor(params = {}, stateManager = null, logger = console) {
    // Extract credentials from environment or params
    this.clientId = params.CLIENT_ID || process.env.CLIENT_ID;
    this.clientSecret = params.CLIENT_SECRET || process.env.CLIENT_SECRET;
    this.imsOrgId = params.IMS_ORG_ID || params.ims_org_id || process.env.IMS_ORG_ID;
    
    // Validate required credentials
    if (!this.clientId || !this.clientSecret || !this.imsOrgId) {
      throw new Error('Missing required credentials: CLIENT_ID, CLIENT_SECRET, and IMS_ORG_ID must be provided');
    }
    
    // Adobe IMS endpoint
    this.imsEndpoint = 'https://ims-na1.adobelogin.com/ims/token/v3';
    
    // Required scopes for Events API and Journaling
    this.scopes = 'adobeio_api,openid,read_organizations';
    
    // State management
    this.stateManager = stateManager;
    this.stateKey = 'adobe_io_access_token';
    this.logger = logger;
    
    // Token buffer - refresh 5 minutes before expiration
    this.refreshBufferMs = 5 * 60 * 1000;
    
    // Current token cache
    this.tokenCache = null;
  }

  /**
   * Get a valid access token (refresh if needed)
   * @returns {Promise<string>} Valid access token
   */
  async getAccessToken() {
    try {
      // Check cache first
      if (this.tokenCache && this.isTokenValid(this.tokenCache)) {
        this.logger.debug('Using cached access token');
        return this.tokenCache.access_token;
      }

      // Try to get token from persistent storage
      if (this.stateManager) {
        const storedData = await this.stateManager.get(this.stateKey);
        
        if (storedData) {
          try {
            // Handle both string and object responses from State
            let storedToken;
            if (typeof storedData === 'string') {
              storedToken = JSON.parse(storedData);
            } else if (typeof storedData === 'object' && storedData.value) {
              // State sometimes returns { value: 'data' } object
              storedToken = typeof storedData.value === 'string' 
                ? JSON.parse(storedData.value) 
                : storedData.value;
            } else if (typeof storedData === 'object') {
              // Already an object
              storedToken = storedData;
            }
            
            if (storedToken && this.isTokenValid(storedToken)) {
              this.logger.debug('Using stored access token');
              this.tokenCache = storedToken;
              return storedToken.access_token;
            }
          } catch (error) {
            this.logger.warn('Error parsing stored token, will fetch new one:', error.message);
          }
        }
      }

      // Need to fetch new token
      this.logger.info('Fetching new access token...');
      const newToken = await this.fetchNewToken();
      
      // Store in cache and persistent storage
      this.tokenCache = newToken;
      if (this.stateManager) {
        await this.stateManager.put(this.stateKey, JSON.stringify(newToken));
      }
      
      this.logger.info('New access token obtained and cached');
      return newToken.access_token;
      
    } catch (error) {
      this.logger.error('Error getting access token:', error.message);
      throw error;
    }
  }

  /**
   * Check if token is valid (not expired with buffer)
   * @param {Object} tokenData - Token data with expires_at timestamp
   * @returns {boolean} True if token is still valid
   */
  isTokenValid(tokenData) {
    if (!tokenData || !tokenData.expires_at) {
      return false;
    }
    
    const now = Date.now();
    const expiresAt = tokenData.expires_at;
    
    // Token is valid if it won't expire within the refresh buffer period
    return (expiresAt - now) > this.refreshBufferMs;
  }

  /**
   * Fetch a new access token from Adobe IMS
   * @returns {Promise<Object>} Token data with expiry information
   */
  async fetchNewToken() {
    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: this.scopes
      });

      const response = await fetch(this.imsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`IMS token request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const tokenData = await response.json();
      
      if (!tokenData.access_token) {
        throw new Error('No access_token in IMS response');
      }

      // Add expiry timestamp (expires_in is in seconds)
      const now = Date.now();
      const expiresInMs = (tokenData.expires_in || 86400) * 1000; // Default 24 hours
      
      const tokenWithExpiry = {
        ...tokenData,
        created_at: now,
        expires_at: now + expiresInMs
      };
      
      return tokenWithExpiry;
      
    } catch (error) {
      this.logger.error('Failed to fetch new token:', error.message);
      throw error;
    }
  }
}

module.exports = { TokenManager };

