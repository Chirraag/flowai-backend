const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const retellAgentService = require('../services/retellAgentService');

/**
 * @swagger
 * components:
 *   schemas:
 *     Agent:
 *       type: object
 *       properties:
 *         agent_id:
 *           type: string
 *         agent_name:
 *           type: string
 *         voice_id:
 *           type: string
 *         language:
 *           type: string
 *         llm_websocket_url:
 *           type: string
 *     ConversationFlow:
 *       type: object
 *       properties:
 *         conversation_flow_id:
 *           type: string
 *         created_at:
 *           type: string
 *         nodes:
 *           type: array
 *         edges:
 *           type: array
 *     Voice:
 *       type: object
 *       properties:
 *         voice_id:
 *           type: string
 *         voice_name:
 *           type: string
 *         accent:
 *           type: string
 *         gender:
 *           type: string
 */

/**
 * @swagger
 * tags:
 *   name: Retell Agent
 *   description: Retell AI agent and conversation flow management
 */

/**
 * @swagger
 * /api/v1/retell/agent/get:
 *   post:
 *     summary: Get agent details by ID
 *     tags: [Retell Agent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agent_id
 *             properties:
 *               agent_id:
 *                 type: string
 *                 description: The ID of the agent
 *                 example: "16b980523634a6dc504898cda492e939"
 *     responses:
 *       200:
 *         description: Agent details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Agent'
 *       400:
 *         description: Missing agent_id
 *       500:
 *         description: Internal server error
 */
