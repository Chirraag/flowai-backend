const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { v4: uuidv4 } = require('uuid');

const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const patientRoutes = require('./routes/patient');
const patientCreateRoutes = require('./routes/patientCreate');
const slotRoutes = require('./routes/slot');
const appointmentRoutes = require('./routes/appointment');
const retellWebhookRoutes = require('./routes/retellWebhook');

const app = express();
const PORT = process.env.PORT || 3002;

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  logger.info(`Incoming request: ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: uuidv4()
  });
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(`Request completed: ${req.method} ${req.path}`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });
  
  next();
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Redox API Wrapper',
      version: '1.0.0',
      description: 'A wrapper API for Redox FHIR services with simplified request/response format',
      contact: {
        name: 'API Support',
        email: 'support@example.com'
      }
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./routes/*.js'] // Path to the API docs
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: OK
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 */
app.get('/health', (req, res) => {
  logger.info('Health check requested');
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

// API Routes
app.use('/api/v1/patient', patientRoutes);
app.use('/api/v1/patient', patientCreateRoutes);
app.use('/api/v1/slot', slotRoutes);
app.use('/api/v1/appointment', appointmentRoutes);
app.use('/api/v1/retell', retellWebhookRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  logger.warn('404 - Endpoint not found', { path: req.originalUrl, method: req.method });
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: [
      '/health',
      '/api-docs',
      '/api/v1/patient/search',
      '/api/v1/patient/create',
      '/api/v1/slot/search',
      '/api/v1/appointment/create',
      '/api/v1/appointment/update',
      '/api/v1/appointment/search',
      '/api/v1/retell/webhook',
      '/api/v1/retell/function-call'
    ]
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Redox API Wrapper running on port ${PORT}`);
  logger.info(`API Documentation: http://localhost:${PORT}/api-docs`);
  logger.info(`Health Check: http://localhost:${PORT}/health`);
});

module.exports = app;