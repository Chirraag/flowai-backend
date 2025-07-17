const AuthService = require('../services/authService');
const logger = require('../utils/logger');

const authService = new AuthService();

const authMiddleware = async (req, res, next) => {
  try {
    logger.debug('Processing authentication');
    
    const providedToken = req.body.access_token || req.headers.authorization?.replace('Bearer ', '');
    
    // Handle empty string token by generating a new one
    const tokenToUse = (providedToken === '') ? null : providedToken;
    
    logger.debug('Token evaluation', {
      hasProvidedToken: !!providedToken,
      tokenLength: providedToken ? providedToken.length : 0,
      willGenerateNew: tokenToUse === null
    });
    
    const accessToken = await authService.getAccessToken(tokenToUse);
    
    req.accessToken = accessToken;
    
    // Remove access_token from body if it exists
    if (req.body.access_token) {
      delete req.body.access_token;
    }
    
    logger.info('Authentication successful');
    next();
  } catch (error) {
    logger.error('Authentication failed', { error: error.message });
    res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: error.message
    });
  }
};

module.exports = authMiddleware;