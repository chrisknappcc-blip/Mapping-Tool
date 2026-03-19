const { app } = require('@azure/functions');
const https = require('https');

app.http('npi-proxy', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log('NPI proxy called');

    const params = Object.fromEntries(request.query.entries());
    const qs = new URLSearchParams(params).toString();
    const npiUrl = 'https://npiregistry.cms.hhs.gov/api/?' + qs;

    context.log('Fetching: ' + npiUrl);

    try {
      const data = await fetchJSON(npiUrl);
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify(data)
      };
    } catch (err) {
      context.log.error('NPI proxy error: ' + err.message);
      return {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'NPI registry request failed', detail: err.message })
      };
    }
  }
});

function fetchJSON(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, function (res) {
      let raw = '';
      res.on('data', function (chunk) { raw += chunk; });
      res.on('end', function () {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('Invalid JSON from NPI registry'));
        }
      });
    }).on('error', reject);
  });
}

