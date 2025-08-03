const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const RedoxTransformer = require("../utils/redoxTransformer");
const RedoxAPIService = require("../services/redoxApiService");
const AuthService = require("../services/authService");
const logger = require("../utils/logger");
const db = require("../db/connection");
const { Resend } = require("resend");
const callIdStorage = require("../utils/callIdStorage");

const authService = new AuthService();

// Initialize Resend with API key
const resend = new Resend("re_RqyutRoZ_FzgFQ1SVV8qd7RAUmjX4o79B");

/**
 * @swagger
 * /api/v1/retell/webhook:
 *   post:
 *     summary: Handle Retell webhook events (call inbound)
 *     tags: [Retell Webhook]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               call_inbound:
 *                 type: object
 *                 properties:
 *                   from_number:
 *                     type: string
 *                     description: Caller's phone number
 *                     example: "+18330165712"
 *     responses:
 *       200:
 *         description: Patient and appointment data for call
 */
router.post("/webhook", async (req, res, next) => {
  try {
    // Log complete webhook request body
    logger.info("=== RETELL WEBHOOK RECEIVED ===", {
      requestBody: JSON.stringify(req.body, null, 2),
      headers: req.headers,
      timestamp: new Date().toISOString(),
    });

    const { call_inbound } = req.body;

    if (!call_inbound || !call_inbound.from_number) {
      logger.warn(
        "Retell webhook failed: missing call_inbound or from_number",
        {
          receivedBody: req.body,
        },
      );
      return res.status(400).json({
        success: false,
        error: "Missing call_inbound.from_number in request",
      });
    }

    const { from_number } = call_inbound;
    logger.info("Retell webhook - call inbound processed", {
      from_number,
      call_inbound: call_inbound,
    });

    // Get access token
    const accessToken = await authService.getAccessToken();

    // Search for patient by phone number
    const patientSearchParams =
      RedoxTransformer.createPatientSearchParams(from_number);
    const patientResponse = await RedoxAPIService.makeRequest(
      "POST",
      "/Patient/_search",
      null,
      patientSearchParams,
      accessToken,
    );

    // Transform patient response
    const patients =
      RedoxTransformer.transformPatientSearchResponse(patientResponse);

    let appointments = [];
    let patientData = null;

    if (patients.length > 0) {
      patientData = {
        ...patients[0],
        accessToken: accessToken,
      };

      // Search for appointments using patient ID
      const appointmentSearchParams =
        RedoxTransformer.createAppointmentSearchParams(patients[0].patientId);
      const appointmentResponse = await RedoxAPIService.makeRequest(
        "POST",
        "/Appointment/_search",
        null,
        appointmentSearchParams,
        accessToken,
      );

      // Transform appointment response
      appointments =
        RedoxTransformer.transformAppointmentSearchResponse(
          appointmentResponse,
        );
    }

    // Prepare response for Retell inbound call webhook format (all values must be strings)
    const dynamicVariables = {
      caller_phone: from_number,
      patient_found: patients.length > 0 ? "true" : "false",
      access_token: accessToken,
    };

    // Add individual patient details as separate dynamic variables (all as strings)
    if (patientData) {
      dynamicVariables.patient_id = patientData.patientId || "";
      dynamicVariables.patient_name = patientData.fullName || "";
      dynamicVariables.patient_phone = patientData.phone || "";
      dynamicVariables.patient_email = patientData.email || "";
      dynamicVariables.patient_dob = patientData.dateOfBirth || "";
      dynamicVariables.patient_zip = patientData.zipCode || "";
      dynamicVariables.patient_address = patientData.address || "";
      dynamicVariables.insurance_name = patientData.insuranceName || "";
      dynamicVariables.insurance_type = patientData.insuranceType || "";
      dynamicVariables.insurance_member_id =
        patientData.insuranceMemberId || "";
    }

    // Add appointment details as separate dynamic variables (all as strings)
    if (appointments.length > 0) {
      const appointment = appointments[0];
      dynamicVariables.appointment_id = appointment.appointmentId || "";
      dynamicVariables.appointment_type = appointment.appointmentType || "";
      dynamicVariables.appointment_start = appointment.startTime || "";
      dynamicVariables.appointment_status = appointment.status || "";
      dynamicVariables.appointment_description = appointment.description || "";
    }

    const retellResponse = {
      call_inbound: {
        dynamic_variables: dynamicVariables,
        metadata: {
          success: true,
          timestamp: new Date().toISOString(),
        },
      },
    };

    logger.info("Retell webhook completed", {
      patientFound: patients.length > 0,
      appointmentFound: appointments.length > 0,
    });

    // Log complete webhook response
    logger.info("=== RETELL WEBHOOK RESPONSE ===", {
      responseBody: JSON.stringify(retellResponse, null, 2),
      timestamp: new Date().toISOString(),
    });

    res.json(retellResponse);
  } catch (error) {
    logger.error("Retell webhook error", { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/retell/function-call:
 *   post:
 *     summary: Handle Retell function calls
 *     tags: [Retell Function Calls]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               call:
 *                 type: object
 *                 properties:
 *                   access_token:
 *                     type: string
 *                     description: Access token from call context
 *               name:
 *                 type: string
 *                 enum: [check_availability, book_appointment, update_appointment, create_patient]
 *                 description: Function name
 *               args:
 *                 type: object
 *                 description: Function arguments (may include access_token)
 *                 properties:
 *                   access_token:
 *                     type: string
 *                     description: Access token (can be in args or call context)
 *     responses:
 *       200:
 *         description: Function call result
 */
router.post("/function-call", async (req, res, next) => {
  try {
    // Log function call request body (excluding transcript and transcript_object for cleaner logs)
    const logBody = {
      ...req.body,
      call: req.body.call
        ? {
            ...req.body.call,
            transcript: req.body.call.transcript
              ? "[TRANSCRIPT OMITTED]"
              : undefined,
            transcript_object: req.body.call.transcript_object
              ? "[TRANSCRIPT OBJECT OMITTED]"
              : undefined,
            transcript_with_tool_calls: req.body.call.transcript_with_tool_calls
              ? "[TRANSCRIPT WITH TOOL CALLS OMITTED]"
              : undefined,
          }
        : undefined,
    };

    logger.info("=== RETELL FUNCTION CALL RECEIVED ===", {
      requestBody: JSON.stringify(logBody, null, 2),
      headers: req.headers,
      timestamp: new Date().toISOString(),
    });

    const { call, name, args } = req.body;

    logger.info("Retell function call processed", {
      functionName: name,
      hasArgs: !!args,
      hasCall: !!call,
      args: args,
      call: call
        ? {
            ...call,
            transcript: call.transcript ? "[TRANSCRIPT OMITTED]" : undefined,
            transcript_object: call.transcript_object
              ? "[TRANSCRIPT OBJECT OMITTED]"
              : undefined,
            transcript_with_tool_calls: req.body.call.transcript_with_tool_calls
              ? "[TRANSCRIPT WITH TOOL CALLS OMITTED]"
              : undefined,
          }
        : undefined,
    });

    if (!name || !args) {
      logger.warn("Retell function call failed: missing name or args", {
        receivedBody: req.body,
      });
      return res.status(400).json({
        success: false,
        error: "Missing required fields: name and args",
      });
    }

    // Get access token from args only, otherwise generate new one
    const accessToken =
      args?.access_token || (await authService.getAccessToken());

    let result;

    switch (name) {
      case "check_availability":
        logger.info("Processing check_availability function call");

        // Extract slot search parameters from args
        const { location, serviceType, startTime } = args;

        const slotSearchParams = RedoxTransformer.createSlotSearchParams(
          location,
          serviceType,
          startTime,
        );
        const slotResponse = await RedoxAPIService.makeRequest(
          "POST",
          "/Slot/_search",
          null,
          slotSearchParams,
          accessToken,
        );

        result = RedoxTransformer.transformSlotSearchResponse(slotResponse);
        break;

      case "book_appointment":
        logger.info("Processing book_appointment function call");

        // Extract appointment creation parameters from args
        const {
          patientId,
          slotId,
          appointmentType,
          startTime: apptStart,
          endTime,
          status,
        } = args;

        // Only patientId is required according to Redox (for participant reference)
        if (!patientId) {
          return res.status(400).json({
            success: false,
            error: "Missing required field for appointment booking: patientId",
          });
        }

        const appointmentBundle = RedoxTransformer.createAppointmentBundle(
          patientId,
          appointmentType,
          apptStart,
          endTime,
          status,
        );

        const createResponse = await RedoxAPIService.makeRequest(
          "POST",
          "/Appointment/$appointment-create",
          appointmentBundle,
          null,
          accessToken,
        );

        result =
          RedoxTransformer.transformAppointmentCreateResponse(createResponse);
        break;

      case "update_appointment":
        logger.info("Processing update_appointment function call");

        // Extract appointment update parameters from args
        const {
          appointmentId,
          patientId: updatePatientId,
          appointmentType: updateType,
          startTime: updateStart,
          endTime: updateEnd,
          status: updateStatus,
        } = args;

        // Only appointmentId and patientId are required for update
        if (!appointmentId || !updatePatientId) {
          return res.status(400).json({
            success: false,
            error:
              "Missing required fields for appointment update: appointmentId, patientId",
          });
        }

        const updateBundle = RedoxTransformer.createAppointmentUpdateBundle(
          appointmentId,
          updatePatientId,
          updateType,
          updateStart,
          updateEnd,
          updateStatus,
        );

        const updateResponse = await RedoxAPIService.makeRequest(
          "POST",
          "/Appointment/$appointment-update",
          updateBundle,
          null,
          accessToken,
        );

        result =
          RedoxTransformer.transformAppointmentCreateResponse(updateResponse);
        break;

      case "create_patient":
        logger.info("Processing create_patient function call");

        // Extract patient creation parameters from args
        const {
          first_name,
          last_name,
          phone: patientPhone,
          email: patientEmail,
          dob,
          address: patientAddress,
          city: patientCity,
          state: patientState,
          zip_code,
          insurance_name,
          insurance_member_id,
        } = args;

        // Validate required fields
        if (!first_name || !last_name) {
          return res.status(400).json({
            success: false,
            error:
              "Missing required fields for patient creation: first_name, last_name",
          });
        }

        const patientData = {
          firstName: first_name,
          lastName: last_name,
          phone: patientPhone,
          email: patientEmail,
          birthDate: dob,
          address: patientAddress,
          city: patientCity,
          state: patientState,
          zipCode: zip_code,
          insuranceName: insurance_name,
          insuranceMemberId: insurance_member_id,
        };

        const patientBundle = RedoxTransformer.createPatientBundle(patientData);

        const patientCreateResponse = await RedoxAPIService.makeRequest(
          "POST",
          "/Patient/$patient-create",
          patientBundle,
          null,
          accessToken,
        );

        // Transform the response to extract patient ID
        const createResult =
          RedoxTransformer.transformAppointmentCreateResponse(
            patientCreateResponse,
          );

        // Return the patient ID as the result
        result = {
          success: createResult.success,
          patientId: createResult.generatedId || null,
          statusCode: createResult.statusCode,
          error: createResult.error || null,
        };
        break;

      default:
        logger.warn("Unsupported function call received", {
          functionName: name,
        });
        return res.status(400).json({
          success: false,
          error: `Unsupported function: ${name}`,
        });
    }

    const functionResponse = {
      success: true,
      function: name,
      result: result,
    };

    logger.info("Retell function call completed", { functionName: name });

    // Log complete function call response
    logger.info("=== RETELL FUNCTION CALL RESPONSE ===", {
      responseBody: JSON.stringify(functionResponse, null, 2),
      timestamp: new Date().toISOString(),
    });

    res.json(functionResponse);
  } catch (error) {
    logger.error("Retell function call error", {
      error: error.message,
      functionName: req.body?.name || "unknown",
    });
    next(error);
  }
});

// Add this endpoint to your existing retellWebhook.js file, after the existing endpoints

/**
 * @swagger
 * /api/v1/retell/call/update:
 *   post:
 *     summary: Handle Retell call updates (stores data only for 'call_analyzed' events)
 *     tags: [Retell Call Updates]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - event
 *               - call
 *             properties:
 *               event:
 *                 type: string
 *                 description: The event type (only 'call_analyzed' events are stored in DB)
 *                 example: "call_analyzed"
 *               call:
 *                 type: object
 *                 description: Retell call data object
 *     responses:
 *       200:
 *         description: Call update processed successfully
 *       400:
 *         description: Invalid request - missing required fields
 *       500:
 *         description: Internal server error
 */
router.post("/call/update", async (req, res, next) => {
  try {
    console.log("hit");
    const { event, call } = req.body;

    // Only process if event is 'call_analyzed'
    if (event !== "call_analyzed") {
      return res.json({
        success: true,
        message: `Event ${event} acknowledged but not stored`,
      });
    }

    const recepientEmail = call.retell_llm_dynamic_variables.patient_email;

    const emailData = {
      from: "myflow@no-reply.vexalink.com",
      to: recepientEmail,
      subject: `Appointment Confirmation`,
      text: `Your appointment has been confirmed`,
    };

    // Send email using Resend
    const { data, error } = await resend.emails.send(emailData);

    if (!call || !call.call_id) {
      return res.status(400).json({
        success: false,
        error: "Missing call data or call_id",
      });
    }

    try {
      // Start a transaction to ensure data consistency
      await db.query("BEGIN");
      
      // 1. Check if this call_id already exists using in-memory storage (idempotency check)
      if (callIdStorage.hasBeenProcessed(call.call_id)) {
        await db.query("ROLLBACK");
        logger.info("Call already processed", { call_id: call.call_id });
        return res.json({
          success: true,
          message: "Call already processed",
          call_id: call.call_id,
        });
      }

      // Mark call as processed in memory
      callIdStorage.markAsProcessed(call.call_id);

      // 2. Insert into calls table
      const insertCallQuery = `
        INSERT INTO calls (call_id, body)
        VALUES ($1, $2)
      `;
      await db.query(insertCallQuery, [call.call_id, JSON.stringify(req.body)]);

      // 3. Get current agent analytics
      const agentResult = await db.query(
        "SELECT * FROM agents WHERE agent_id = $1",
        [call.agent_id],
      );

      // if (agentResult.rows.length === 0) {
      //   // If agent doesn't exist, create it with initial values
      //   const insertAgentQuery = `
      //     INSERT INTO agents (
      //       agent_id,
      //       user_id,
      //       type,
      //       status,
      //       total_calls,
      //       disconnection_reason,
      //       average_latency,
      //       user_sentiment,
      //       call_successful
      //     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      //   `;

      //   // Initialize JSON objects for tracking
      //   const disconnectionReason = { [call.disconnection_reason]: 1 };
      //   const userSentiment = { [call.call_analysis.user_sentiment]: 1 };
      //   const callSuccessful = { [String(call.call_analysis.call_successful)]: 1 };

      //   // Calculate initial average latency (using p50 values)
      //   const avgLatency = (call.latency.llm.p50 + call.latency.tts.p50) / 2;

      //   await db.query(insertAgentQuery, [
      //     call.agent_id,
      //     'xyz', // Default user_id
      //     'scheduling', // Default type
      //     'active', // Default status
      //     1, // total_calls
      //     JSON.stringify(disconnectionReason),
      //     avgLatency,
      //     JSON.stringify(userSentiment),
      //     JSON.stringify(callSuccessful)
      //   ]);
      // } else {
      //   // Update existing agent analytics
      //   const agent = agentResult.rows[0];

      //   // 4a. Increment total_calls
      //   const newTotalCalls = (agent.total_calls || 0) + 1;

      //   // 4b. Update disconnection_reason JSON
      //   let disconnectionReasonData = {};
      //   try {
      //     disconnectionReasonData = agent.disconnection_reason || {};
      //   } catch (e) {
      //     disconnectionReasonData = {};
      //   }
      //   disconnectionReasonData[call.disconnection_reason] = (disconnectionReasonData[call.disconnection_reason] || 0) + 1;

      //   // 4c. Recalculate average latency
      //   const currentAvgLatency = agent.average_latency || 0;
      //   const currentTotalCalls = agent.total_calls || 0;
      //   const newLatency = (call.latency.llm.p50 + call.latency.tts.p50) / 2;
      //   const newAvgLatency = ((currentAvgLatency * currentTotalCalls) + newLatency) / newTotalCalls;

      //   // 4d. Update user_sentiment JSON
      //   let userSentimentData = {};
      //   try {
      //     userSentimentData = agent.user_sentiment || {};
      //   } catch (e) {
      //     userSentimentData = {};
      //   }
      //   userSentimentData[call.call_analysis.user_sentiment] = (userSentimentData[call.call_analysis.user_sentiment] || 0) + 1;

      //   // 4e. Update call_successful JSON
      //   let callSuccessfulData = {};
      //   try {
      //     callSuccessfulData = agent.call_successful || {};
      //   } catch (e) {
      //     callSuccessfulData = {};
      //   }
      //   const successKey = String(call.call_analysis.call_successful);
      //   callSuccessfulData[successKey] = (callSuccessfulData[successKey] || 0) + 1;

      //   // Update the agent record
      //   const updateAgentQuery = `
      //     UPDATE agents
      //     SET
      //       total_calls = $2,
      //       disconnection_reason = $3,
      //       average_latency = $4,
      //       user_sentiment = $5,
      //       call_successful = $6,
      //       updated_at = CURRENT_TIMESTAMP
      //     WHERE agent_id = $1
      //   `;

      //   await db.query(updateAgentQuery, [
      //     call.agent_id,
      //     newTotalCalls,
      //     JSON.stringify(disconnectionReasonData),
      //     newAvgLatency,
      //     JSON.stringify(userSentimentData),
      //     JSON.stringify(callSuccessfulData)
      //   ]);
      // }

      // 3. Check if patient intake details exist in custom_analysis_data
      if (call.call_analysis?.custom_analysis_data?.patient_intake_details && call.retell_llm_dynamic_variables?.patient_id) {
        const patientIntakeDetails = call.call_analysis.custom_analysis_data.patient_intake_details;
        const patientId = call.retell_llm_dynamic_variables.patient_id;
        
        // Skip if intake details is empty or just whitespace
        if (!patientIntakeDetails || typeof patientIntakeDetails !== 'string' || !patientIntakeDetails.trim()) {
          logger.info('Skipping DocumentReference creation - patient intake details is empty', {
            call_id: call.call_id,
            patient_id: patientId
          });
        } else {
          // Create DocumentReference
          try {
            const accessToken = call.retell_llm_dynamic_variables?.access_token || await authService.getAccessToken();
            
            // Ensure the text has proper formatting (normalize newlines)
            const formattedIntakeDetails = patientIntakeDetails
              .replace(/\r\n/g, '\n')  // Convert Windows newlines
              .replace(/\r/g, '\n')    // Convert old Mac newlines
              .trim();                 // Remove leading/trailing whitespace
          
          const documentBundle = RedoxTransformer.createDocumentReferenceBundle(
            patientId,
            formattedIntakeDetails,
            {
              callId: call.call_id,
              agentId: call.agent_id,
              callTimestamp: new Date(call.start_timestamp).toISOString()
            }
          );
          
          const documentResponse = await RedoxAPIService.makeRequest(
            'POST',
            '/DocumentReference/$documentreference-create',
            documentBundle,
            null,
            accessToken
          );
          
          const documentResult = RedoxTransformer.transformAppointmentCreateResponse(documentResponse);
          
          logger.info('DocumentReference created for patient intake', {
            call_id: call.call_id,
            patient_id: patientId,
            document_id: documentResult.generatedId,
            success: documentResult.success
          });
        } catch (docError) {
          logger.error('Error creating DocumentReference', {
            call_id: call.call_id,
            patient_id: patientId,
            error: docError.message
          });
            // Continue processing even if document creation fails
          }
        }
      }

      // Commit the transaction
      await db.query("COMMIT");

      logger.info("Call analyzed event processed successfully", {
        call_id: call.call_id,
        agent_id: call.agent_id,
        disconnection_reason: call.disconnection_reason,
        user_sentiment: call.call_analysis.user_sentiment,
        call_successful: call.call_analysis.call_successful,
      });

      res.json({
        success: true,
        message: "Call analyzed event processed successfully",
        call_id: call.call_id,
        agent_id: call.agent_id,
      });
    } catch (dbError) {
      await db.query("ROLLBACK");
      logger.error("Database error processing call update", {
        call_id: call.call_id,
        error: dbError.message,
        stack: dbError.stack,
      });

      return res.status(500).json({
        success: false,
        error: "Failed to process call data",
        details: dbError.message,
      });
    }
  } catch (error) {
    logger.error("Call update endpoint error", {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/retell/call-storage/stats:
 *   get:
 *     summary: Get call ID storage statistics
 *     tags: [Retell Call Storage]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Storage statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 processedCallIds:
 *                   type: number
 *                   description: Number of call IDs currently stored
 *                 nextCleanup:
 *                   type: string
 *                   format: date-time
 *                   description: Next scheduled cleanup time (midnight PST)
 */
router.get('/call-storage/stats', authMiddleware, (req, res) => {
  const stats = callIdStorage.getStats();
  res.json({
    success: true,
    data: stats
  });
});

module.exports = router;
