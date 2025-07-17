const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const RedoxTransformer = require('../utils/redoxTransformer');
const RedoxAPIService = require('../services/redoxApiService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/v1/retell/event:
 *   post:
 *     summary: Handle Retell AI events
 *     tags: [Retell AI]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - event
 *               - data
 *             properties:
 *               event:
 *                 type: string
 *                 enum: [patient_search, slot_search, appointment_create, appointment_update, patient_create, appointment_search]
 *                 description: Type of event
 *               data:
 *                 type: object
 *                 description: Event-specific data
 *               context:
 *                 type: object
 *                 description: Additional AI context
 *               access_token:
 *                 type: string
 *                 description: Optional access token
 *                 example: ""
 *     responses:
 *       200:
 *         description: Event processed successfully
 *       400:
 *         description: Invalid event or missing data
 */
router.post('/event', authMiddleware, async (req, res, next) => {
  try {
    const { event, data, context } = req.body;
    logger.info('Retell AI event received', { 
      event: event || 'missing',
      hasData: !!data,
      hasContext: !!context
    });
    
    if (!event || !data) {
      logger.warn('Retell AI event failed: missing required fields');
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: event and data'
      });
    }

    let result;
    
    switch (event) {
      case 'patient_search':
        logger.info('Processing patient search event');
        if (!data.phone) {
          logger.warn('Patient search event failed: missing phone number');
          return res.status(400).json({
            success: false,
            error: 'Missing phone number in data for patient search'
          });
        }
        
        const patientSearchParams = RedoxTransformer.createPatientSearchParams(data.phone);
        const patientResponse = await RedoxAPIService.makeRequest(
          'POST',
          '/Patient/_search',
          null,
          patientSearchParams,
          req.accessToken
        );
        
        // Transform the response to return simplified patient objects
        const patients = RedoxTransformer.transformPatientSearchResponse(patientResponse);
        
        // Add access token to each patient record
        result = patients.map(patient => ({
          ...patient,
          accessToken: req.accessToken
        }));
        break;
        
      case 'slot_search':
        logger.info('Processing slot search event');
        
        const slotSearchParams = RedoxTransformer.createSlotSearchParams(data.location, data.serviceType, data.startTime);
        const slotResponse = await RedoxAPIService.makeRequest(
          'POST',
          '/Slot/_search',
          null,
          slotSearchParams,
          req.accessToken
        );
        
        // Transform the response to return simplified slot objects
        result = RedoxTransformer.transformSlotSearchResponse(slotResponse);
        break;
        
      case 'appointment_create':
        logger.info('Processing appointment create event');
        const requiredFields = ['patientId', 'slotId', 'appointmentType', 'startTime', 'endTime'];
        const missingFields = requiredFields.filter(field => !data[field]);
        
        if (missingFields.length > 0) {
          logger.warn('Appointment create event failed: missing required fields', { missingFields });
          return res.status(400).json({
            success: false,
            error: `Missing required fields in data: ${missingFields.join(', ')}`
          });
        }
        
        const appointmentBundle = RedoxTransformer.createAppointmentBundle(
          data.patientId, data.slotId, data.appointmentType, data.startTime, data.endTime
        );
        
        const appointmentResponse = await RedoxAPIService.makeRequest(
          'POST',
          '/Appointment/$appointment-create',
          appointmentBundle,
          null,
          req.accessToken
        );
        
        // Transform the response to return simplified status
        result = RedoxTransformer.transformAppointmentCreateResponse(appointmentResponse);
        break;
        
      case 'appointment_update':
        logger.info('Processing appointment update event');
        const updateRequiredFields = ['appointmentId', 'patientId', 'appointmentType', 'startTime', 'endTime'];
        const updateMissingFields = updateRequiredFields.filter(field => !data[field]);
        
        if (updateMissingFields.length > 0) {
          logger.warn('Appointment update event failed: missing required fields', { updateMissingFields });
          return res.status(400).json({
            success: false,
            error: `Missing required fields in data: ${updateMissingFields.join(', ')}`
          });
        }
        
        const updateBundle = RedoxTransformer.createAppointmentUpdateBundle(
          data.appointmentId, data.patientId, data.appointmentType, data.startTime, data.endTime, data.status
        );
        
        const updateResponse = await RedoxAPIService.makeRequest(
          'POST',
          '/Appointment/$appointment-update',
          updateBundle,
          null,
          req.accessToken
        );
        
        result = RedoxTransformer.transformAppointmentCreateResponse(updateResponse);
        break;
        
      case 'patient_create':
        logger.info('Processing patient create event');
        const createRequiredFields = ['firstName', 'lastName'];
        const createMissingFields = createRequiredFields.filter(field => !data[field]);
        
        if (createMissingFields.length > 0) {
          logger.warn('Patient create event failed: missing required fields', { createMissingFields });
          return res.status(400).json({
            success: false,
            error: `Missing required fields in data: ${createMissingFields.join(', ')}`
          });
        }
        
        const patientBundle = RedoxTransformer.createPatientBundle(data);
        
        const createResponse = await RedoxAPIService.makeRequest(
          'POST',
          '/Patient/$patient-create',
          patientBundle,
          null,
          req.accessToken
        );
        
        result = RedoxTransformer.transformAppointmentCreateResponse(createResponse);
        break;
        
      case 'appointment_search':
        logger.info('Processing appointment search event');
        if (!data.patientId) {
          logger.warn('Appointment search event failed: missing patientId');
          return res.status(400).json({
            success: false,
            error: 'Missing patientId in data for appointment search'
          });
        }
        
        const appointmentSearchParams = RedoxTransformer.createAppointmentSearchParams(data.patientId);
        const appointmentSearchResponse = await RedoxAPIService.makeRequest(
          'POST',
          '/Appointment/_search',
          null,
          appointmentSearchParams,
          req.accessToken
        );
        
        // Transform the response to return latest appointment
        result = RedoxTransformer.transformAppointmentSearchResponse(appointmentSearchResponse);
        break;
        
      default:
        logger.warn('Unsupported event type received', { event });
        return res.status(400).json({
          success: false,
          error: `Unsupported event type: ${event}`
        });
    }

    logger.info('Retell AI event processed successfully', { event });
    res.json({
      success: true,
      event,
      data: result,
      context
    });
  } catch (error) {
    logger.error('Retell AI event processing error', { error: error.message });
    next(error);
  }
});

module.exports = router;