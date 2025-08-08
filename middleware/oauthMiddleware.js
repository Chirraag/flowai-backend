const OAuthService = require('../services/oauthService');
const logger = require('../utils/logger');

const oauthService = new OAuthService();

/**
 * OAuth middleware for webhook authentication
 * Validates Bearer token in Authorization header
 */
const oauthMiddleware = async (req, res, next) => {
  try {
    logger.debug('Processing OAuth authentication for webhook');
    
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      logger.warn('OAuth authentication failed: missing Authorization header', {
        path: req.path,
        method: req.method
      });
      return res.status(401).json({
        error: 'missing_token',
        error_description: 'Authorization header is required'
      });
    }
    
    // Check for Bearer token format
    if (!authHeader.startsWith('Bearer ')) {
      logger.warn('OAuth authentication failed: invalid Authorization header format', {
        path: req.path,
        method: req.method,
        headerPreview: authHeader.substring(0, 10) + '...'
      });
      return res.status(401).json({
        error: 'invalid_request',
        error_description: 'Authorization header must use Bearer scheme'
      });
    }
    
    // Extract token (remove 'Bearer ' prefix)
    const token = authHeader.substring(7);
    
    if (!token || token.trim() === '') {
      logger.warn('OAuth authentication failed: empty token', {
        path: req.path,
        method: req.method
      });
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Token is required'
      });
    }
    
    // Validate token
    const tokenInfo = await oauthService.validateToken(token);
    
    if (!tokenInfo) {
      logger.warn('OAuth authentication failed: invalid or expired token', {
        path: req.path,
        method: req.method,
        tokenPreview: token.substring(0, 8) + '...'
      });
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'The access token is invalid or has expired'
      });
    }
    
    // Attach client info to request for logging/tracking
    req.oauthClient = {
      clientId: tokenInfo.client_id,
      clientName: tokenInfo.client_name,
      tokenId: tokenInfo.id
    };
    
    logger.info('OAuth authentication successful', {
      path: req.path,
      method: req.method,
      clientName: tokenInfo.client_name,
      clientId: tokenInfo.client_id.substring(0, 8) + '...'
    });
    
    next();
  } catch (error) {
    // Database or system error - fail closed (secure approach)
    logger.error('OAuth authentication error', { 
      error: error.message,
      path: req.path,
      method: req.method
    });
    
    // Return 503 to indicate temporary failure
    res.status(503).json({
      error: 'temporarily_unavailable',
      error_description: 'Authentication service temporarily unavailable'
    });
  }
};

module.exports = oauthMiddleware;