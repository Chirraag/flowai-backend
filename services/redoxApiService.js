const axios = require('axios');
const REDOX_CONFIG = require('../config/redox');
const logger = require('../utils/logger');

class RedoxAPIService {
  static async makeRequest(method, endpoint, data = null, params = null, accessToken) {
    // Enhanced logging for Redox API calls
    logger.info('=== REDOX API REQUEST START ===', {
      method: method,
      endpoint: endpoint,
      fullUrl: `${REDOX_CONFIG.baseURL}${endpoint}`,
      hasData: !!data,
      hasParams: !!params,
      accessToken: accessToken ? `${accessToken.substring(0, 20)}...` : 'none',
      timestamp: new Date().toISOString()
    });
    
    // Log request data for debugging
    if (data) {
      logger.info(`Redox API request body (${method} ${endpoint}):`, {
        requestBody: typeof data === 'object' ? JSON.stringify(data, null, 2) : data
      });
    }
    
    if (params) {
      logger.info(`Redox API request params (${method} ${endpoint}):`, {
        requestParams: params
      });
    }
    
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': method === 'POST' && data ? 'application/fhir+json' : 'application/x-www-form-urlencoded'
    };

    const config = {
      method,
      url: `${REDOX_CONFIG.baseURL}${endpoint}`,
      headers
    };

    if (data) {
      config.data = data;
    }

    if (params) {
      if (method === 'POST' && !data) {
        // Only use form data if no JSON data is provided
        const formData = new URLSearchParams(params).toString();
        config.data = formData;
        config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        logger.info(`Redox API form data (${method} ${endpoint}):`, {
          formData: formData
        });
      } else {
        config.params = params;
      }
    }

    // Log complete request configuration
    logger.info('=== REDOX API REQUEST CONFIG ===', {
      config: {
        method: config.method,
        url: config.url,
        headers: {
          ...config.headers,
          'Authorization': config.headers['Authorization'] ? `Bearer ${config.headers['Authorization'].substring(7, 27)}...` : 'none'
        },
        hasData: !!config.data,
        dataPreview: config.data ? (typeof config.data === 'string' ? config.data.substring(0, 200) : JSON.stringify(config.data).substring(0, 200)) : null
      },
      timestamp: new Date().toISOString()
    });

    try {
      const response = await axios(config);
      
      // Enhanced response logging
      logger.info('=== REDOX API RESPONSE SUCCESS ===', {
        method: method,
        endpoint: endpoint,
        status: response.status,
        statusText: response.statusText,
        dataSize: JSON.stringify(response.data).length,
        responseHeaders: response.headers,
        timestamp: new Date().toISOString()
      });

      // Log response body for debugging
      logger.info(`Redox API response body (${method} ${endpoint}):`, {
        responseBody: JSON.stringify(response.data, null, 2)
      });

      return response.data;
    } catch (error) {
      // Enhanced error logging
      logger.error('=== REDOX API RESPONSE ERROR ===', {
        method: method,
        endpoint: endpoint,
        status: error.response?.status,
        statusText: error.response?.statusText,
        error: error.response?.data?.message || error.message,
        errorData: error.response?.data,
        requestUrl: config.url,
        timestamp: new Date().toISOString()
      });
      
      throw new Error(`Redox API Error: ${error.response?.data?.message || error.message}`);
    }
  }
}

module.exports = RedoxAPIService;