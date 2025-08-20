require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const swaggerJSDoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const { v4: uuidv4 } = require("uuid");

const logger = require("./utils/logger");
const errorHandler = require("./middleware/errorHandler");
const patientRoutes = require("./routes/patient");
const patientCreateRoutes = require("./routes/patientCreate");
const slotRoutes = require("./routes/slot");
const appointmentRoutes = require("./routes/appointment");
const retellWebhookRoutes = require("./routes/retellWebhook");
const redoxWebhookRoutes = require("./routes/redoxWebhook");
const retellAgentRoutes = require("./routes/retellAgent");
const documentReferenceRoutes = require("./routes/documentReference");
const oauthRoutes = require("./routes/oauth");
const callbackScheduler = require("./services/callbackScheduler");

const app = express();
const PORT = process.env.PORT || 3002;

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  logger.info(`Incoming request: ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    requestId: uuidv4(),
  });

  res.on("finish", () => {
    const duration = Date.now() - startTime;
    logger.info(`Request completed: ${req.method} ${req.path}`, {
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
  });

  next();
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Flow AI API",
      version: "1.0.0",
      description:
        "Redox FHIR services with simplified request/response format",
      contact: {
        name: "API Support",
        email: "support@example.com",
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: ["./routes/*.js"], // Path to the API docs
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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
app.get("/health", (req, res) => {
  logger.info("Health check requested");
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: "1.0.0",
  });
});

// API Routes
app.use("/api/v1/patient", patientRoutes);
app.use("/api/v1/patient", patientCreateRoutes);
app.use("/api/v1/slot", slotRoutes);
app.use("/api/v1/appointment", appointmentRoutes);
app.use("/api/v1/retell", retellWebhookRoutes);
app.use("/api/v1/retell/agent", retellAgentRoutes);
app.use("/api/v1/redox", redoxWebhookRoutes);
app.use("/api/v1/document-reference", documentReferenceRoutes);

// OAuth Routes (no prefix as per standard OAuth conventions)
app.use("/oauth", oauthRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use("*", (req, res) => {
  logger.warn("404 - Endpoint not found", {
    path: req.originalUrl,
    method: req.method,
  });
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: [
      "/health",
      "/api-docs",
      "/oauth/token",
      "/oauth/health",
      "/api/v1/patient/search",
      "/api/v1/patient/create",
      "/api/v1/patient/update",
      "/api/v1/slot/search",
      "/api/v1/appointment/create",
      "/api/v1/appointment/update",
      "/api/v1/appointment/search",
      "/api/v1/retell/webhook",
      "/api/v1/retell/function-call",
      "/api/v1/redox/webhook/scheduling",
      "/api/v1/redox/test/trigger-scheduling-call",
    ],
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Flow AI API running on port ${PORT}`);
  logger.info(`API Documentation: http://localhost:${PORT}/api-docs`);
  logger.info(`Health Check: http://localhost:${PORT}/health`);
  
  // Start the callback scheduler
  callbackScheduler.start();
  logger.info("Callback scheduler started");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  callbackScheduler.stop();
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received: closing HTTP server");
  callbackScheduler.stop();
  process.exit(0);
});

module.exports = app;
