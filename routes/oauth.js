const express = require('express');
const router = express.Router();
const OAuthService = require('../services/oauthService');
const logger = require('../utils/logger');

const oauthService = new OAuthService();

/**
 * @swagger
 * tags:
 *   name: OAuth
 *   description: OAuth 2.0 authentication endpoints
 */

/**
 * @swagger
 * /oauth/token:
 *   post:
 *     summary: Generate OAuth access token
 *     description: Exchange client credentials for an access token using OAuth 2.0 client credentials flow
 *     tags: [OAuth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - grant_type
 *               - client_id
 *               - client_secret
 *             properties:
 *               grant_type:
 *                 type: string
 *                 enum: [client_credentials]
 *                 description: OAuth grant type (must be 'client_credentials')
 *                 example: "client_credentials"
 *               client_id:
 *                 type: string
 *                 description: OAuth client ID
 *                 example: "cli_a7f3d2b8c9e4f5a6b7c8d9e0"
 *               client_secret:
 *                 type: string
 *                 description: OAuth client secret
 *                 example: "sk_live_4242424242424242..."
 *     responses:
 *       200:
 *         description: Access token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 access_token:
 *                   type: string
 *                   format: uuid
 *                   description: Access token in UUID format
 *                   example: "550e8400-e29b-41d4-a716-446655440000"
 *                 token_type:
 *                   type: string
 *                   description: Token type (always 'Bearer')
 *                   example: "Bearer"
 *                 expires_in:
 *                   type: integer
 *                   description: Token lifetime in seconds (86400 = 24 hours)
 *                   example: 86400
 *       400:
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "unsupported_grant_type"
 *                 error_description:
 *                   type: string
 *                   example: "Grant type must be 'client_credentials'"
 *       401:
 *         description: Invalid client credentials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "invalid_client"
 *                 error_description:
 *                   type: string
 *                   example: "Client authentication failed"
 *       500:
 *         description: Internal server error
 */
router.post('/token', async (req, res) => {
  try {
    logger.info('OAuth token request received', {
      grant_type: req.body.grant_type,
      client_id: req.body.client_id ? req.body.client_id.substring(0, 8) + '...' : 'none'
    });
    
    const { grant_type, client_id, client_secret } = req.body;
    
    // Validate grant type (OAuth 2.0 standard)
    if (!grant_type) {
      logger.warn('OAuth token request failed: missing grant_type');
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameter: grant_type'
      });
    }
    
    if (grant_type !== 'client_credentials') {
      logger.warn('OAuth token request failed: unsupported grant_type', { grant_type });
      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: "Grant type must be 'client_credentials'"
      });
    }
    
    // Validate client credentials presence
    if (!client_id || !client_secret) {
      logger.warn('OAuth token request failed: missing credentials', {
        has_client_id: !!client_id,
        has_client_secret: !!client_secret
      });
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters: client_id and client_secret'
      });
    }
    
    // Validate client credentials
    const client = await oauthService.validateClient(client_id, client_secret);
    
    if (!client) {
      logger.warn('OAuth token request failed: invalid client', {
        client_id: client_id.substring(0, 8) + '...'
      });
      return res.status(401).json({
        error: 'invalid_client',
        error_description: 'Client authentication failed'
      });
    }
    
    // Generate new access token
    const tokenInfo = await oauthService.generateToken(client_id);
    
    logger.info('OAuth token generated successfully', {
      client_id: client_id.substring(0, 8) + '...',
      client_name: client.name,
      token_preview: tokenInfo.access_token.substring(0, 8) + '...'
    });
    
    // Return standard OAuth 2.0 response
    res.json({
      access_token: tokenInfo.access_token,
      token_type: 'Bearer',
      expires_in: tokenInfo.expires_in
    });
    
  } catch (error) {
    logger.error('OAuth token generation error', { error: error.message });
    res.status(500).json({
      error: 'server_error',
      error_description: 'An unexpected error occurred'
    });
  }
});

/**
 * @swagger
 * /oauth/health:
 *   get:
 *     summary: Check OAuth service health
 *     description: Verify that the OAuth service is operational
 *     tags: [OAuth]
 *     responses:
 *       200:
 *         description: OAuth service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "healthy"
 *                 service:
 *                   type: string
 *                   example: "oauth"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2024-01-20T12:00:00.000Z"
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'oauth',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;