router.post('/get', async (req, res) => {
  try {
    const { agent_id } = req.body;

    logger.info('Get agent request', { agent_id });

    if (!agent_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: agent_id'
      });
    }

    const agent = await retellAgentService.getAgent(agent_id);

    res.json({
      success: true,
      data: agent
    });
  } catch (error) {
    logger.error('Get agent error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/retell/agent/update:
 *   post:
 *     summary: Update agent details
 *     tags: [Retell Agent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - agent_id
 *             properties:
 *               agent_id:
 *                 type: string
 *                 description: The ID of the agent to update
 *                 example: "16b980523634a6dc504898cda492e939"
 *               agent_name:
 *                 type: string
 *                 description: Updated agent name
 *               voice_id:
 *                 type: string
 *                 description: Updated voice ID
 *               language:
 *                 type: string
 *                 description: Updated language
 *               llm_websocket_url:
 *                 type: string
 *                 description: Updated LLM websocket URL
 *               general_prompt:
 *                 type: string
 *                 description: Updated general prompt
 *               boosted_keywords:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Updated boosted keywords
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *       400:
 *         description: Missing agent_id
 *       500:
 *         description: Internal server error
 */
router.post('/update', async (req, res) => {
  try {
    const { agent_id, ...updateData } = req.body;

    logger.info('Update agent request', { 
      agent_id,
      updateFields: Object.keys(updateData)
    });

    if (!agent_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: agent_id'
      });
    }

    const updatedAgent = await retellAgentService.updateAgent(agent_id, updateData);

    res.json({
      success: true,
      data: updatedAgent
    });
  } catch (error) {
    logger.error('Update agent error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/retell/agent/list:
 *   post:
 *     summary: List all agents from database
 *     tags: [Retell Agent]
 *     requestBody:
 *       description: No request body required
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: List of all agents retrieved successfully from database
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           agent_id:
 *                             type: string
 *                             example: "agent_24d6e402758a455c16ec38b558"
 *                           user_id:
 *                             type: string
 *                             example: "xyz"
 *                           type:
 *                             type: string
 *                             example: "patient_intake"
 *                           status:
 *                             type: string
 *                             example: "available"
 *       500:
 *         description: Internal server error
 */
router.post('/list', async (req, res) => {
  try {
    logger.info('List all agents request from database');

    const agents = await retellAgentService.listAgents();

    res.json({
      success: true,
      data: agents
    });
  } catch (error) {
    logger.error('List agents error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


/**
 * @swagger
 * /api/v1/retell/agent/conversation-flow/get:
 *   post:
 *     summary: Get conversation flow details by ID
 *     tags: [Retell Agent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - conversation_flow_id
 *             properties:
 *               conversation_flow_id:
 *                 type: string
 *                 description: The ID of the conversation flow
 *                 example: "conversation_flow_id"
 *     responses:
 *       200:
 *         description: Conversation flow details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/ConversationFlow'
 *       400:
 *         description: Missing conversation_flow_id
 *       500:
 *         description: Internal server error
 */
router.post('/conversation-flow/get', async (req, res) => {
  try {
    const { conversation_flow_id } = req.body;

    logger.info('Get conversation flow request', { conversation_flow_id });

    if (!conversation_flow_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: conversation_flow_id'
      });
    }

    const conversationFlow = await retellAgentService.getConversationFlow(conversation_flow_id);

    res.json({
      success: true,
      data: conversationFlow
    });
  } catch (error) {
    logger.error('Get conversation flow error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/retell/agent/conversation-flow/update:
 *   post:
 *     summary: Update conversation flow
 *     tags: [Retell Agent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - conversation_flow_id
 *             properties:
 *               conversation_flow_id:
 *                 type: string
 *                 description: The ID of the conversation flow to update
 *               nodes:
 *                 type: array
 *                 description: Updated nodes array
 *               edges:
 *                 type: array
 *                 description: Updated edges array
 *     responses:
 *       200:
 *         description: Conversation flow updated successfully
 *       400:
 *         description: Missing conversation_flow_id
 *       500:
 *         description: Internal server error
 */
router.post('/conversation-flow/update', async (req, res) => {
  try {
    const { conversation_flow_id, ...updateData } = req.body;

    logger.info('Update conversation flow request', { 
      conversation_flow_id,
      updateFields: Object.keys(updateData)
    });

    if (!conversation_flow_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: conversation_flow_id'
      });
    }

    const updatedFlow = await retellAgentService.updateConversationFlow(
      conversation_flow_id, 
      updateData
    );

    res.json({
      success: true,
      data: updatedFlow
    });
  } catch (error) {
    logger.error('Update conversation flow error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/retell/agent/conversation-flow/list:
 *   post:
 *     summary: List all conversation flows
 *     tags: [Retell Agent]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               limit:
 *                 type: integer
 *                 description: Maximum number of flows to return
 *                 example: 10
 *               starting_after:
 *                 type: string
 *                 description: Cursor for pagination (conversation_flow_id)
 *               ending_before:
 *                 type: string
 *                 description: Cursor for pagination (conversation_flow_id)
 *     responses:
 *       200:
 *         description: List of conversation flows retrieved successfully
 *       500:
 *         description: Internal server error
 */
router.post('/conversation-flow/list', async (req, res) => {
  try {
    const { limit, starting_after, ending_before } = req.body;

    logger.info('List conversation flows request', { limit, starting_after, ending_before });

    const options = {};
    if (limit) options.limit = limit;
    if (starting_after) options.starting_after = starting_after;
    if (ending_before) options.ending_before = ending_before;

    const conversationFlows = await retellAgentService.listConversationFlows(options);

    res.json({
      success: true,
      data: conversationFlows
    });
  } catch (error) {
    logger.error('List conversation flows error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/v1/retell/agent/voice/list:
 *   post:
 *     summary: List all available voices
 *     tags: [Retell Agent]
 *     responses:
 *       200:
 *         description: List of voices retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Voice'
 *       500:
 *         description: Internal server error
 */
router.post('/voice/list', async (req, res) => {
  try {
    logger.info('List voices request');

    const voices = await retellAgentService.listVoices();

    res.json({
      success: true,
      data: voices
    });
  } catch (error) {
    logger.error('List voices error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;