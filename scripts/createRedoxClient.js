const crypto = require('crypto');
const db = require('../db/connection');
const logger = require('../utils/logger');

require('dotenv').config();

/**
 * Script to create OAuth client credentials for Redox
 * Run with: node scripts/createRedoxClient.js
 */

async function createRedoxOAuthClient() {
  try {
    logger.info('Starting Redox OAuth client creation...');

    // Generate secure client credentials
    const clientId = `cli_${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = `sk_live_${crypto.randomBytes(32).toString('hex')}`;
    
    // Hash the client secret using SHA256
    const clientSecretHash = crypto.createHash('sha256').update(clientSecret).digest('hex');
    
    // Check if a Redox client already exists
    const existingClient = await db.query(
      "SELECT client_id FROM oauth_clients WHERE name = 'Redox Webhook Client'"
    );
    
    if (existingClient.rows.length > 0) {
      console.log('\n⚠️  WARNING: A Redox OAuth client already exists!');
      console.log(`Existing Client ID: ${existingClient.rows[0].client_id}`);
      console.log('Do you want to create another client? (yes/no)');
      
      // Simple prompt for user input
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        readline.question('> ', answer => {
          readline.close();
          resolve(answer.toLowerCase());
        });
      });
      
      if (answer !== 'yes' && answer !== 'y') {
        console.log('Aborted. No new client created.');
        process.exit(0);
      }
    }
    
    // Insert the new client into database
    await db.query(
      `INSERT INTO oauth_clients (client_id, client_secret_hash, name, description, is_active) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        clientId,
        clientSecretHash,
        'Redox Webhook Client',
        'OAuth client for Redox webhook authentication',
        true
      ]
    );
    
    logger.info('Redox OAuth client created successfully in database');
    
    // Display credentials
    console.log('\n' + '='.repeat(60));
    console.log('🔐 REDOX OAUTH CREDENTIALS CREATED SUCCESSFULLY');
    console.log('='.repeat(60));
    console.log('\nClient ID:');
    console.log(`  ${clientId}`);
    console.log('\nClient Secret:');
    console.log(`  ${clientSecret}`);
    console.log('\n' + '='.repeat(60));
    console.log('⚠️  IMPORTANT SECURITY NOTES:');
    console.log('='.repeat(60));
    console.log('1. Save these credentials in a secure location immediately');
    console.log('2. The client secret CANNOT be recovered if lost');
    console.log('3. Share these with Redox through a secure channel');
    console.log('4. Do NOT commit these credentials to version control');
    console.log('='.repeat(60));
    console.log('\n📝 Configuration Instructions for Redox:');
    console.log('='.repeat(60));
    console.log('1. Token Endpoint: POST /oauth/token');
    console.log('2. Grant Type: client_credentials');
    console.log('3. Request Body Format:');
    console.log('   {');
    console.log('     "grant_type": "client_credentials",');
    console.log('     "client_id": "<your_client_id>",');
    console.log('     "client_secret": "<your_client_secret>"');
    console.log('   }');
    console.log('4. Token Response Format:');
    console.log('   {');
    console.log('     "access_token": "<uuid_token>",');
    console.log('     "token_type": "Bearer",');
    console.log('     "expires_in": 86400');
    console.log('   }');
    console.log('5. Webhook Authorization Header:');
    console.log('   Authorization: Bearer <access_token>');
    console.log('='.repeat(60));
    
    process.exit(0);
  } catch (error) {
    logger.error('Failed to create Redox OAuth client', { error: error.message });
    console.error('\n❌ Error creating OAuth client:', error.message);
    console.error('\nMake sure:');
    console.error('1. Database is running and accessible');
    console.error('2. OAuth tables are created (run migration first)');
    console.error('3. Environment variables are properly configured');
    process.exit(1);
  }
}

// Run the script
createRedoxOAuthClient();