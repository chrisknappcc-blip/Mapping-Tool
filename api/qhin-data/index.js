const { app } = require('@azure/functions');
const https = require('https');

let cachedData = null;
let cacheTime  = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

app.http('qhin-data', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log('QHIN data requested');

    if (cachedData && (Date.now() - cacheTime) < CACHE_TTL_MS) {
      context.log('Returning cached QHIN data (' + cachedData.length + ' facilities)');
      return jsonResponse(200, { facilities: cachedData, count: cachedData.length });
    }

    const accountName = 'carepathiqdata';
    const sasToken    = process.env.AZURE_STORAGE_SAS_TOKEN || '';

    if (!sasToken) {
      return jsonResponse(500, { error: 'SAS token not configured' });
    }

    const url = 'https://' + accountName + '.blob.core.windows.net/qhin-data/facilities.json' + sasToken;

    try {
      context.log('Fetching facilities.json from blob storage');
      const raw = await fetchText(url);
      const facilities = JSON.parse(raw);

      cachedData = facilities;
      cacheTime  = Date.now();

      context.log('Loaded ' + facilities.length + ' QHIN facilities');
      return jsonResponse(200, { facilities: facilities, count: facilities.length });

    } catch (err) {
      context.log.error('QHIN data error: ' + err.message);
      return jsonResponse(502, { error: 'Failed to load QHIN data', detail: err.message });
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
        else reject(new Error('Blob returned ' + res.statusCode + ': ' + raw.substring(0, 200)));
      });
    }).on('error', reject);
  });
}
