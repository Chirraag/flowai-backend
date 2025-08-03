const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const RedoxAPIService = require('../services/redoxApiService');
const RedoxTransformer = require('../utils/redoxTransformer');
const retellService = require('../services/retellService');
const AuthService = require('../services/authService');
const authenticate = require('../middleware/auth');

const authService = new AuthService();

/**
 * @swagger
 * components:
 *   schemas:
 *     TriggerSchedulingCallRequest:
 *       type: object
 *       required:
 *         - patientId
 *       properties:
 *         patientId:
 *           type: string
 *           description: Redox patient ID
 *           example: "65bee8d7-fee9-4e60-b9d6-1ae276b075b4"
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
 *         patientId:
 *           type: string
 *           example: "65bee8d7-fee9-4e60-b9d6-1ae276b075b4"
 */

/**
 * @swagger
 * tags:
 *   name: Redox Webhooks
 *   description: Redox webhook endpoints and test utilities
 */

/**
 * Webhook endpoint for Redox scheduling updates
 * Listens for service request events and triggers outbound calls via Retell
 */
router.post('/webhook/scheduling', async (req, res) => {
  try {
    logger.info('Received Redox scheduling webhook', { 
      eventType: req.body.Meta?.EventType,
      dataModel: req.body.Meta?.DataModel
    });

    const bundle = req.body;
    
    // Validate event structure
    if (!bundle.entry || !bundle.Meta || bundle.resourceType !== 'Bundle') {
      logger.error('Invalid webhook payload structure');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Extract patient resource from bundle
    const patientEntry = bundle.entry.find(e => 
      e.resource?.resourceType === 'Patient' || 
      e.fullUrl?.includes('/Patient/')
    );
    
    if (!patientEntry || !patientEntry.resource) {
      logger.error('No patient resource found in webhook');
      return res.status(400).json({ error: 'Patient resource not found' });
    }

    const patientResource = patientEntry.resource;
    const redoxPatientId = patientResource.id;
    
    if (!redoxPatientId) {
      logger.error('No patient ID found in patient resource');
      return res.status(400).json({ error: 'Patient ID not found' });
    }

    // Process the scheduling event
    await processSchedulingEvent(bundle, redoxPatientId, patientResource);
    
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
async function processSchedulingEvent(bundle, redoxPatientId, patientResource) {
  try {
    logger.info('=== PROCESS SCHEDULING EVENT START ===', {
      redoxPatientId,
      hasBundle: !!bundle,
      hasPatientResource: !!patientResource,
      bundleType: bundle?.type,
      timestamp: new Date().toISOString()
    });
    
    // Transform the patient resource to our format
    logger.info('Transforming FHIR patient to internal format');
    const patientData = transformFhirPatient(patientResource);
    patientData.patientId = redoxPatientId;
    
    logger.info('Patient data transformed', {
      patientId: patientData.patientId,
      fullName: patientData.fullName,
      hasPhone: !!patientData.phone,
      phone: patientData.phone ? 'provided' : 'missing'
    });
    
    // Get access token for subsequent API calls
    logger.info('Getting access token for appointment search');
    const accessToken = await authService.getAccessToken();
    patientData.accessToken = accessToken;
    logger.info('Access token obtained for appointment search');

    // Get appointment details for the patient
    let appointments = [];
    try {
      logger.info('Searching for patient appointments', { patientId: patientData.patientId });
      const searchParams = RedoxTransformer.createAppointmentSearchParams(patientData.patientId);
      logger.info('Appointment search params created', { searchParams });
      
      const appointmentResponse = await RedoxAPIService.makeRequest(
        'POST',
        '/Appointment/_search',
        null,
        searchParams,
        accessToken
      );
      
      logger.info('Appointment search response received', {
        hasResponse: !!appointmentResponse,
        hasEntry: !!appointmentResponse?.entry,
        entryCount: appointmentResponse?.entry?.length || 0
      });
      
      appointments = RedoxTransformer.transformAppointmentSearchResponse(appointmentResponse);
      logger.info('Appointments transformed', { appointmentCount: appointments.length });
    } catch (appointmentError) {
      logger.warn('Failed to fetch appointments', { 
        error: appointmentError.message,
        stack: appointmentError.stack,
        patientId: patientData.patientId
      });
    }

    // Find the relevant appointment based on the event
    const appointment = findRelevantAppointment(appointments, bundle);

    // Extract service request details from bundle
    const serviceRequestEntry = bundle.entry.find(e => 
      e.resource?.resourceType === 'ServiceRequest'
    );
    const serviceRequest = serviceRequestEntry?.resource || {};
    
    // Prepare dynamic variables for Retell call
    const dynamicVariables = {
      // Event details
      event_type: bundle.Meta?.EventType || '',
      event_data_model: bundle.Meta?.DataModel || '',
      service_request_id: serviceRequest.id || '',
      service_request_status: serviceRequest.status || '',
      service_request_intent: serviceRequest.intent || '',
      service_request_code: serviceRequest.code?.coding?.[0]?.display || '',
      
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

    // Validate phone number before triggering call
    logger.info('Validating patient phone number', {
      hasPhone: !!patientData.phone,
      phoneLength: patientData.phone ? patientData.phone.length : 0,
      phone: patientData.phone || 'NOT_PROVIDED'
    });
    
    if (!patientData.phone || patientData.phone.trim() === '') {
      logger.error('Cannot trigger call - no phone number found', {
        patientId: redoxPatientId,
        patientData: {
          fullName: patientData.fullName,
          phone: patientData.phone,
          email: patientData.email
        }
      });
      throw new Error('Patient phone number is required for outbound call');
    }

    // Trigger outbound call via Retell
    logger.info('Triggering outbound call via Retell', {
      phone: patientData.phone,
      variableCount: Object.keys(dynamicVariables).length,
      patientId: redoxPatientId
    });
    
    await retellService.createSchedulingCall(patientData.phone, dynamicVariables);
    
    logger.info('Outbound call triggered successfully', {
      patientId: redoxPatientId,
      eventType: bundle.Meta?.EventType
    });

  } catch (error) {
    logger.error('=== PROCESS SCHEDULING EVENT ERROR ===', {
      error: error.message,
      stack: error.stack,
      redoxPatientId,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}


/**
 * Transform FHIR patient resource to our internal format
 */
function transformFhirPatient(fhirPatient) {
  logger.info('=== TRANSFORM FHIR PATIENT START ===', {
    patientId: fhirPatient.id,
    hasName: !!fhirPatient.name,
    hasTelecom: !!fhirPatient.telecom,
    hasAddress: !!fhirPatient.address,
    nameCount: fhirPatient.name?.length || 0,
    telecomCount: fhirPatient.telecom?.length || 0,
    addressCount: fhirPatient.address?.length || 0
  });

  const name = fhirPatient.name?.[0] || {};
  const telecom = fhirPatient.telecom || [];
  const address = fhirPatient.address?.[0] || {};
  
  logger.info('FHIR patient parsing details', {
    nameFields: {
      given: name.given,
      family: name.family,
      use: name.use
    },
    telecomFields: telecom.map(t => ({ system: t.system, hasValue: !!t.value })),
    addressFields: {
      line: address.line,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode
    }
  });
  
  const phone = telecom.find(t => t.system === 'phone')?.value || '';
  const email = telecom.find(t => t.system === 'email')?.value || '';
  
  // Build full name and validate it's not empty
  const fullName = `${name.given?.join(' ') || ''} ${name.family || ''}`.trim();
  
  logger.info('Patient field extraction results', {
    phone: phone || 'NOT_FOUND',
    email: email || 'NOT_FOUND', 
    fullName: fullName || 'NOT_FOUND',
    patientId: fhirPatient.id
  });
  
  // Log warning if critical fields are missing
  if (!phone) {
    logger.warn('Patient missing phone number', { 
      patientId: fhirPatient.id,
      telecomEntries: telecom.length,
      telecomSystems: telecom.map(t => t.system)
    });
  }
  if (!fullName) {
    logger.warn('Patient missing name', { 
      patientId: fhirPatient.id,
      nameEntries: fhirPatient.name?.length || 0,
      nameStructure: fhirPatient.name
    });
  }
  
  return {
    patientId: fhirPatient.id,
    fullName: fullName || 'Unknown Patient',
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
function findRelevantAppointment(appointments, bundle) {
  if (!appointments || appointments.length === 0) {
    return null;
  }

  // Extract service request from bundle if available
  const serviceRequestEntry = bundle.entry.find(e => 
    e.resource?.resourceType === 'ServiceRequest'
  );
  
  if (serviceRequestEntry?.resource?.id) {
    // Try to find appointment related to this service request
    const appointment = appointments.find(apt => 
      apt.serviceRequestId === serviceRequestEntry.resource.id
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
 *     description: Manually trigger an outbound call for a patient using their Redox patient ID
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
 *         description: Bad request - missing patient ID
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Internal server error
 */
router.post('/test/trigger-scheduling-call', authenticate, async (req, res) => {
  try {
    logger.info('=== TRIGGER SCHEDULING CALL START ===', {
      requestBody: req.body,
      timestamp: new Date().toISOString()
    });
    
    const { patientId } = req.body;
    
    if (!patientId) {
      logger.warn('Trigger scheduling call failed: missing patientId', { requestBody: req.body });
      return res.status(400).json({ error: 'Patient ID is required' });
    }
    
    logger.info('Processing trigger scheduling call', { patientId });

    // Get patient details from Redox
    logger.info('Getting access token for patient lookup');
    const accessToken = await authService.getAccessToken();
    logger.info('Access token obtained, making patient lookup request', { patientId });
    
    const patientResponse = await RedoxAPIService.makeRequest(
      'GET',
      `/Patient/${patientId}`,
      null,
      null,
      accessToken
    );
    
    logger.info('Patient lookup response received', {
      hasResponse: !!patientResponse,
      hasId: !!patientResponse?.id,
      patientId: patientResponse?.id
    });

    if (!patientResponse || !patientResponse.id) {
      logger.error('Patient not found in Redox', {
        patientId,
        hasResponse: !!patientResponse,
        responseKeys: patientResponse ? Object.keys(patientResponse) : null
      });
      return res.status(404).json({ error: 'Patient not found' });
    }

    // Generate consistent test ID
    const testId = Date.now();
    logger.info('Creating mock service request bundle', { testId, patientId });
    
    // Create a mock service-request-created event bundle
    const mockBundle = {
      resourceType: 'Bundle',
      type: 'message',
      entry: [
        {
          resource: {
            eventUri: 'https://fhir.redoxengine.com/EventDefinition/ServiceRequestCreated',
            resourceType: 'MessageHeader',
            id: `test-${testId}`,
            source: {
              name: 'Test Trigger',
              endpoint: 'test-endpoint'
            },
            focus: [
              {
                reference: `ServiceRequest/test-${testId}`
              },
              {
                reference: `Patient/${patientId}`
              }
            ]
          }
        },
        {
          fullUrl: `https://fhir.redoxengine.com/fhir-sandbox/Patient/${patientId}`,
          resource: patientResponse
        },
        {
          fullUrl: `https://fhir.redoxengine.com/fhir-sandbox/ServiceRequest/test-${testId}`,
          resource: {
            resourceType: 'ServiceRequest',
            id: `test-${testId}`,
            status: 'active',
            intent: 'order',
            code: {
              coding: [
                {
                  code: 'TEST',
                  display: 'Test Service Request',
                  system: 'http://test.system'
                }
              ]
            },
            subject: {
              reference: `Patient/${patientId}`
            },
            authoredOn: new Date().toISOString()
          }
        }
      ],
      Meta: {
        DataModel: 'FHIR.Event.Order',
        EventType: 'service-request-created'
      }
    };

    // Process the event
    logger.info('Processing scheduling event with mock bundle', {
      patientId,
      bundleType: mockBundle.type,
      entryCount: mockBundle.entry.length
    });
    
    await processSchedulingEvent(mockBundle, patientId, patientResponse);
    
    logger.info('Scheduling event processed successfully');
    
    logger.info('=== TRIGGER SCHEDULING CALL SUCCESS ===', {
      patientId,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'Scheduling event triggered successfully',
      patientId: patientId
    });

  } catch (error) {
    logger.error('=== TRIGGER SCHEDULING CALL ERROR ===', {
      error: error.message,
      stack: error.stack,
      patientId: req.body?.patientId,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ 
      error: 'Failed to trigger scheduling event',
      details: error.message
    });
  }
});

module.exports = router;