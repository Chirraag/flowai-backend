const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const RedoxTransformer = require('../utils/redoxTransformer');
const RedoxAPIService = require('../services/redoxApiService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/v1/slot/search:
 *   post:
 *     summary: Search for available appointment slots
 *     tags: [Slot]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               location:
 *                 type: string
 *                 description: Optional location name filter
 *                 example: "Main Clinic"
 *               serviceType:
 *                 type: string
 *                 description: Optional service type filter
 *                 example: "consultation"
 *               startTime:
 *                 type: string
 *                 format: date-time
 *                 description: Optional start time filter
 *                 example: "2025-01-22T14:00:00.000Z"
 *               access_token:
 *                 type: string
 *                 description: Optional access token
 *                 example: ""
 *     responses:
 *       200:
 *         description: Available slots
 *       401:
 *         description: Authentication failed
 */
router.post('/search', authMiddleware, async (req, res, next) => {
  try {
    const { location, serviceType, startTime } = req.body;
    logger.info('Slot search request', { 
      location: location ? 'provided' : 'optional',
      serviceType: serviceType ? 'provided' : 'optional',
      startTime: startTime ? 'provided' : 'optional'
    });

    const searchParams = RedoxTransformer.createSlotSearchParams(location, serviceType, startTime);
    const redoxResponse = await RedoxAPIService.makeRequest(
      'POST',
      '/Slot/_search',
      null,
      searchParams,
      req.accessToken
    );

    // Transform the response to return simplified slot objects
    const slots = RedoxTransformer.transformSlotSearchResponse(redoxResponse);

    logger.info('Slot search completed successfully', { slotsFound: slots.length });
    res.json({
      success: true,
      data: slots
    });
  } catch (error) {
    logger.error('Slot search error', { error: error.message });
    next(error);
  }
});

module.exports = router;