const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const RedoxTransformer = require('../utils/redoxTransformer');
const RedoxAPIService = require('../services/redoxApiService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/v1/document-reference/patient/{patientId}:
 *   get:
 *     summary: Get all DocumentReferences for a patient
 *     tags: [DocumentReference]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: patientId
 *         required: true
 *         schema:
 *           type: string
 *         description: The patient ID to get documents for
 *         example: "65bee8d7-fee9-4e60-b9d6-1ae276b075b4"
 *     responses:
 *       200:
 *         description: List of all patient's documents
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
router.get('/patient/:patientId', authMiddleware, async (req, res, next) => {
  try {
    const { patientId } = req.params;
    
    logger.info('DocumentReference search by patient', { patientId });
    
    const searchParams = {
      patient: `Patient/${patientId}`
    };
    
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

/**
 * @swagger
 * /api/v1/document-reference/create:
 *   post:
 *     summary: Create a DocumentReference (for testing)
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
 *               - content
 *             properties:
 *               patientId:
 *                 type: string
 *                 description: Patient ID
 *                 example: "65bee8d7-fee9-4e60-b9d6-1ae276b075b4"
 *               content:
 *                 type: string
 *                 description: Document content
 *                 example: "Patient reports feeling well. No complaints today."
 *               title:
 *                 type: string
 *                 description: Document title
 *                 example: "Clinical Note"
 *     responses:
 *       201:
 *         description: DocumentReference created successfully
 *       400:
 *         description: Bad request
 *       500:
 *         description: Internal server error
 */
router.post('/create', authMiddleware, async (req, res, next) => {
  try {
    const { patientId, content, title } = req.body;
    
    logger.info('DocumentReference create request', { patientId, title });
    
    if (!patientId || !content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: patientId, content'
      });
    }

    // Ensure the text has proper formatting (normalize newlines)
    const formattedContent = content
      .replace(/\r\n/g, '\n')  // Convert Windows newlines
      .replace(/\r/g, '\n')    // Convert old Mac newlines
      .trim();                 // Remove leading/trailing whitespace
    
    const documentBundle = RedoxTransformer.createDocumentReferenceBundle(
      patientId,
      formattedContent,
      {
        title: title || 'Manual Test Document',
        source: 'API Test'
      }
    );
    
    const response = await RedoxAPIService.makeRequest(
      'POST',
      '/DocumentReference/$documentreference-create',
      documentBundle,
      null,
      req.accessToken
    );

    const result = RedoxTransformer.transformAppointmentCreateResponse(response);
    
    logger.info('DocumentReference created', { 
      patientId,
      documentId: result.generatedId,
      success: result.success
    });
    
    res.status(result.success ? 201 : 400).json({
      success: result.success,
      data: result.success ? {
        documentId: result.generatedId,
        message: 'DocumentReference created successfully'
      } : { error: result.error }
    });
  } catch (error) {
    logger.error('DocumentReference create error', { error: error.message });
    next(error);
  }
});

module.exports = router;