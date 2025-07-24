require('dotenv').config();
const Retell = require('retell-sdk');
const logger = require('../utils/logger');

class RetellAgentService {
  constructor() {
    this.apiKey = process.env.RETELL_API_KEY;
    if (!this.apiKey) {
      logger.warn('RETELL_API_KEY not found in environment variables');
    }
    this.client = new Retell({
      apiKey: this.apiKey
    });
  }

  /**
   * Get agent details by agent ID
   * @param {string} agentId - The ID of the agent
   * @returns {Promise<object>} - Agent details
   */
  async getAgent(agentId) {
    try {
      logger.info('Getting agent details', { agentId });

      if (!this.apiKey) {
        throw new Error('RETELL_API_KEY not configured');
      }

      const agentResponse = await this.client.agent.retrieve(agentId);

      logger.info('Agent details retrieved successfully', { 
        agentId: agentResponse.agent_id,
        agentName: agentResponse.agent_name
      });

      return agentResponse;
    } catch (error) {
      logger.error('Error getting agent details', {
        agentId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Update agent details
   * @param {string} agentId - The ID of the agent to update
   * @param {object} updateData - The data to update
   * @returns {Promise<object>} - Updated agent details
   */
  async updateAgent(agentId, updateData) {
    try {
      logger.info('Updating agent', { 
        agentId,
        updateFields: Object.keys(updateData)
      });

      if (!this.apiKey) {
        throw new Error('RETELL_API_KEY not configured');
      }

      const agentResponse = await this.client.agent.update(agentId, updateData);

      logger.info('Agent updated successfully', { 
        agentId: agentResponse.agent_id,
        agentName: agentResponse.agent_name
      });

      return agentResponse;
    } catch (error) {
      logger.error('Error updating agent', {
        agentId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * List all agents
   * @param {object} options - Optional parameters (limit, starting_after, ending_before)
   * @returns {Promise<object>} - List of agents
   */
  async listAgents(options = {}) {
    try {
      logger.info('Listing agents', { options });

      if (!this.apiKey) {
        throw new Error('RETELL_API_KEY not configured');
      }

      const agentsResponse = await this.client.agent.list(options);

      logger.info('Agents listed successfully', { 
        count: agentsResponse.data?.length || 0
      });

      return agentsResponse;
    } catch (error) {
      logger.error('Error listing agents', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get conversation flow details
   * @param {string} conversationFlowId - The ID of the conversation flow
   * @returns {Promise<object>} - Conversation flow details
   */
  async getConversationFlow(conversationFlowId) {
    try {
      logger.info('Getting conversation flow details', { conversationFlowId });

      if (!this.apiKey) {
        throw new Error('RETELL_API_KEY not configured');
      }

      const conversationFlowResponse = await this.client.conversationFlow.retrieve(conversationFlowId);

      logger.info('Conversation flow retrieved successfully', { 
        conversationFlowId: conversationFlowResponse.conversation_flow_id,
        createdAt: conversationFlowResponse.created_at
      });

      return conversationFlowResponse;
    } catch (error) {
      logger.error('Error getting conversation flow', {
        conversationFlowId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Update conversation flow
   * @param {string} conversationFlowId - The ID of the conversation flow to update
   * @param {object} updateData - The data to update
   * @returns {Promise<object>} - Updated conversation flow details
   */
  async updateConversationFlow(conversationFlowId, updateData) {
    try {
      logger.info('Updating conversation flow', { 
        conversationFlowId,
        updateFields: Object.keys(updateData)
      });

      if (!this.apiKey) {
        throw new Error('RETELL_API_KEY not configured');
      }

      const conversationFlowResponse = await this.client.conversationFlow.update(
        conversationFlowId, 
        updateData
      );

      logger.info('Conversation flow updated successfully', { 
        conversationFlowId: conversationFlowResponse.conversation_flow_id
      });

      return conversationFlowResponse;
    } catch (error) {
      logger.error('Error updating conversation flow', {
        conversationFlowId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * List all conversation flows
   * @param {object} options - Optional parameters (limit, starting_after, ending_before)
   * @returns {Promise<object>} - List of conversation flows
   */
  async listConversationFlows(options = {}) {
    try {
      logger.info('Listing conversation flows', { options });

      if (!this.apiKey) {
        throw new Error('RETELL_API_KEY not configured');
      }

      const conversationFlowsResponse = await this.client.conversationFlow.list(options);

      logger.info('Conversation flows listed successfully', { 
        count: conversationFlowsResponse.data?.length || 0
      });

      return conversationFlowsResponse;
    } catch (error) {
      logger.error('Error listing conversation flows', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * List all available voices
   * @returns {Promise<object>} - List of voices
   */
  async listVoices() {
    try {
      logger.info('Listing voices');

      if (!this.apiKey) {
        throw new Error('RETELL_API_KEY not configured');
      }

      const voiceResponses = await this.client.voice.list();

      logger.info('Voices listed successfully', { 
        count: voiceResponses.data?.length || 0
      });

      return voiceResponses;
    } catch (error) {
      logger.error('Error listing voices', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = new RetellAgentService();