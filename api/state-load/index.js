const { app } = require('@azure/functions');
const https = require('https');

app.http('state-load', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log('Loading shared state');

    const sasToken    = process.env.AZURE_STORAGE_SAS_TOKEN || '';
    const accountName = 'carepathiqdata';

    if (!sasToken) {
      return jsonResponse(500, { error: 'SAS token not configured' });
    }

    const url = 'https://' + accountName + '.blob.core.windows.net/app-state/shared-state.json' + sasToken;

    try {
      const raw   = await fetchText(url);
      const state = JSON.parse(raw);
      context.log('Loaded shared state');
      return jsonResponse(200, state);
    } catch(err) {
      // If file doesn't exist yet, return empty state
      if (err.message && err.message.includes('404')) {
        context.log('No shared state yet — returning empty');
        return jsonResponse(200, { overrides: {}, customSystems: [], excluded: [] });
      }
      context.log.error('State load error: ' + err.message);
      return jsonResponse(502, { error: 'Failed to load state', detail: err.message });
    }
  }
});

function jsonResponse(status, obj) {
  return {
    status: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj)
  };
}

function fetchText(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      let raw = '';
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() {
        if (res.statusCode === 200) resolve(raw);
        else reject(new Error(res.statusCode + ': ' + raw.substring(0, 200)));
      });
    }).on('error', reject);
  });
}
