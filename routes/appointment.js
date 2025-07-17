const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const RedoxTransformer = require('../utils/redoxTransformer');
const RedoxAPIService = require('../services/redoxApiService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/v1/appointment/create:
 *   post:
 *     summary: Create a new appointment
 *     tags: [Appointment]
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
 *                 description: Patient ID
 *                 example: "fd52c5ba-1f3d-4467-bcbf-2677b747ec9c"
 *               slotId:
 *                 type: string
 *                 description: Slot ID (optional)
 *                 example: "slot-123"
 *               appointmentType:
 *                 type: string
 *                 description: Type of appointment (optional)
 *                 example: "FOLLOWUP"
 *               startTime:
 *                 type: string
 *                 format: date-time
 *                 description: Appointment start time (optional)
 *                 example: "2025-01-22T14:00:00.000Z"
 *               endTime:
 *                 type: string
 *                 format: date-time
 *                 description: Appointment end time (optional)
 *                 example: "2025-01-22T14:30:00.000Z"
 *               status:
 *                 type: string
 *                 description: Appointment status (optional, defaults to 'proposed')
 *                 example: "proposed"
 *               access_token:
 *                 type: string
 *                 description: Optional access token
 *                 example: ""
 *     responses:
 *       201:
 *         description: Appointment created successfully
 *       400:
 *         description: Missing required field (patientId)
 */
router.post('/create', authMiddleware, async (req, res, next) => {
  try {
    const { patientId, slotId, appointmentType, startTime, endTime } = req.body;
    
    logger.info('Appointment creation request', {
      patientId: patientId ? 'provided' : 'missing',
      slotId: slotId ? 'provided' : 'missing',
      appointmentType: appointmentType ? 'provided' : 'missing',
      startTime: startTime ? 'provided' : 'missing',
      endTime: endTime ? 'provided' : 'missing'
    });
    
    // Only patientId is required according to Redox specs
    if (!patientId) {
      logger.warn('Appointment creation failed: missing required field');
      return res.status(400).json({
        success: false,
        error: 'Missing required field: patientId'
      });
    }

    const appointmentBundle = RedoxTransformer.createAppointmentBundle(
      patientId, slotId, appointmentType, startTime, endTime
    );
    
    const redoxResponse = await RedoxAPIService.makeRequest(
      'POST',
      '/Appointment/$appointment-create',
      appointmentBundle,
      null,
      req.accessToken
    );

    // Transform the response to return simplified status
    const result = RedoxTransformer.transformAppointmentCreateResponse(redoxResponse);

    logger.info('Appointment creation completed', { statusCode: result.statusCode, success: result.success });
    
    res.status(result.statusCode).json({
      success: result.success,
      data: result.success ? { 
        statusCode: result.statusCode,
        ...(result.generatedId && { appointmentId: result.generatedId })
      } : { error: result.error }
    });
  } catch (error) {
    logger.error('Appointment creation error', { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/appointment/update:
 *   post:
 *     summary: Update an existing appointment
 *     tags: [Appointment]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - appointmentId
 *               - patientId
 *               - appointmentType
 *               - startTime
 *               - endTime
 *             properties:
 *               appointmentId:
 *                 type: string
 *                 description: Appointment ID to update
 *                 example: "appointment-123"
 *               patientId:
 *                 type: string
 *                 description: Patient ID
 *                 example: "fd52c5ba-1f3d-4467-bcbf-2677b747ec9c"
 *               appointmentType:
 *                 type: string
 *                 description: Type of appointment
 *                 example: "FOLLOWUP"
 *               startTime:
 *                 type: string
 *                 format: date-time
 *                 description: Appointment start time
 *                 example: "2025-01-22T14:00:00.000Z"
 *               endTime:
 *                 type: string
 *                 format: date-time
 *                 description: Appointment end time
 *                 example: "2025-01-22T14:30:00.000Z"
 *               status:
 *                 type: string
 *                 description: Appointment status
 *                 example: "booked"
 *               access_token:
 *                 type: string
 *                 description: Optional access token
 *                 example: ""
 *     responses:
 *       200:
 *         description: Appointment updated successfully
 *       400:
 *         description: Missing required fields
 */
router.post('/update', authMiddleware, async (req, res, next) => {
  try {
    const { appointmentId, patientId, appointmentType, startTime, endTime, status } = req.body;
    
    logger.info('Appointment update request', {
      appointmentId: appointmentId ? 'provided' : 'missing',
      patientId: patientId ? 'provided' : 'missing',
      appointmentType: appointmentType ? 'provided' : 'missing',
      startTime: startTime ? 'provided' : 'missing',
      endTime: endTime ? 'provided' : 'missing',
      status: status || 'booked'
    });
    
    if (!appointmentId || !patientId || !appointmentType || !startTime || !endTime) {
      logger.warn('Appointment update failed: missing required fields');
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: appointmentId, patientId, appointmentType, startTime, endTime'
      });
    }

    const appointmentBundle = RedoxTransformer.createAppointmentUpdateBundle(
      appointmentId, patientId, appointmentType, startTime, endTime, status
    );
    
    const redoxResponse = await RedoxAPIService.makeRequest(
      'POST',
      '/Appointment/$appointment-update',
      appointmentBundle,
      null,
      req.accessToken
    );

    // Transform the response to return simplified status
    const result = RedoxTransformer.transformAppointmentCreateResponse(redoxResponse);

    logger.info('Appointment update completed', { statusCode: result.statusCode, success: result.success });
    
    res.status(result.statusCode).json({
      success: result.success,
      data: result.success ? { 
        statusCode: result.statusCode,
        ...(result.generatedId && { appointmentId: result.generatedId })
      } : { error: result.error }
    });
  } catch (error) {
    logger.error('Appointment update error', { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/appointment/search:
 *   post:
 *     summary: Search for appointments by patient ID
 *     tags: [Appointment]
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
 *                 description: Patient ID to search appointments for
 *                 example: "fd52c5ba-1f3d-4467-bcbf-2677b747ec9c"
 *               access_token:
 *                 type: string
 *                 description: Optional access token
 *                 example: ""
 *     responses:
 *       200:
 *         description: Latest appointment for the patient
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Authentication failed
 */
router.post('/search', authMiddleware, async (req, res, next) => {
  try {
    const { patientId } = req.body;
    logger.info('Appointment search request', { 
      patientId: patientId ? 'provided' : 'missing'
    });
    
    if (!patientId) {
      logger.warn('Appointment search failed: missing patient ID');
      return res.status(400).json({
        success: false,
        error: 'Missing required field: patientId'
      });
    }

    const searchParams = RedoxTransformer.createAppointmentSearchParams(patientId);
    const redoxResponse = await RedoxAPIService.makeRequest(
      'POST',
      '/Appointment/_search',
      null,
      searchParams,
      req.accessToken
    );

    // Transform the response to return latest appointment
    const appointments = RedoxTransformer.transformAppointmentSearchResponse(redoxResponse);

    logger.info('Appointment search completed successfully', { appointmentsFound: appointments.length });
    res.json({
      success: true,
      data: appointments
    });
  } catch (error) {
    logger.error('Appointment search error', { error: error.message });
    next(error);
  }
});

module.exports = router;