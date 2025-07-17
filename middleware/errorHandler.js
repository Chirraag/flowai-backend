const logger = require('../utils/logger');

const errorHandler = (error, req, res, next) => {
  logger.error('Request error', {
    path: req.path,
    method: req.method,
    error: error.message,
    stack: error.stack
  });
  
  res.status(error.status || 500).json({
    success: false,
    error: error.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
};

module.exports = errorHandler;