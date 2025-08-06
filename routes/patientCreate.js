const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const RedoxTransformer = require('../utils/redoxTransformer');
const RedoxAPIService = require('../services/redoxApiService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/v1/patient/update:
 *   post:
 *     summary: Update an existing patient
 *     tags: [Patient]
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
 *                 description: Patient ID to update
 *                 example: "patient-123"
 *               firstName:
 *                 type: string
 *                 description: Patient's first name
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 description: Patient's last name
 *                 example: "Doe"
 *               phone:
 *                 type: string
 *                 description: Patient's phone number
 *                 example: "+18330165712"
 *               email:
 *                 type: string
 *                 description: Patient's email address
 *                 example: "john.doe@example.com"
 *               birthDate:
 *                 type: string
 *                 format: date
 *                 description: Patient's birth date
 *                 example: "1990-01-15"
 *               gender:
 *                 type: string
 *                 enum: [male, female, other, unknown]
 *                 description: Patient's gender
 *                 example: "male"
 *               address:
 *                 type: string
 *                 description: Street address
 *                 example: "123 Main St"
 *               city:
 *                 type: string
 *                 description: City
 *                 example: "New York"
 *               state:
 *                 type: string
 *                 description: State
 *                 example: "NY"
 *               zipCode:
 *                 type: string
 *                 description: ZIP code
 *                 example: "10001"
 *               country:
 *                 type: string
 *                 description: Country
 *                 example: "US"
 *               insuranceName:
 *                 type: string
 *                 description: Insurance provider name
 *                 example: "Blue Cross"
 *               insuranceMemberId:
 *                 type: string
 *                 description: Insurance member ID
 *                 example: "INS123456789"
 *               medicalRecordNumber:
 *                 type: string
 *                 description: Medical record number
 *                 example: "MR123456"
 *               access_token:
 *                 type: string
 *                 description: Optional access token
 *                 example: ""
 *     responses:
 *       200:
 *         description: Patient updated successfully
 *       400:
 *         description: Missing required fields
 *       404:
 *         description: Patient not found
 */
router.post('/update', authMiddleware, async (req, res, next) => {
  try {
    const { 
      patientId,
      firstName, 
      lastName, 
      phone, 
      email, 
      birthDate, 
      gender, 
      address, 
      city, 
      state, 
      zipCode, 
      country, 
      insuranceName, 
      insuranceMemberId,
      medicalRecordNumber 
    } = req.body;
    
    logger.info('Patient update request', {
      patientId: patientId ? 'provided' : 'missing',
      firstName: firstName ? 'provided' : 'unchanged',
      lastName: lastName ? 'provided' : 'unchanged',
      phone: phone ? 'provided' : 'unchanged',
      email: email ? 'provided' : 'unchanged'
    });
    
    if (!patientId) {
      logger.warn('Patient update failed: missing patient ID');
      return res.status(400).json({
        success: false,
        error: 'Missing required field: patientId'
      });
    }

    const patientData = {
      patientId,
      firstName,
      lastName,
      phone,
      email,
      birthDate,
      gender,
      address,
      city,
      state,
      zipCode,
      country,
      insuranceName,
      insuranceMemberId,
      medicalRecordNumber
    };

    const patientBundle = RedoxTransformer.createPatientUpdateBundle(patientData);
    
    const redoxResponse = await RedoxAPIService.makeRequest(
      'POST',
      '/Patient/$patient-update',
      patientBundle,
      null,
      req.accessToken
    );

    // Transform the response to return simplified status
    const result = RedoxTransformer.transformAppointmentCreateResponse(redoxResponse);

    logger.info('Patient update completed', { 
      patientId: patientId,
      statusCode: result.statusCode, 
      success: result.success 
    });
    
    res.status(result.statusCode).json({
      success: result.success,
      data: result.success ? { 
        statusCode: result.statusCode,
        originalPatientId: patientId,
        ...(result.generatedId && { newPatientId: result.generatedId })
      } : { error: result.error }
    });
  } catch (error) {
    logger.error('Patient update error', { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/patient/create:
 *   post:
 *     summary: Create a new patient
 *     tags: [Patient]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *             properties:
 *               firstName:
 *                 type: string
 *                 description: Patient's first name
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 description: Patient's last name
 *                 example: "Doe"
 *               phone:
 *                 type: string
 *                 description: Patient's phone number
 *                 example: "+18330165712"
 *               email:
 *                 type: string
 *                 description: Patient's email address
 *                 example: "john.doe@example.com"
 *               birthDate:
 *                 type: string
 *                 format: date
 *                 description: Patient's birth date
 *                 example: "1990-01-15"
 *               gender:
 *                 type: string
 *                 enum: [male, female, other, unknown]
 *                 description: Patient's gender
 *                 example: "male"
 *               address:
 *                 type: string
 *                 description: Street address
 *                 example: "123 Main St"
 *               city:
 *                 type: string
 *                 description: City
 *                 example: "New York"
 *               state:
 *                 type: string
 *                 description: State
 *                 example: "NY"
 *               zipCode:
 *                 type: string
 *                 description: ZIP code
 *                 example: "10001"
 *               country:
 *                 type: string
 *                 description: Country
 *                 example: "US"
 *               insuranceName:
 *                 type: string
 *                 description: Insurance provider name
 *                 example: "Blue Cross"
 *               insuranceMemberId:
 *                 type: string
 *                 description: Insurance member ID
 *                 example: "INS123456789"
 *               medicalRecordNumber:
 *                 type: string
 *                 description: Medical record number
 *                 example: "MR123456"
 *               access_token:
 *                 type: string
 *                 description: Optional access token
 *                 example: ""
 *     responses:
 *       201:
 *         description: Patient created successfully
 *       400:
 *         description: Missing required fields
 */
router.post('/create', authMiddleware, async (req, res, next) => {
  try {
    const { 
      firstName, 
      lastName, 
      phone, 
      email, 
      birthDate, 
      gender, 
      address, 
      city, 
      state, 
      zipCode, 
      country, 
      insuranceName, 
      insuranceMemberId,
      medicalRecordNumber 
    } = req.body;
    
    logger.info('Patient creation request', {
      firstName: firstName ? 'provided' : 'missing',
      lastName: lastName ? 'provided' : 'missing',
      phone: phone ? 'provided' : 'optional',
      email: email ? 'provided' : 'optional',
      birthDate: birthDate ? 'provided' : 'optional',
      gender: gender ? 'provided' : 'optional'
    });
    
    if (!firstName || !lastName) {
      logger.warn('Patient creation failed: missing required fields');
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: firstName, lastName'
      });
    }

    const patientData = {
      firstName,
      lastName,
      phone,
      email,
      birthDate,
      gender,
      address,
      city,
      state,
      zipCode,
      country,
      insuranceName,
      insuranceMemberId,
      medicalRecordNumber
    };

    const patientBundle = RedoxTransformer.createPatientBundle(patientData);
    
    const redoxResponse = await RedoxAPIService.makeRequest(
      'POST',
      '/Patient/$patient-create',
      patientBundle,
      null,
      req.accessToken
    );

    // Transform the response to return simplified status
    const result = RedoxTransformer.transformAppointmentCreateResponse(redoxResponse);

    logger.info('Patient creation completed', { statusCode: result.statusCode, success: result.success });
    
    res.status(result.statusCode).json({
      success: result.success,
      data: result.success ? { 
        statusCode: result.statusCode,
        ...(result.generatedId && { patientId: result.generatedId })
      } : { error: result.error }
    });
  } catch (error) {
    logger.error('Patient creation error', { error: error.message });
    next(error);
  }
});

module.exports = router;