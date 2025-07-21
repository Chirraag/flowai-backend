const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const redoxApiService = require('../services/redoxApiService');
const retellService = require('../services/retellService');
const { authenticate } = require('../middleware/auth');

/**
 * @swagger
 * components:
 *   schemas:
 *     TriggerSchedulingCallRequest:
 *       type: object
 *       required:
 *         - identifier
 *       properties:
 *         identifier:
 *           type: string
 *           description: Internal patient identifier (MR number)
 *           example: "PAT123456"
 *     
 *     TriggerSchedulingCallResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Scheduling event triggered successfully"
 *         identifier:
 *           type: string
 *           example: "PAT123456"
 */

/**
 * @swagger
 * tags:
 *   name: Redox Webhooks
 *   description: Redox webhook endpoints and test utilities
 */

/**
 * Webhook endpoint for Redox scheduling updates
 * Listens for appointment scheduling events and triggers outbound calls via Retell
 */
router.post('/webhook/scheduling', async (req, res) => {
  try {
    logger.info('Received Redox scheduling webhook', { 
      eventType: req.body.Meta?.EventType,
      source: req.body.Meta?.Source
    });

    const event = req.body;
    
    // Validate event structure
    if (!event.Patient || !event.Meta) {
      logger.error('Invalid webhook payload structure');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Extract patient identifiers from the event
    const patientIdentifiers = event.Patient.Identifiers || [];
    const internalPatientId = patientIdentifiers.find(id => id.Type === 'MR')?.ID;
    
    if (!internalPatientId) {
      logger.error('No internal patient identifier found in webhook');
      return res.status(400).json({ error: 'Patient identifier not found' });
    }

    // Process the scheduling event
    await processSchedulingEvent(event, internalPatientId);
    
    // Send acknowledgment to Redox
    res.status(200).json({ 
      message: 'Webhook received successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Error processing Redox scheduling webhook', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Process scheduling event and trigger outbound call
 */
async function processSchedulingEvent(event, internalPatientId) {
  try {
    // Search for patient using internal identifier
    const patientData = await searchPatientByIdentifier(internalPatientId);
    
    if (!patientData) {
      logger.error('Patient not found with identifier', { internalPatientId });
      return;
    }

    // Get appointment details for the patient
    const appointments = await redoxApiService.searchAppointments(
      patientData.patientId,
      patientData.accessToken
    );

    // Find the relevant appointment based on the event
    const appointment = findRelevantAppointment(appointments, event);

    // Prepare dynamic variables for Retell call
    const dynamicVariables = {
      // Event details
      event_type: event.Meta?.EventType || '',
      event_source: event.Meta?.Source || '',
      
      // Patient details
      patient_id: patientData.patientId || '',
      patient_name: patientData.fullName || '',
      patient_phone: patientData.phone || '',
      patient_email: patientData.email || '',
      patient_dob: patientData.dateOfBirth || '',
      patient_zip: patientData.zipCode || '',
      patient_address: patientData.address || '',
      insurance_name: patientData.insuranceName || '',
      insurance_type: patientData.insuranceType || 'PPO',
      insurance_member_id: patientData.insuranceMemberId || 'MEM123456789',
      
      // Appointment details
      appointment_id: appointment?.appointmentId || '',
      appointment_type: appointment?.appointmentType || '',
      appointment_start: appointment?.startTime || '',
      appointment_status: appointment?.status || '',
      appointment_description: appointment?.description || '',
      
      // Access token for subsequent calls
      access_token: patientData.accessToken || ''
    };

    // Trigger outbound call via Retell
    await retellService.createPhoneCall(patientData.phone, dynamicVariables);
    
    logger.info('Outbound call triggered successfully', {
      patientId: patientData.patientId,
      eventType: event.Meta?.EventType
    });

  } catch (error) {
    logger.error('Error processing scheduling event', error);
    throw error;
  }
}

/**
 * Search for patient using internal identifier
 */
async function searchPatientByIdentifier(identifier) {
  try {
    // First, get an access token for the search
    const tokenResponse = await redoxApiService.authenticate();
    const accessToken = tokenResponse.accessToken;

    // Search for patient using identifier
    const searchParams = {
      resourceType: 'Patient',
      identifier: identifier
    };

    const response = await redoxApiService.makeRequest(
      'GET',
      '/Patient',
      searchParams,
      accessToken
    );

    if (!response.entry || response.entry.length === 0) {
      return null;
    }

    // Transform FHIR patient to our format
    const fhirPatient = response.entry[0].resource;
    const transformedPatient = transformFhirPatient(fhirPatient);
    transformedPatient.accessToken = accessToken;
    
    return transformedPatient;

  } catch (error) {
    logger.error('Error searching patient by identifier', error);
    throw error;
  }
}

/**
 * Transform FHIR patient resource to our internal format
 */
function transformFhirPatient(fhirPatient) {
  const name = fhirPatient.name?.[0] || {};
  const telecom = fhirPatient.telecom || [];
  const address = fhirPatient.address?.[0] || {};
  
  const phone = telecom.find(t => t.system === 'phone')?.value || '';
  const email = telecom.find(t => t.system === 'email')?.value || '';
  
  return {
    patientId: fhirPatient.id,
    fullName: `${name.given?.join(' ') || ''} ${name.family || ''}`.trim(),
    phone: phone,
    email: email,
    dateOfBirth: fhirPatient.birthDate || '',
    zipCode: address.postalCode || '',
    address: `${address.line?.join(' ') || ''} ${address.city || ''} ${address.state || ''} ${address.postalCode || ''}`.trim(),
    insuranceName: 'Blue Cross Blue Shield',
    insuranceType: 'PPO',
    insuranceMemberId: 'MEM123456789'
  };
}

/**
 * Find relevant appointment from the event details
 */
function findRelevantAppointment(appointments, event) {
  if (!appointments || appointments.length === 0) {
    return null;
  }

  // If event contains appointment ID, find matching appointment
  if (event.Visit?.VisitNumber) {
    const appointment = appointments.find(apt => 
      apt.appointmentId === event.Visit.VisitNumber
    );
    if (appointment) return appointment;
  }

  // Otherwise return the most recent appointment
  return appointments[0];
}

/**
 * @swagger
 * /api/v1/redox/test/trigger-scheduling-call:
 *   post:
 *     summary: Trigger a test scheduling call for a patient
 *     description: Manually trigger an outbound call for a patient using their internal identifier
 *     tags: [Redox Webhooks]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TriggerSchedulingCallRequest'
 *     responses:
 *       200:
 *         description: Scheduling event triggered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TriggerSchedulingCallResponse'
 *       400:
 *         description: Bad request - missing identifier
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Internal server error
 */
router.post('/test/trigger-scheduling-call', authenticate, async (req, res) => {
  try {
    const { identifier } = req.body;
    
    if (!identifier) {
      return res.status(400).json({ error: 'Patient identifier is required' });
    }

    // Create a mock scheduling event
    const mockEvent = {
      Meta: {
        EventType: 'AppointmentBooked',
        Source: 'Test Trigger'
      },
      Patient: {
        Identifiers: [
          {
            Type: 'MR',
            ID: identifier
          }
        ]
      },
      Visit: {
        VisitNumber: 'TEST-' + Date.now()
      }
    };

    // Process the event
    await processSchedulingEvent(mockEvent, identifier);
    
    res.json({
      success: true,
      message: 'Scheduling event triggered successfully',
      identifier: identifier
    });

  } catch (error) {
    logger.error('Error triggering test scheduling event', error);
    res.status(500).json({ error: 'Failed to trigger scheduling event' });
  }
});

module.exports = router;