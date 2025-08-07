const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const RedoxTransformer = require('../utils/redoxTransformer');
const RedoxAPIService = require('../services/redoxApiService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/v1/patient/search:
 *   post:
 *     summary: Search for patients by phone number
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
 *               - phone
 *             properties:
 *               phone:
 *                 type: string
 *                 description: Patient's phone number
 *                 example: "+18330165712"
 *               access_token:
 *                 type: string
 *                 description: Optional access token (can also be in Authorization header)
 *                 example: ""
 *     responses:
 *       200:
 *         description: Patient search results
 *       401:
 *         description: Authentication failed
 *       500:
 *         description: Server error
 */
router.post('/search', authMiddleware, async (req, res, next) => {
  try {
    const { phone } = req.body;
    logger.info('Patient search request', { phone: phone ? 'provided' : 'missing' });
    
    if (!phone) {
      logger.warn('Patient search failed: missing phone number');
      return res.status(400).json({
        success: false,
        error: 'Missing required field: phone'
      });
    }

    const searchParams = RedoxTransformer.createPatientSearchParams(phone);
    const redoxResponse = await RedoxAPIService.makeRequest(
      'POST',
      '/Patient/_search',
      null,
      searchParams,
      req.accessToken
    );

    // Transform the response to return simplified patient objects
    const patients = RedoxTransformer.transformPatientSearchResponse(redoxResponse);
    
    // Add access token to each patient record
    const patientsWithToken = patients.map(patient => ({
      ...patient,
      accessToken: req.accessToken
    }));

    logger.info('Patient search completed successfully', { patientsFound: patients.length });
    res.json({
      success: true,
      data: patientsWithToken
    });
  } catch (error) {
    logger.error('Patient search error', { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/patient/search-by-dob-zip:
 *   post:
 *     summary: Search for patients by date of birth and zipcode
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
 *               - birth_date
 *               - zip_code
 *             properties:
 *               birth_date:
 *                 type: string
 *                 format: date
 *                 description: Patient's date of birth (YYYY-MM-DD)
 *                 example: "1982-10-01"
 *               zip_code:
 *                 type: string
 *                 description: Patient's zip code
 *                 example: "33056"
 *               access_token:
 *                 type: string
 *                 description: Optional access token (can also be in Authorization header)
 *                 example: ""
 *     responses:
 *       200:
 *         description: Patient search results with simplified data (patient_id and patient_name only)
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Authentication failed
 *       500:
 *         description: Server error
 */
router.post('/search-by-dob-zip', authMiddleware, async (req, res, next) => {
  try {
    const { birth_date, zip_code } = req.body;
    logger.info('Patient search by DOB and zip request', { 
      birth_date: birth_date ? 'provided' : 'missing',
      zip_code: zip_code ? 'provided' : 'missing'
    });
    
    if (!birth_date || !zip_code) {
      logger.warn('Patient search failed: missing required fields', { birth_date, zip_code });
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: birth_date and zip_code are required'
      });
    }
    
    // Create search parameters
    const searchParams = RedoxTransformer.createPatientSearchByDobZipParams(birth_date, zip_code);
    
    // Execute patient search through Redox API
    const redoxService = new RedoxAPIService(req.accessToken);
    const searchResponse = await redoxService.searchPatient(searchParams);
    
    // Transform response to get simplified patient list
    const patients = RedoxTransformer.transformPatientSearchByDobZipResponse(searchResponse);
    
    logger.info('Patient search by DOB and zip completed successfully', { 
      patientsFound: patients.length,
      birth_date,
      zip_code
    });
    
    res.json({
      success: true,
      data: patients
    });
  } catch (error) {
    logger.error('Patient search by DOB and zip error', { 
      error: error.message,
      birth_date: req.body.birth_date,
      zip_code: req.body.zip_code
    });
    next(error);
  }
});

module.exports = router;