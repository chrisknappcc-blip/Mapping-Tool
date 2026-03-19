const { app } = require('@azure/functions');
const https = require('https');

app.http('debug', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const sasToken    = process.env.AZURE_STORAGE_SAS_TOKEN || '';
    const accountName = 'carepathiqdata';

    const result = {
      hasSasToken: sasToken.length > 0,
      sasTokenLength: sasToken.length,
      sasTokenPreview: sasToken.substring(0, 40),
      nodeVersion: process.version
    };

    // Try fetching the CSV directly
    if (sasToken) {
      const url = 'https://' + accountName + '.blob.core.windows.net/qhin-data/facilities.csv' + sasToken;
      try {
        const text = await fetchFirst500(url);
        result.csvFetchStatus = 'success';
        result.csvPreview = text.substring(0, 200);
      } catch(e) {
        result.csvFetchStatus = 'error';
        result.csvFetchError = e.message;
      }
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result, null, 2)
    };
  }
});

function fetchFirst500(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      let raw = '';
      res.on('data', function(chunk) {
        raw += chunk;
        if (raw.length > 500) res.destroy();
      });
      res.on('close', function() {
        if (res.statusCode === 200 || res.statusCode === 206) resolve(raw);
        else reject(new Error('HTTP ' + res.statusCode + ': ' + raw.substring(0, 200)));
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}
