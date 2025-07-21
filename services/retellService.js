const axios = require('axios');
const logger = require('../utils/logger');

class RetellService {
  constructor() {
    this.apiKey = process.env.RETELL_API_KEY;
    this.fromNumber = process.env.RETELL_FROM_NUMBER;
    this.agentId = process.env.RETELL_AGENT_ID;
    this.baseUrl = 'https://api.retellai.com/v2';
  }

  /**
   * Create an outbound phone call via Retell API
   * @param {string} toNumber - The phone number to call
   * @param {object} dynamicVariables - Variables to pass to the call
   * @returns {Promise<object>} - The call creation response
   */
  async createPhoneCall(toNumber, dynamicVariables) {
    try {
      if (!this.apiKey) {
        throw new Error('RETELL_API_KEY not configured');
      }

      if (!this.fromNumber) {
        throw new Error('RETELL_FROM_NUMBER not configured');
      }

      if (!this.agentId) {
        throw new Error('RETELL_AGENT_ID not configured');
      }

      // Ensure all dynamic variables are strings
      const stringifiedVariables = {};
      for (const [key, value] of Object.entries(dynamicVariables)) {
        stringifiedVariables[key] = String(value || '');
      }

      const payload = {
        agent_id: this.agentId,
        from_number: this.fromNumber,
        to_number: toNumber,
        dynamic_variables: stringifiedVariables
      };

      logger.info('Creating outbound call via Retell', {
        toNumber,
        fromNumber: this.fromNumber,
        variableCount: Object.keys(stringifiedVariables).length
      });

      const response = await axios.post(
        `${this.baseUrl}/create-phone-call`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info('Outbound call created successfully', {
        callId: response.data.call_id,
        status: response.data.status
      });

      return response.data;

    } catch (error) {
      logger.error('Error creating outbound call', {
        error: error.message,
        response: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Get call details
   * @param {string} callId - The ID of the call
   * @returns {Promise<object>} - The call details
   */
  async getCallDetails(callId) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/get-call/${callId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      return response.data;

    } catch (error) {
      logger.error('Error getting call details', {
        callId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * End an ongoing call
   * @param {string} callId - The ID of the call to end
   * @returns {Promise<object>} - The response
   */
  async endCall(callId) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/end-call/${callId}`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      logger.info('Call ended successfully', { callId });
      return response.data;

    } catch (error) {
      logger.error('Error ending call', {
        callId,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new RetellService();