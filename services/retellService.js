const axios = require("axios");
const logger = require("../utils/logger");
require("dotenv").config();

class RetellService {
  constructor() {
    this.apiKey = process.env.RETELL_API_KEY;
    this.baseUrl = "https://api.retellai.com/v2";

    // Agent configurations
    this.schedulingConfig = {
      agentId:
        process.env.RETELL_SCHEDULING_AGENT_ID || process.env.RETELL_AGENT_ID,
      fromNumber:
        process.env.RETELL_SCHEDULING_FROM_NUMBER ||
        process.env.RETELL_FROM_NUMBER,
    };

    this.intakeConfig = {
      agentId: process.env.RETELL_INTAKE_AGENT_ID,
      fromNumber: process.env.RETELL_INTAKE_FROM_NUMBER,
    };

    // Legacy support
    this.fromNumber = process.env.RETELL_FROM_NUMBER;
    this.agentId = process.env.RETELL_AGENT_ID;
  }

  /**
   * Create a scheduling call
   * @param {string} toNumber - The phone number to call
   * @param {object} dynamicVariables - Variables to pass to the call
   * @returns {Promise<object>} - The call creation response
   */
  async createSchedulingCall(toNumber, dynamicVariables) {
    return this._createCall(
      toNumber,
      dynamicVariables,
      this.schedulingConfig,
      "scheduling",
    );
  }

  /**
   * Create an intake call
   * @param {string} toNumber - The phone number to call
   * @param {object} dynamicVariables - Variables to pass to the call
   * @returns {Promise<object>} - The call creation response
   */
  async createIntakeCall(toNumber, dynamicVariables) {
    return this._createCall(
      toNumber,
      dynamicVariables,
      this.intakeConfig,
      "intake",
    );
  }

  /**
   * Create an outbound phone call via Retell API (legacy method)
   * @param {string} toNumber - The phone number to call
   * @param {object} dynamicVariables - Variables to pass to the call
   * @returns {Promise<object>} - The call creation response
   */
  async createPhoneCall(toNumber, dynamicVariables) {
    return this._createCall(
      toNumber,
      dynamicVariables,
      {
        agentId: this.agentId,
        fromNumber: this.fromNumber,
      },
      "legacy",
    );
  }

  /**
   * Internal method to create calls with specific config
   * @private
   */
  async _createCall(toNumber, dynamicVariables, config, callType) {
    try {
      if (!this.apiKey) {
        throw new Error("RETELL_API_KEY not configured");
      }

      if (!config.fromNumber) {
        throw new Error(`FROM_NUMBER not configured for ${callType} calls`);
      }

      if (!config.agentId) {
        throw new Error(`AGENT_ID not configured for ${callType} calls`);
      }

      // Ensure all dynamic variables are strings
      const stringifiedVariables = {};
      for (const [key, value] of Object.entries(dynamicVariables)) {
        stringifiedVariables[key] = String(value || "");
      }

      const payload = {
        agent_id: config.agentId,
        from_number: config.fromNumber,
        to_number: toNumber,
        retell_llm_dynamic_variables: stringifiedVariables,
      };

      logger.info(`Creating outbound ${callType} call via Retell`, {
        toNumber,
        fromNumber: config.fromNumber,
        agentId: config.agentId,
        callType,
        variableCount: Object.keys(stringifiedVariables).length,
      });

      const response = await axios.post(
        `${this.baseUrl}/create-phone-call`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        },
      );

      logger.info("Outbound call created successfully", {
        callId: response.data.call_id,
        status: response.data.status,
      });

      return response.data;
    } catch (error) {
      logger.error("Error creating outbound call", {
        error: error.message,
        response: error.response?.data,
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
      const response = await axios.get(`${this.baseUrl}/get-call/${callId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      return response.data;
    } catch (error) {
      logger.error("Error getting call details", {
        callId,
        error: error.message,
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
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
      );

      logger.info("Call ended successfully", { callId });
      return response.data;
    } catch (error) {
      logger.error("Error ending call", {
        callId,
        error: error.message,
      });
      throw error;
    }
  }
}

module.exports = new RetellService();
