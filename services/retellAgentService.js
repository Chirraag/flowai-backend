require('dotenv').config();
const Retell = require('retell-sdk');
const logger = require('../utils/logger');
const db = require('../db/connection');

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
   * Get agent details by agent ID with enhanced data
   * @param {string} agentId - The ID of the agent
   * @returns {Promise<object>} - Enhanced agent details with conversation flow and knowledge base data
   */
  async getAgent(agentId) {
    try {
      logger.info('Getting agent details', { agentId });

      if (!this.apiKey) {
        throw new Error('RETELL_API_KEY not configured');
      }

      // Step 1: Get agent details
      const agentResponse = await this.client.agent.retrieve(agentId);

      logger.info('Agent details retrieved successfully', { 
        agentId: agentResponse.agent_id,
        agentName: agentResponse.agent_name
      });

      // Initialize enhanced response
      const enhancedResponse = {
        language: agentResponse.language,
        voice_id: agentResponse.voice_id,
        global_prompt: null,
        model: null,
        knowledge_bases: []
      };

      // Step 2: Check if agent has conversation flow
      if (agentResponse.response_engine?.type === 'conversation-flow' && 
          agentResponse.response_engine?.conversation_flow_id) {

        const conversationFlowId = agentResponse.response_engine.conversation_flow_id;
        logger.info('Fetching conversation flow details', { conversationFlowId });

        try {
          // Get conversation flow details
          const conversationFlowResponse = await this.client.conversationFlow.retrieve(conversationFlowId);

          logger.info('Conversation flow retrieved successfully', { 
            conversationFlowId: conversationFlowResponse.conversation_flow_id,
            hasKnowledgeBases: conversationFlowResponse.knowledge_base_ids?.length > 0
          });

          // Extract global prompt and model
          enhancedResponse.global_prompt = conversationFlowResponse.global_prompt || null;
          enhancedResponse.model = conversationFlowResponse.model_choice?.model || null;

          // Step 3: Fetch knowledge base details if any
          if (conversationFlowResponse.knowledge_base_ids && 
              conversationFlowResponse.knowledge_base_ids.length > 0) {

            logger.info('Fetching knowledge base details', { 
              count: conversationFlowResponse.knowledge_base_ids.length 
            });

            // Fetch all knowledge bases in parallel
            const knowledgeBasePromises = conversationFlowResponse.knowledge_base_ids.map(async (kbId) => {
              try {
                const kbResponse = await this.client.knowledgeBase.retrieve(kbId);
                logger.info('Knowledge base retrieved', { 
                  knowledge_base_id: kbResponse.knowledge_base_id 
                });
                return kbResponse;
              } catch (kbError) {
                logger.error('Error fetching knowledge base', {
                  knowledge_base_id: kbId,
                  error: kbError.message
                });
                // Return a placeholder for failed fetches
                return {
                  knowledge_base_id: kbId,
                  error: 'Failed to retrieve knowledge base details'
                };
              }
            });

            enhancedResponse.knowledge_bases = await Promise.all(knowledgeBasePromises);
          }

        } catch (cfError) {
          logger.error('Error fetching conversation flow', {
            conversationFlowId,
            error: cfError.message
          });
          // Continue without conversation flow data
        }
      }

      // Combine all data
      const finalResponse = {
        ...agentResponse,
        language: enhancedResponse.language,
        voice_id: enhancedResponse.voice_id,
        global_prompt: enhancedResponse.global_prompt,
        model: enhancedResponse.model,
        knowledge_bases: enhancedResponse.knowledge_bases
      };

      logger.info('Enhanced agent details prepared', { 
        agentId,
        hasGlobalPrompt: !!finalResponse.global_prompt,
        knowledgeBaseCount: finalResponse.knowledge_bases.length
      });

      return finalResponse;

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
   * @param {object} updateData - The data to update (voice_id, language, global_prompt, model)
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

      // Separate fields based on update type
      const agentFields = {};
      const conversationFlowFields = {};

      // Fields that update via agent API
      if (updateData.voice_id !== undefined) {
        agentFields.voice_id = updateData.voice_id;
      }
      if (updateData.language !== undefined) {
        agentFields.language = updateData.language;
      }

      // Fields that update via conversation flow API
      if (updateData.global_prompt !== undefined) {
        conversationFlowFields.global_prompt = updateData.global_prompt;
      }
      if (updateData.model !== undefined) {
        conversationFlowFields.model_choice = {
          type: "cascading",
          model: updateData.model
        };
      }

      let agentResponse = null;
      let conversationFlowResponse = null;

      // Update agent fields if any
      if (Object.keys(agentFields).length > 0) {
        logger.info('Updating agent fields', { 
          agentId,
          fields: Object.keys(agentFields)
        });

        agentResponse = await this.client.agent.update(agentId, agentFields);

        logger.info('Agent fields updated successfully', { 
          agentId: agentResponse.agent_id
        });
      }

      // Update conversation flow fields if any
      if (Object.keys(conversationFlowFields).length > 0) {
        logger.info('Need to update conversation flow fields', { 
          agentId,
          fields: Object.keys(conversationFlowFields)
        });

        // First, get the agent to find conversation_flow_id
        const agent = await this.client.agent.retrieve(agentId);

        if (!agent.response_engine?.conversation_flow_id) {
          throw new Error('Agent does not have a conversation flow configured');
        }

        const conversationFlowId = agent.response_engine.conversation_flow_id;
        logger.info('Found conversation flow ID', { conversationFlowId });

        // Update the conversation flow
        conversationFlowResponse = await this.client.conversationFlow.update(
          conversationFlowId,
          conversationFlowFields
        );

        logger.info('Conversation flow updated successfully', { 
          conversationFlowId: conversationFlowResponse.conversation_flow_id
        });

        // If we haven't updated the agent yet, get the latest agent data
        if (!agentResponse) {
          agentResponse = agent;
        }
      }

      // If neither agent nor conversation flow was updated, just return the current agent
      if (!agentResponse && !conversationFlowResponse) {
        agentResponse = await this.client.agent.retrieve(agentId);
      }

      // Return combined response
      const response = {
        ...agentResponse,
        // Add conversation flow update status if applicable
        ...(conversationFlowResponse && {
          conversation_flow_updated: true,
          conversation_flow_id: conversationFlowResponse.conversation_flow_id
        })
      };

      logger.info('Agent update completed', { 
        agentId,
        agentFieldsUpdated: Object.keys(agentFields).length > 0,
        conversationFlowFieldsUpdated: Object.keys(conversationFlowFields).length > 0
      });

      return response;

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
   * List all agents from database
   * @param {object} options - Optional parameters (not used in simplified version)
   * @returns {Promise<object>} - List of all agents from database
   */
  async listAgents(options = {}) {
    try {
      logger.info('Listing all agents from database');

      // Simple query to get all agents
      const query = 'SELECT * FROM agents ORDER BY user_id, type';

      const result = await db.query(query, []); // Pass empty array for parameters

      // Format the response to match expected structure
      const agents = result.rows.map(row => ({
        agent_id: row.agent_id,
        user_id: row.user_id,
        type: row.type,
        status: row.status
      }));

      logger.info('Agents listed successfully from database', { 
        count: agents.length
      });

      return {
        data: agents
      };

    } catch (error) {
      logger.error('Error listing agents from database', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Update agent status in database
   * @param {string} agentId - The agent ID to update
   * @param {string} status - The new status
   * @returns {Promise<object>} - Updated result with all agents list
   */
  async updateAgentStatus(agentId, status) {
    try {
      logger.info('Updating agent status in database', { 
        agentId,
        status,
        userId: 'xyz' // Hardcoded for now
      });

      // Update query with hardcoded user_id
      const updateQuery = `
        UPDATE agents 
        SET status = $1 
        WHERE agent_id = $2 AND user_id = $3
        RETURNING *
      `;

      const updateParams = [status, agentId, 'xyz'];

      const updateResult = await db.query(updateQuery, updateParams);

      if (updateResult.rowCount === 0) {
        throw new Error('Agent not found or does not belong to user');
      }

      logger.info('Agent status updated successfully', { 
        agentId,
        newStatus: status,
        updatedRows: updateResult.rowCount
      });

      // After updating, fetch all agents (same as listAgents)
      const listQuery = 'SELECT * FROM agents ORDER BY user_id, type';
      const listResult = await db.query(listQuery, []);

      // Format the response to match expected structure
      const agents = listResult.rows.map(row => ({
        agent_id: row.agent_id,
        user_id: row.user_id,
        type: row.type,
        status: row.status
      }));

      logger.info('Returning updated agents list', { 
        count: agents.length
      });

      return {
        data: agents
      };

    } catch (error) {
      logger.error('Error updating agent status', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get conversation flow details by ID
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

  /**
   * Create a web call
   * @param {object} webCallData - Web call configuration
   * @returns {Promise<object>} - Web call response with access token
   */
  async createWebCall(webCallData) {
    try {
      logger.info('Creating web call', { 
        agent_id: webCallData.agent_id,
        hasMetadata: !!webCallData.metadata,
        hasDynamicVariables: !!webCallData.retell_llm_dynamic_variables
      });
  
      if (!this.apiKey) {
        throw new Error('RETELL_API_KEY not configured');
      }
  
      // Prepare web call parameters
      const webCallParams = {
        agent_id: webCallData.agent_id
      };
  
      // Add optional parameters if provided
      if (webCallData.metadata) {
        webCallParams.metadata = webCallData.metadata;
      }
  
      if (webCallData.retell_llm_dynamic_variables) {
        webCallParams.retell_llm_dynamic_variables = webCallData.retell_llm_dynamic_variables;
      }
  
      logger.info('Calling Retell API to create web call', { webCallParams });
  
      const webCallResponse = await this.client.call.createWebCall(webCallParams);
  
      logger.info('Web call created successfully', { 
        call_id: webCallResponse.call_id,
        call_type: webCallResponse.call_type,
        hasAccessToken: !!webCallResponse.access_token
      });
  
      return webCallResponse;
  
    } catch (error) {
      logger.error('Error creating web call', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = new RetellAgentService();