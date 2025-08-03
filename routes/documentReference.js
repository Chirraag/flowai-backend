const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const RedoxTransformer = require('../utils/redoxTransformer');
const RedoxAPIService = require('../services/redoxApiService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/v1/document-reference/search:
 *   post:
 *     summary: Search for DocumentReferences
 *     tags: [DocumentReference]
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
 *                 description: Patient ID to search documents for
 *                 example: "patient-123"
 *               startDate:
 *                 type: string
 *                 format: date
 *                 description: Start date for document search (inclusive)
 *                 example: "2024-01-01"
 *               endDate:
 *                 type: string
 *                 format: date
 *                 description: End date for document search (inclusive)
 *                 example: "2024-12-31"
 *               category:
 *                 type: string
 *                 description: Document category to filter by
 *                 example: "Patient Intake"
 *     responses:
 *       200:
 *         description: List of DocumentReferences
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
 *                       documentId:
 *                         type: string
 *                       status:
 *                         type: string
 *                       type:
 *                         type: string
 *                       category:
 *                         type: string
 *                       patientId:
 *                         type: string
 *                       date:
 *                         type: string
 *                       author:
 *                         type: string
 *                       description:
 *                         type: string
 *                       content:
 *                         type: string
 *                       contentType:
 *                         type: string
 *                       title:
 *                         type: string
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
router.post('/search', authMiddleware, async (req, res, next) => {
  try {
    const { patientId, startDate, endDate, category } = req.body;
    
    logger.info('DocumentReference search request', {
      patientId,
      startDate,
      endDate,
      category
    });
    
    if (!patientId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: patientId'
      });
    }

    const searchParams = RedoxTransformer.createDocumentReferenceSearchParams(
      patientId,
      startDate,
      endDate,
      category
    );
    
    const response = await RedoxAPIService.makeRequest(
      'POST',
      '/DocumentReference/_search',
      null,
      searchParams,
      req.accessToken
    );

    const documents = RedoxTransformer.transformDocumentReferenceSearchResponse(response);
    
    logger.info('DocumentReference search completed', { 
      patientId,
      documentsFound: documents.length 
    });
    
    res.json({
      success: true,
      data: documents
    });
  } catch (error) {
    logger.error('DocumentReference search error', { error: error.message });
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/document-reference/{id}:
 *   get:
 *     summary: Get a specific DocumentReference by ID
 *     tags: [DocumentReference]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The DocumentReference ID
 *     responses:
 *       200:
 *         description: DocumentReference details
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
 *                     documentId:
 *                       type: string
 *                     status:
 *                       type: string
 *                     type:
 *                       type: string
 *                     category:
 *                       type: string
 *                     patientId:
 *                       type: string
 *                     date:
 *                       type: string
 *                     author:
 *                       type: string
 *                     description:
 *                       type: string
 *                     content:
 *                       type: string
 *                     contentType:
 *                       type: string
 *                     title:
 *                       type: string
 *       404:
 *         description: DocumentReference not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    logger.info('DocumentReference read request', { documentId: id });
    
    const response = await RedoxAPIService.makeRequest(
      'GET',
      `/DocumentReference/${id}`,
      null,
      null,
      req.accessToken
    );

    if (!response || response.resourceType !== 'DocumentReference') {
      return res.status(404).json({
        success: false,
        error: 'DocumentReference not found'
      });
    }

    // Transform single document response
    const documents = RedoxTransformer.transformDocumentReferenceSearchResponse({
      entry: [{ resource: response }]
    });
    
    logger.info('DocumentReference read completed', { documentId: id });
    
    res.json({
      success: true,
      data: documents[0] || null
    });
  } catch (error) {
    logger.error('DocumentReference read error', { 
      documentId: req.params.id,
      error: error.message 
    });
    
    if (error.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'DocumentReference not found'
      });
    }
    
    next(error);
  }
});

module.exports = router;