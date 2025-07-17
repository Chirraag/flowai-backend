const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const RedoxTransformer = require('../utils/redoxTransformer');
const RedoxAPIService = require('../services/redoxApiService');
const AuthService = require('../services/authService');
const logger = require('../utils/logger');

const authService = new AuthService();

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
router.post('/webhook', async (req, res, next) => {
  try {
    // Log complete webhook request body
    logger.info('=== RETELL WEBHOOK RECEIVED ===', {
      requestBody: JSON.stringify(req.body, null, 2),
      headers: req.headers,
      timestamp: new Date().toISOString()
    });

    const { call_inbound } = req.body;
    
    if (!call_inbound || !call_inbound.from_number) {
      logger.warn('Retell webhook failed: missing call_inbound or from_number', {
        receivedBody: req.body
      });
      return res.status(400).json({
        success: false,
        error: 'Missing call_inbound.from_number in request'
      });
    }

    const { from_number } = call_inbound;
    logger.info('Retell webhook - call inbound processed', { 
      from_number,
      call_inbound: call_inbound 
    });

    // Get access token
    const accessToken = await authService.getAccessToken();

    // Search for patient by phone number
    const patientSearchParams = RedoxTransformer.createPatientSearchParams(from_number);
    const patientResponse = await RedoxAPIService.makeRequest(
      'POST',
      '/Patient/_search',
      null,
      patientSearchParams,
      accessToken
    );

    // Transform patient response
    const patients = RedoxTransformer.transformPatientSearchResponse(patientResponse);
    
    let appointments = [];
    let patientData = null;

    if (patients.length > 0) {
      patientData = {
        ...patients[0],
        accessToken: accessToken
      };

      // Search for appointments using patient ID
      const appointmentSearchParams = RedoxTransformer.createAppointmentSearchParams(patients[0].patientId);
      const appointmentResponse = await RedoxAPIService.makeRequest(
        'POST',
        '/Appointment/_search',
        null,
        appointmentSearchParams,
        accessToken
      );

      // Transform appointment response
      appointments = RedoxTransformer.transformAppointmentSearchResponse(appointmentResponse);
    }

    // Prepare response for Retell inbound call webhook format (all values must be strings)
    const dynamicVariables = {
      caller_phone: from_number,
      patient_found: patients.length > 0 ? "true" : "false",
      access_token: accessToken
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
      dynamicVariables.insurance_member_id = patientData.insuranceMemberId || "";
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
          timestamp: new Date().toISOString()
        }
      }
    };

    logger.info('Retell webhook completed', { 
      patientFound: patients.length > 0,
      appointmentFound: appointments.length > 0 
    });

    // Log complete webhook response
    logger.info('=== RETELL WEBHOOK RESPONSE ===', {
      responseBody: JSON.stringify(retellResponse, null, 2),
      timestamp: new Date().toISOString()
    });

    res.json(retellResponse);
  } catch (error) {
    logger.error('Retell webhook error', { error: error.message });
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
 *                 enum: [check_availability, book_appointment, update_appointment]
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
router.post('/function-call', async (req, res, next) => {
  try {
    // Log complete function call request body
    logger.info('=== RETELL FUNCTION CALL RECEIVED ===', {
      requestBody: JSON.stringify(req.body, null, 2),
      headers: req.headers,
      timestamp: new Date().toISOString()
    });

    const { call, name, args } = req.body;
    
    logger.info('Retell function call processed', { 
      functionName: name,
      hasArgs: !!args,
      hasCall: !!call,
      args: args,
      call: call
    });

    if (!name || !args) {
      logger.warn('Retell function call failed: missing name or args', {
        receivedBody: req.body
      });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name and args'
      });
    }

    // Get access token from args, call context, or generate new one
    const accessToken = args?.access_token || call?.access_token || await authService.getAccessToken();
    
    let result;

    switch (name) {
      case 'check_availability':
        logger.info('Processing check_availability function call');
        
        // Extract slot search parameters from args
        const { location, serviceType, startTime } = args;
        
        const slotSearchParams = RedoxTransformer.createSlotSearchParams(location, serviceType, startTime);
        const slotResponse = await RedoxAPIService.makeRequest(
          'POST',
          '/Slot/_search',
          null,
          slotSearchParams,
          accessToken
        );
        
        result = RedoxTransformer.transformSlotSearchResponse(slotResponse);
        break;

      case 'book_appointment':
        logger.info('Processing book_appointment function call');
        
        // Extract appointment creation parameters from args
        const { patientId, slotId, appointmentType, startTime: apptStart, endTime } = args;
        
        if (!patientId || !appointmentType || !apptStart || !endTime) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields for appointment booking: patientId, appointmentType, startTime, endTime'
          });
        }

        const appointmentBundle = RedoxTransformer.createAppointmentBundle(
          patientId, slotId, appointmentType, apptStart, endTime
        );
        
        const createResponse = await RedoxAPIService.makeRequest(
          'POST',
          '/Appointment/$appointment-create',
          appointmentBundle,
          null,
          accessToken
        );
        
        result = RedoxTransformer.transformAppointmentCreateResponse(createResponse);
        break;

      case 'update_appointment':
        logger.info('Processing update_appointment function call');
        
        // Extract appointment update parameters from args
        const { 
          appointmentId, 
          patientId: updatePatientId, 
          appointmentType: updateType, 
          startTime: updateStart, 
          endTime: updateEnd, 
          status 
        } = args;
        
        if (!appointmentId || !updatePatientId || !updateType || !updateStart || !updateEnd) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields for appointment update: appointmentId, patientId, appointmentType, startTime, endTime'
          });
        }

        const updateBundle = RedoxTransformer.createAppointmentUpdateBundle(
          appointmentId, updatePatientId, updateType, updateStart, updateEnd, status
        );
        
        const updateResponse = await RedoxAPIService.makeRequest(
          'POST',
          '/Appointment/$appointment-update',
          updateBundle,
          null,
          accessToken
        );
        
        result = RedoxTransformer.transformAppointmentCreateResponse(updateResponse);
        break;

      default:
        logger.warn('Unsupported function call received', { functionName: name });
        return res.status(400).json({
          success: false,
          error: `Unsupported function: ${name}`
        });
    }

    const functionResponse = {
      success: true,
      function: name,
      result: result
    };

    logger.info('Retell function call completed', { functionName: name });
    
    // Log complete function call response
    logger.info('=== RETELL FUNCTION CALL RESPONSE ===', {
      responseBody: JSON.stringify(functionResponse, null, 2),
      timestamp: new Date().toISOString()
    });

    res.json(functionResponse);

  } catch (error) {
    logger.error('Retell function call error', { error: error.message, functionName: name });
    next(error);
  }
});

module.exports = router;