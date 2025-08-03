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
 *     summary: Search DocumentReferences for a patient
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
 *                 description: The patient ID to get documents for
 *                 example: "65bee8d7-fee9-4e60-b9d6-1ae276b075b4"
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
router.post('/search', authMiddleware, async (req, res, next) => {
  try {
    const { patientId } = req.body;
    
    logger.info('DocumentReference search by patient', { patientId });
    
    if (!patientId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: patientId'
      });
    }
    
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
    
    // Log details for comparison with Retell flow
    logger.info('=== SWAGGER DOCUMENT CREATION DEBUG ===', {
      patient_id: patientId,
      content_type: typeof formattedContent,
      content_length: formattedContent.length,
      content_preview: formattedContent.substring(0, 100),
      has_access_token: !!req.accessToken,
      access_token_source: 'auth_middleware',
      metadata: {
        title: title || 'Manual Test Document',
        source: 'API Test'
      }
    });
    
    const documentBundle = RedoxTransformer.createDocumentReferenceBundle(
      patientId,
      formattedContent,
      {
        title: title || 'Manual Test Document',
        source: 'API Test'
      }
    );
    
    logger.info('=== SWAGGER BUNDLE STRUCTURE ===', {
      patient_id: patientId,
      bundle_type: documentBundle.resourceType,
      bundle_entries: documentBundle.entry?.length,
      message_header_id: documentBundle.entry?.[0]?.resource?.id,
      document_id: documentBundle.entry?.[1]?.resource?.id,
      bundle_json: JSON.stringify(documentBundle, null, 2)
    });
    
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
    logger.error('DocumentReference create error', { 
      error: error.message,
      patientId: patientId,
      bundleStructure: JSON.stringify(documentBundle, null, 2),
      bundleSize: JSON.stringify(documentBundle).length
    });
    
    // Check if it's a Redox validation error
    if (error.message.includes('400')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format. Please check patient ID and content.',
        details: error.message
      });
    }
    
    next(error);
  }
});

module.exports = router;