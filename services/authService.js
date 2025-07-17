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
      logger.info('Requesting new access token from Redox');
      const response = await axios.post(REDOX_CONFIG.loginURL, {
        apiKey: REDOX_CONFIG.clientId,
        secret: REDOX_CONFIG.clientSecret
      });

      this.accessToken = response.data.accessToken;
      this.tokenExpiry = Date.now() + (response.data.expiresIn * 1000);
      
      logger.info('Access token refreshed successfully', {
        expiresIn: response.data.expiresIn
      });
      
      return this.accessToken;
    } catch (error) {
      logger.error('Authentication failed', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }
}

module.exports = AuthService;