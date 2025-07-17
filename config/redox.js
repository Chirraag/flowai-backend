const REDOX_CONFIG = {
  baseURL: 'https://api.redoxengine.com/fhir/R4/redox-fhir-sandbox/Development',
  loginURL: 'https://api.redoxengine.com/auth/authenticate',
  clientId: process.env.REDOX_CLIENT_ID,
  clientSecret: process.env.REDOX_CLIENT_SECRET,
  sourceApp: 'Flow AI App',
  sourceEndpoint: 'urn:uuid:84a33958-51a4-48fd-bd92-3b83ccad2972'
};

module.exports = REDOX_CONFIG;