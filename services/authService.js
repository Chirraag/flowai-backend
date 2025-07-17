const axios = require('axios');
const REDOX_CONFIG = require('../config/redox');
const logger = require('../utils/logger');

class AuthService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken(providedToken = null) {
    logger.debug('Getting access token', { hasProvidedToken: !!providedToken });
    
    if (providedToken && providedToken.trim() !== '') {
      logger.debug('Using provided token');
      return providedToken;
    }

    if (this.accessToken && this.tokenExpiry > Date.now()) {
      logger.debug('Using cached token');
      return this.accessToken;
    }

    logger.info('Refreshing access token');
    return await this.refreshToken();
  }

  async refreshToken() {
    try {
      // Enhanced logging for auth token refresh
      logger.info('=== AUTH TOKEN REFRESH REQUEST START ===', {
        method: 'POST',
        url: REDOX_CONFIG.loginURL,
        clientId: REDOX_CONFIG.clientId ? `${REDOX_CONFIG.clientId.substring(0, 8)}...` : 'none',
        hasSecret: !!REDOX_CONFIG.clientSecret,
        timestamp: new Date().toISOString()
      });

      const requestBody = {
        apiKey: REDOX_CONFIG.clientId,
        secret: REDOX_CONFIG.clientSecret
      };

      // Log request body (with masked secret)
      logger.info('Auth token refresh request body:', {
        requestBody: {
          apiKey: REDOX_CONFIG.clientId,
          secret: REDOX_CONFIG.clientSecret ? `${REDOX_CONFIG.clientSecret.substring(0, 8)}...` : 'none'
        }
      });

      const response = await axios.post(REDOX_CONFIG.loginURL, requestBody);

      // Enhanced success logging
      logger.info('=== AUTH TOKEN REFRESH RESPONSE SUCCESS ===', {
        status: response.status,
        statusText: response.statusText,
        expiresIn: response.data.expiresIn,
        hasAccessToken: !!response.data.accessToken,
        tokenPreview: response.data.accessToken ? `${response.data.accessToken.substring(0, 20)}...` : 'none',
        responseHeaders: response.headers,
        timestamp: new Date().toISOString()
      });

      // Log response body (with masked token)
      logger.info('Auth token refresh response body:', {
        responseBody: {
          ...response.data,
          accessToken: response.data.accessToken ? `${response.data.accessToken.substring(0, 20)}...` : 'none'
        }
      });

      this.accessToken = response.data.accessToken;
      this.tokenExpiry = Date.now() + (response.data.expiresIn * 1000);
      
      logger.info('Access token cached successfully', {
        expiresIn: response.data.expiresIn,
        expiryTime: new Date(this.tokenExpiry).toISOString()
      });
      
      return this.accessToken;
    } catch (error) {
      // Enhanced error logging
      logger.error('=== AUTH TOKEN REFRESH RESPONSE ERROR ===', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        error: error.response?.data?.message || error.message,
        errorData: error.response?.data,
        requestUrl: REDOX_CONFIG.loginURL,
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`Authentication failed: ${error.response?.data?.message || error.message}`);
    }
  }
}

module.exports = AuthService;