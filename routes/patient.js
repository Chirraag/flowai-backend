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

module.exports = router;