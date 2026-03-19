const https = require('https');
const http = require('http');

module.exports = async function (context, req) {
  context.log('NPI proxy called');

  // Pull query params forwarded from the frontend
  const params = req.query;

  // Build the NPI registry URL
  const qs = new URLSearchParams(params).toString();
  const npiUrl = 'https://npiregistry.cms.hhs.gov/api/?' + qs;

  context.log('Fetching: ' + npiUrl);

  try {
    const data = await fetchJSON(npiUrl);
    context.res = {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    context.log.error('NPI proxy error: ' + err.message);
    context.res = {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'NPI registry request failed', detail: err.message })
    };
  }
};

function fetchJSON(url) {
  return new Promise(function (resolve, reject) {
    const client = url.startsWith('https') ? https : http;
    client.get(url, function (res) {
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
