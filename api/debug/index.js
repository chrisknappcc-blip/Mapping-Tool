const { app } = require('@azure/functions');
const crypto = require('crypto');
const https = require('https');

app.http('debug', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING || '';

    const result = {
      hasConnStr: connStr.length > 0,
      connStrLength: connStr.length,
      connStrPreview: connStr.substring(0, 60),
      cryptoAvailable: typeof crypto !== 'undefined',
      httpsAvailable: typeof https !== 'undefined',
      nodeVersion: process.version
    };

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result, null, 2)
    };
  }
});
