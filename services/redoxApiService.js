const axios = require('axios');
const REDOX_CONFIG = require('../config/redox');
const logger = require('../utils/logger');

class RedoxAPIService {
  static async makeRequest(method, endpoint, data = null, params = null, accessToken) {
    logger.info(`Making Redox API request: ${method} ${endpoint}`, {
      hasData: !!data,
      hasParams: !!params
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
      if (method === 'POST') {
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

    try {
      const response = await axios(config);
      logger.info(`Redox API request successful: ${method} ${endpoint}`, {
        status: response.status,
        dataSize: JSON.stringify(response.data).length
      });
      return response.data;
    } catch (error) {
      logger.error(`Redox API request failed: ${method} ${endpoint}`, {
        status: error.response?.status,
        error: error.response?.data?.message || error.message,
        data: error.response?.data
      });
      throw new Error(`Redox API Error: ${error.response?.data?.message || error.message}`);
    }
  }
}

module.exports = RedoxAPIService;