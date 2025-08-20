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
      dynamicVariables.patient_insurance_name = patientData.insuranceName || "";
      dynamicVariables.insurance_type = patientData.insuranceType || "";
      dynamicVariables.patient_insurance_member_id =
        patientData.insuranceMemberId || "";
    }

    // Add appointment details as separate dynamic variables (all as strings)
    if (appointments.length > 0) {
      const appointment = appointments[0];
      dynamicVariables.patient_appointment_id = appointment.appointmentId || "";
      dynamicVariables.patient_appointment_type = appointment.appointmentType || "";
      dynamicVariables.appointment_start = appointment.startTime || "";
      dynamicVariables.patient_appointment_status = appointment.status || "";
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
 *                 enum: [check_availability, book_appointment, update_appointment, create_patient, find_patient]
 *                 description: Function name
 *               args:
 *                 type: object
 *                 description: Function arguments (may include access_token)
 *                 properties:
 *                   access_token:
 *                     type: string
 *                     description: Access token (can be in args or call context)
 *                   birth_date:
 *                     type: string
 *                     description: Patient's date of birth (for find_patient)
 *                   given:
 *                     type: string
 *                     description: Patient's first name (for find_patient)
 *                   family:
 *                     type: string
 *                     description: Patient's last name (for find_patient)
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

      case "find_patient": {
        logger.info("Processing find_patient function call");

        // Extract patient search parameters from args
        const { birth_date, given, family } = args;

        // Validate required fields
        if (!birth_date || !given || !family) {
          logger.warn("find_patient failed: missing required fields", {
            birth_date,
            given,
            family,
          });
          return res.status(400).json({
            success: false,
            error: "Missing required fields: birth_date, given, and family are required",
          });
        }

        // Create search parameters
        const searchParams = RedoxTransformer.createPatientSearchByDobNameParams(
          birth_date,
          given,
          family,
        );

        // Execute patient search through Redox API
        const searchResponse = await RedoxAPIService.makeRequest(
          "POST",
          "/Patient/_search",
          null,
          searchParams,
          accessToken
        );

        // Check if patient found
        if (!searchResponse || !searchResponse.entry || searchResponse.entry.length === 0) {
          logger.info("No patient found", {
            birth_date,
            given,
            family,
          });
          
          result = {
            success: true,
            patient_found: false,
            patient: null
          };
          break;
        }

        // Get the first patient's ID for appointment search
        const firstPatientEntry = searchResponse.entry.find(
          (entry) => entry.resource && entry.resource.resourceType === "Patient"
        );
        const patientId = firstPatientEntry?.resource?.id;

        let appointmentResponse = null;
        
        // Search for appointments if patient found
        if (patientId) {
          try {
            const appointmentSearchParams = RedoxTransformer.createAppointmentSearchParams(patientId);
            appointmentResponse = await RedoxAPIService.makeRequest(
              "POST",
              "/Appointment/_search",
              null,
              appointmentSearchParams,
              accessToken
            );
          } catch (appointmentError) {
            logger.warn("Failed to fetch appointments for patient", {
              error: appointmentError.message,
              patientId,
            });
            // Continue even if appointment fetch fails
          }
        }

        // Transform patient and appointment data into the required format
        const patientData = RedoxTransformer.transformPatientWithAppointmentDetails(
          searchResponse,
          appointmentResponse
        );

        logger.info("Patient search by DOB and name completed", {
          patientFound: patientData !== null,
          birth_date,
          given,
          family,
        });

        // Return the patient data
        result = {
          success: true,
          patient_found: patientData !== null,
          patient: patientData
        };
        break;
      }

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
      if (
        call.call_analysis?.custom_analysis_data?.patient_intake_details &&
        call.retell_llm_dynamic_variables?.patient_id
      ) {
        const patientIntakeDetails =
          call.call_analysis.custom_analysis_data.patient_intake_details;
        const patientId = call.retell_llm_dynamic_variables.patient_id;

        // Skip if intake details is empty or just whitespace
        if (
          !patientIntakeDetails ||
          typeof patientIntakeDetails !== "string" ||
          !patientIntakeDetails.trim()
        ) {
          logger.info(
            "Skipping DocumentReference creation - patient intake details is empty",
            {
              call_id: call.call_id,
              patient_id: patientId,
            },
          );
        } else {
          // Create DocumentReference
          try {
            const accessToken =
              call.retell_llm_dynamic_variables?.access_token ||
              (await authService.getAccessToken());

            // Ensure the text has proper formatting (normalize newlines)
            const formattedIntakeDetails = patientIntakeDetails
              .replace(/\r\n/g, "\n") // Convert Windows newlines
              .replace(/\r/g, "\n") // Convert old Mac newlines
              .trim(); // Remove leading/trailing whitespace

            // Log details for comparison with Swagger flow
            logger.info("=== RETELL DOCUMENT CREATION DEBUG ===", {
              call_id: call.call_id,
              patient_id: patientId,
              content_type: typeof formattedIntakeDetails,
              content_length: formattedIntakeDetails.length,
              content_preview: formattedIntakeDetails.substring(0, 100),
              has_access_token: !!accessToken,
              access_token_source: call.retell_llm_dynamic_variables
                ?.access_token
                ? "retell_variables"
                : "auth_service",
              metadata: {
                callId: call.call_id,
                agentId: call.agent_id,
                callTimestamp: new Date(call.start_timestamp).toISOString(),
              },
            });

            const documentBundle =
              RedoxTransformer.createDocumentReferenceBundle(
                patientId,
                formattedIntakeDetails,
                {
                  callId: call.call_id,
                  agentId: call.agent_id,
                  callTimestamp: new Date(call.start_timestamp).toISOString(),
                },
              );

            logger.info("=== RETELL BUNDLE STRUCTURE ===", {
              call_id: call.call_id,
              bundle_type: documentBundle.resourceType,
              bundle_entries: documentBundle.entry?.length,
              message_header_id: documentBundle.entry?.[0]?.resource?.id,
              document_id: documentBundle.entry?.[1]?.resource?.id,
              bundle_json: JSON.stringify(documentBundle, null, 2),
            });

            const documentResponse = await RedoxAPIService.makeRequest(
              "POST",
              "/DocumentReference/$documentreference-create",
              documentBundle,
              null,
              accessToken,
            );

            const documentResult =
              RedoxTransformer.transformAppointmentCreateResponse(
                documentResponse,
              );

            logger.info("DocumentReference created for patient intake", {
              call_id: call.call_id,
              patient_id: patientId,
              document_id: documentResult.generatedId,
              success: documentResult.success,
            });
          } catch (docError) {
            logger.error("Error creating DocumentReference", {
              call_id: call.call_id,
              patient_id: patientId,
              error: docError.message,
            });
            // Continue processing even if document creation fails
          }
        }
      }

      // 4. Check for transfer attempts and scheduled callbacks
      const isTransferAttempted = call.call_analysis?.custom_analysis_data?.is_transfer_attempted;
      const scheduledCallbackTime = call.call_analysis?.custom_analysis_data?.scheduled_callback_time;
      const patientId = call.retell_llm_dynamic_variables?.patient_id;

      if (scheduledCallbackTime && patientId) {
        // Determine agent callback number from call numbers
        const agentNumbers = ['+16018846979', '+14088728200'];
        let agentCallbackNumber = null;
        
        if (agentNumbers.includes(call.to_number)) {
          agentCallbackNumber = call.to_number;
        } else if (agentNumbers.includes(call.from_number)) {
          agentCallbackNumber = call.from_number;
        }

        if (!agentCallbackNumber) {
          logger.warn("Cannot determine agent callback number - skipping callback processing", {
            call_id: call.call_id,
            to_number: call.to_number,
            from_number: call.from_number,
          });
        } else {
          logger.info("Processing callback request", {
            call_id: call.call_id,
            is_transfer_attempted: isTransferAttempted,
            scheduled_callback_time: scheduledCallbackTime,
            agent_callback_number: agentCallbackNumber,
            patient_id: patientId,
          });

          if (isTransferAttempted === "true" || isTransferAttempted === true) {
            // Create DocumentReference for transfer attempt
            try {
              const accessToken =
                call.retell_llm_dynamic_variables?.access_token ||
                (await authService.getAccessToken());

              const transferMessage = `Patient requested callback from human agent at ${scheduledCallbackTime}`;

              const documentBundle =
                RedoxTransformer.createDocumentReferenceBundle(
                  patientId,
                  transferMessage,
                  {
                    callId: call.call_id,
                    agentId: call.agent_id,
                    callTimestamp: new Date(call.start_timestamp).toISOString(),
                    transferAttempted: true,
                    scheduledCallbackTime: scheduledCallbackTime,
                  },
                );

              const documentResponse = await RedoxAPIService.makeRequest(
                "POST",
                "/DocumentReference/$documentreference-create",
                documentBundle,
                null,
                accessToken,
              );

              const documentResult =
                RedoxTransformer.transformAppointmentCreateResponse(
                  documentResponse,
                );

              logger.info("DocumentReference created for transfer attempt", {
                call_id: call.call_id,
                patient_id: patientId,
                document_id: documentResult.generatedId,
                scheduled_callback_time: scheduledCallbackTime,
              });
            } catch (docError) {
              logger.error("Error creating DocumentReference for transfer attempt", {
                call_id: call.call_id,
                patient_id: patientId,
                error: docError.message,
              });
            }
          } else {
            // is_transfer_attempted is false, store in scheduled_callbacks table
            try {
              const insertCallbackQuery = `
                INSERT INTO scheduled_callbacks (
                  patient_id,
                  agent_callback_number,
                  scheduled_time,
                  status
                ) VALUES ($1, $2, $3, 'pending')
              `;

              await db.query(insertCallbackQuery, [
                patientId,
                agentCallbackNumber,
                scheduledCallbackTime,
              ]);

              logger.info("Scheduled callback stored in database", {
                call_id: call.call_id,
                patient_id: patientId,
                agent_callback_number: agentCallbackNumber,
                scheduled_time: scheduledCallbackTime,
              });
            } catch (dbError) {
              logger.error("Error storing scheduled callback", {
                call_id: call.call_id,
                patient_id: patientId,
                error: dbError.message,
              });
            }
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
 * /api/v1/retell/trigger-intake-call:
 *   post:
 *     summary: Trigger an intake call for a patient
 *     tags: [Retell Outbound Calls]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - patientId
 *             properties:
 *               patientId:
 *                 type: string
 *                 description: Redox patient ID
 *                 example: "65bee8d7-fee9-4e60-b9d6-1ae276b075b4"
 *     responses:
 *       200:
 *         description: Call triggered successfully
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
 *                     callId:
 *                       type: string
 *                     status:
 *                       type: string
 *                     message:
 *                       type: string
 *                     patientId:
 *                       type: string
 *       400:
 *         description: Bad request - missing patient ID
 *       404:
 *         description: Patient not found
 *       500:
 *         description: Internal server error
 */
router.post("/trigger-intake-call", authMiddleware, async (req, res, next) => {
  try {
    const retellService = require("../services/retellService");
    const { patientId } = req.body;

    if (!patientId) {
      logger.warn("Trigger intake call failed: missing patientId");
      return res.status(400).json({
        success: false,
        error: "Patient ID is required",
      });
    }

    logger.info("Triggering intake call", { patientId });

    // Get access token
    const accessToken = await authService.getAccessToken();

    // Get patient details from Redox
    logger.info("Fetching patient details from Redox", { patientId });

    const patientResponse = await RedoxAPIService.makeRequest(
      "GET",
      `/Patient/${patientId}`,
      null,
      null,
      accessToken,
    );

    if (!patientResponse || !patientResponse.id) {
      logger.error("Patient not found in Redox", { patientId });
      return res.status(404).json({
        success: false,
        error: "Patient not found",
      });
    }

    // Transform patient data
    const patientData = RedoxTransformer.transformPatientSearchResponse({
      entry: [{ resource: patientResponse }],
    })[0];

    if (!patientData.phone) {
      logger.error("Cannot trigger intake call - no phone number found", {
        patientId,
        patientName: patientData.fullName,
      });
      return res.status(400).json({
        success: false,
        error: "Patient phone number is required for outbound call",
      });
    }

    // Search for appointments
    let appointments = [];
    try {
      const appointmentSearchParams =
        RedoxTransformer.createAppointmentSearchParams(patientId);
      const appointmentResponse = await RedoxAPIService.makeRequest(
        "POST",
        "/Appointment/_search",
        null,
        appointmentSearchParams,
        accessToken,
      );
      appointments =
        RedoxTransformer.transformAppointmentSearchResponse(
          appointmentResponse,
        );
    } catch (appointmentError) {
      logger.warn("Failed to fetch appointments for intake call", {
        error: appointmentError.message,
        patientId,
      });
    }

    // Get the most recent appointment
    const appointment = appointments.length > 0 ? appointments[0] : null;

    // Prepare dynamic variables for the intake agent
    const dynamicVariables = {
      // Call context
      call_type: "intake",
      access_token: accessToken,

      // Patient details
      patient_id: patientId,
      patient_name: patientData.fullName || "",
      patient_phone: patientData.phone || "",
      patient_email: patientData.email || "",
      patient_dob: patientData.dateOfBirth || "",
      patient_zip: patientData.zipCode || "",
      patient_address: patientData.address || "",
      patient_insurance_name: patientData.insuranceName || "",
      insurance_type: patientData.insuranceType || "",
      patient_insurance_member_id: patientData.insuranceMemberId || "",

      // Appointment details if available
      patient_appointment_id: appointment?.appointmentId || "",
      patient_appointment_type: appointment?.appointmentType || "",
      appointment_start: appointment?.startTime || "",
      patient_appointment_status: appointment?.status || "",
      appointment_description: appointment?.description || "",
    };

    // Use the new intake-specific method
    const callResponse = await retellService.createIntakeCall(
      patientData.phone,
      dynamicVariables,
    );

    logger.info("Intake call created successfully", {
      callId: callResponse.call_id,
      status: callResponse.status,
      patientId: patientId,
    });

    res.json({
      success: true,
      data: {
        callId: callResponse.call_id,
        status: callResponse.status,
        message: "Intake call triggered successfully",
        patientId: patientId,
      },
    });
  } catch (error) {
    logger.error("Error triggering intake call", {
      error: error.message,
      patientId: req.body?.patientId,
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
router.get("/call-storage/stats", authMiddleware, (req, res) => {
  const stats = callIdStorage.getStats();
  res.json({
    success: true,
    data: stats,
  });
});

/**
 * @swagger
 * /api/v1/retell/callbacks/stats:
 *   get:
 *     summary: Get scheduled callbacks statistics
 *     tags: [Retell Callbacks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Callback statistics
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
 *                     pending:
 *                       type: number
 *                       description: Number of pending callbacks
 *                     completed:
 *                       type: number
 *                       description: Number of completed callbacks
 *                     failed:
 *                       type: number
 *                       description: Number of failed callbacks
 *                     upcomingInNext5Minutes:
 *                       type: number
 *                       description: Number of callbacks scheduled in next 5 minutes
 */
router.get("/callbacks/stats", authMiddleware, async (req, res, next) => {
  try {
    const callbackScheduler = require("../services/callbackScheduler");
    const stats = await callbackScheduler.getStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error fetching callback stats", { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/retell/callbacks/scheduler/status:
 *   get:
 *     summary: Get callback scheduler status
 *     tags: [Retell Callbacks]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Scheduler status
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
 *                     running:
 *                       type: boolean
 *                       description: Whether the scheduler is running
 *                     processing:
 *                       type: boolean
 *                       description: Whether callbacks are currently being processed
 *                     intervalMinutes:
 *                       type: number
 *                       description: Interval in minutes between processing runs
 */
router.get("/callbacks/scheduler/status", authMiddleware, (req, res) => {
  const callbackScheduler = require("../services/callbackScheduler");
  const status = callbackScheduler.getStatus();
  res.json({
    success: true,
    data: status,
  });
});

/**
 * @swagger
 * /api/v1/retell/callbacks/list:
 *   get:
 *     summary: List scheduled callbacks
 *     tags: [Retell Callbacks]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed]
 *         description: Filter by status
 *       - in: query
 *         name: patient_id
 *         schema:
 *           type: string
 *         description: Filter by patient ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of results
 *     responses:
 *       200:
 *         description: List of scheduled callbacks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       patient_id:
 *                         type: string
 *                       agent_callback_number:
 *                         type: string
 *                       scheduled_time:
 *                         type: string
 *                         format: date-time
 *                       status:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *                       processed_at:
 *                         type: string
 *                         format: date-time
 *                       error_message:
 *                         type: string
 */
router.get("/callbacks/list", authMiddleware, async (req, res, next) => {
  try {
    const { status, patient_id, limit = 100 } = req.query;
    
    let query = "SELECT * FROM scheduled_callbacks WHERE 1=1";
    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }

    if (patient_id) {
      paramCount++;
      query += ` AND patient_id = $${paramCount}`;
      params.push(patient_id);
    }

    query += ` ORDER BY scheduled_time DESC LIMIT $${paramCount + 1}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    logger.error("Error listing callbacks", { error: error.message });
    next(error);
  }
});

module.exports = router;
