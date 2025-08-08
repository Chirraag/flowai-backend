const crypto = require('crypto');
const db = require('../db/connection');
const logger = require('../utils/logger');

class OAuthService {
  constructor() {
    // No caching needed as we always create new tokens
  }

  /**
   * Validate client credentials and return client info
   * @param {string} clientId - OAuth client ID
   * @param {string} clientSecret - OAuth client secret
   * @returns {Object|null} Client object if valid, null otherwise
   */
  async validateClient(clientId, clientSecret) {
    try {
      logger.debug('Validating OAuth client', { clientId: clientId ? clientId.substring(0, 8) + '...' : 'none' });
      
      // Hash the provided secret to compare with stored hash
      const clientSecretHash = crypto.createHash('sha256').update(clientSecret).digest('hex');
      
      const result = await db.query(
        'SELECT * FROM oauth_clients WHERE client_id = $1 AND client_secret_hash = $2 AND is_active = true',
        [clientId, clientSecretHash]
      );
      
      if (result.rows.length === 0) {
        logger.warn('OAuth client validation failed', { clientId: clientId ? clientId.substring(0, 8) + '...' : 'none' });
        return null;
      }
      
      logger.info('OAuth client validated successfully', { clientId: clientId.substring(0, 8) + '...' });
      return result.rows[0];
    } catch (error) {
      logger.error('Error validating OAuth client', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate a new access token for the client
   * @param {string} clientId - OAuth client ID
   * @returns {Object} Token info with access_token and expires_in
   */
  async generateToken(clientId) {
    try {
      logger.info('Generating new OAuth token', { clientId: clientId.substring(0, 8) + '...' });
      
      // Generate UUID token (PostgreSQL will auto-generate via DEFAULT)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      const expiresIn = 86400; // 24 hours in seconds
      
      // Insert new token and get the generated UUID
      const result = await db.query(
        'INSERT INTO oauth_tokens (client_id, expires_at) VALUES ($1, $2) RETURNING access_token',
        [clientId, expiresAt]
      );
      
      const accessToken = result.rows[0].access_token;
      
      logger.info('OAuth token generated successfully', {
        clientId: clientId.substring(0, 8) + '...',
        tokenPreview: accessToken.substring(0, 8) + '...',
        expiresAt: expiresAt.toISOString()
      });
      
      return {
        access_token: accessToken,
        expires_in: expiresIn
      };
    } catch (error) {
      logger.error('Error generating OAuth token', { error: error.message });
      throw error;
    }
  }

  /**
   * Validate an access token
   * @param {string} token - Access token to validate
   * @returns {Object|null} Token info if valid, null otherwise
   */
  async validateToken(token) {
    try {
      logger.debug('Validating OAuth token', { tokenPreview: token ? token.substring(0, 8) + '...' : 'none' });
      
      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(token)) {
        logger.warn('Invalid token format', { tokenPreview: token ? token.substring(0, 8) + '...' : 'none' });
        return null;
      }
      
      // Check if token exists and is not expired
      const result = await db.query(
        `SELECT t.*, c.name as client_name 
         FROM oauth_tokens t 
         JOIN oauth_clients c ON t.client_id = c.client_id 
         WHERE t.access_token = $1 AND t.expires_at > NOW()`,
        [token]
      );
      
      if (result.rows.length === 0) {
        logger.warn('OAuth token validation failed', { tokenPreview: token.substring(0, 8) + '...' });
        return null;
      }
      
      // Update last_used_at for tracking
      await db.query(
        'UPDATE oauth_tokens SET last_used_at = NOW() WHERE access_token = $1',
        [token]
      );
      
      logger.info('OAuth token validated successfully', {
        tokenPreview: token.substring(0, 8) + '...',
        clientName: result.rows[0].client_name
      });
      
      return result.rows[0];
    } catch (error) {
      // Database error - fail closed (secure approach)
      logger.error('Error validating OAuth token', { error: error.message });
      return null; // Treat as invalid token on DB error (fail closed)
    }
  }

  /**
   * Clean up expired tokens (optional maintenance task)
   * Can be called periodically via cron job
   */
  async cleanupExpiredTokens() {
    try {
      logger.info('Starting cleanup of expired OAuth tokens');
      
      const result = await db.query(
        'DELETE FROM oauth_tokens WHERE expires_at < NOW()'
      );
      
      logger.info('Expired OAuth tokens cleaned up', { deletedCount: result.rowCount });
      return result.rowCount;
    } catch (error) {
      logger.error('Error cleaning up expired tokens', { error: error.message });
      throw error;
    }
  }
}

module.exports = OAuthService;