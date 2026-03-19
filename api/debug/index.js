const { app } = require('@azure/functions');
const crypto = require('crypto');
const https = require('https');

// Test if convert-qhin loads without crashing
let convertQhinError = null;
try {
  require('../convert-qhin');
} catch(e) {
  convertQhinError = e.message + '\n' + e.stack;
}

let qhinDataError = null;
try {
  require('../qhin-data');
} catch(e) {
  qhinDataError = e.message + '\n' + e.stack;
}

app.http('debug', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING || '';

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        hasConnStr: connStr.length > 0,
        connStrLength: connStr.length,
        connStrPreview: connStr.substring(0, 60),
        nodeVersion: process.version,
        convertQhinError: convertQhinError,
        qhinDataError: qhinDataError
      }, null, 2)
    };
  }
});
