/**
 * Adobe I/O Access Token Manager
 * 
 * Manages Adobe I/O access tokens with automatic refresh and persistent storage.
 * Uses Adobe I/O State to store tokens and ensure they don't expire.
 * 
 * Features:
 * - Automatic token refresh before expiration
 * - Persistent storage using @adobe/aio-lib-state
 * - Thread-safe token access
 * - Fallback to environment variables
 */

const fetch = require('node-fetch');
const { StateManager } = require('../lib/state');

/**
 * Token Manager class
 */
class TokenManager {
  constructor(params = {}, stateManager = null, logger = console) {
    // Extract credentials from environment or params
    this.clientId = params.CLIENT_ID || process.env.CLIENT_ID || '94ef891d1d6c498499d19f07f46c812f';
    this.clientSecret = params.CLIENT_SECRET || process.env.CLIENT_SECRET || 'p8e-jgqWHXmjR3ERfUAeBPDXUmv-NU0qTwsi';
    this.imsOrgId = params.IMS_ORG_ID || process.env.IMS_ORG_ID || 'DEDB2A52641B1D460A495F8E@AdobeOrg';
    
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
   * Set state manager (injected dependency)
   */
  setStateManager(stateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Get a valid access token (refresh if needed)
   * @returns {Promise<string>} Valid access token
   */
  async getAccessToken() {
    try {
      // Check cache first
      if (this.tokenCache && this.isTokenValid(this.tokenCache)) {
        return this.tokenCache.access_token;
      }

      // Try to get token from persistent storage
      const storedToken = this.stateManager ? await this.stateManager.get(this.stateKey) : null;
      
      if (storedToken && this.isTokenValid(storedToken)) {
        this.tokenCache = storedToken;
        return storedToken.access_token;
      }

      // Need to fetch new token
      const newToken = await this.fetchNewToken();
      
      // Store in cache and persistent storage
      this.tokenCache = newToken;
      if (this.stateManager) {
        await this.stateManager.put(this.stateKey, newToken);
      }
      
      return newToken.access_token;
      
    } catch (error) {
      console.error('Error getting access token:', error.message);
      throw error;
    }
  }

  /**
   * Check if token is valid (not expired with buffer)
   * @param {Object} tokenData - Token data with expires_at timestamp
   * @returns {boolean} True if token is valid
   */
  isTokenValid(tokenData) {
    if (!tokenData || !tokenData.expires_at) {
      return false;
    }
    
    const now = Date.now();
    const expiresAt = tokenData.expires_at;
    const isValid = now < (expiresAt - this.refreshBufferMs);
    
    if (!isValid) {
      console.log('Token expired or near expiration, will refresh');
    }
    
    return isValid;
  }

  /**
   * Fetch new access token from Adobe IMS
   * @returns {Promise<Object>} Token data with expires_at timestamp
   */
  async fetchNewToken() {
    console.log('Fetching new Adobe I/O access token...');
    
    try {
      const response = await fetch(this.imsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: this.scopes
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token request failed: ${response.status} ${errorText}`);
      }

      const tokenData = await response.json();
      
      if (!tokenData.access_token) {
        throw new Error('No access_token in response');
      }

      // Calculate expiration timestamp
      const expiresInMs = (tokenData.expires_in || 86400) * 1000; // Default 24 hours
      const expiresAt = Date.now() + expiresInMs;
      
      const tokenWithExpiry = {
        ...tokenData,
        expires_at: expiresAt,
        created_at: Date.now()
      };

      const hoursValid = Math.floor(expiresInMs / (1000 * 60 * 60));
      console.log(`New token received (valid for ${hoursValid} hours)`);
      
      return tokenWithExpiry;
      
    } catch (error) {
      console.error('Failed to fetch new token:', error.message);
      throw error;
    }
  }

  /**
   * Force refresh the current token
   * @returns {Promise<string>} New access token
   */
  async refreshToken() {
    console.log('Force refreshing access token...');
    
    try {
      // Clear cache
      this.tokenCache = null;
      
      // Get new token (will fetch since cache is cleared)
      return await this.getAccessToken();
      
    } catch (error) {
      console.error('Failed to refresh token:', error.message);
      throw error;
    }
  }

  /**
   * Get token info for debugging
   * @returns {Object} Token information
   */
  async getTokenInfo() {
    try {
      const storedToken = this.stateManager ? await this.stateManager.get(this.stateKey) : null;
      
      if (!storedToken) {
        return { status: 'no_token' };
      }
      
      const now = Date.now();
      const isValid = this.isTokenValid(storedToken);
      const timeLeft = storedToken.expires_at - now;
      const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
      const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
      
      return {
        status: isValid ? 'valid' : 'expired',
        created_at: new Date(storedToken.created_at).toISOString(),
        expires_at: new Date(storedToken.expires_at).toISOString(),
        time_left: `${hoursLeft}h ${minutesLeft}m`,
        client_id: this.clientId,
        scopes: this.scopes
      };
      
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }
}

module.exports = { TokenManager };
