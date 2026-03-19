const { app } = require('@azure/functions');
const https = require('https');

// Simple in-memory cache to avoid re-geocoding the same address
const cache = {};

app.http('geocode-proxy', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const params = Object.fromEntries(request.query.entries());
    const qs = new URLSearchParams(params).toString();
    const cacheKey = qs;

    // Return cached result if available
    if (cache[cacheKey]) {
      context.log('Cache hit: ' + cacheKey);
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify(cache[cacheKey])
      };
    }

    const nominatimUrl = 'https://nominatim.openstreetmap.org/' 
      + (params.lat ? 'reverse?' : 'search?')
      + qs
      + '&format=json';

    context.log('Geocoding: ' + nominatimUrl);

    // Nominatim requires a User-Agent header
    try {
      const data = await fetchJSON(nominatimUrl, {
        'User-Agent': 'CarePathIQ-MarketMapper/1.0',
        'Accept-Language': 'en'
      });

      // Cache the result server-side
      cache[cacheKey] = data;

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify(data)
      };
    } catch (err) {
      context.log.error('Geocode proxy error: ' + err.message);
      return {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Geocoding failed', detail: err.message })
      };
    }
  }
});

function fetchJSON(url, headers) {
  return new Promise(function (resolve, reject) {
    const options = {
      headers: headers || {}
    };
    https.get(url, options, function (res) {
      let raw = '';
      res.on('data', function (chunk) { raw += chunk; });
      res.on('end', function () {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('Invalid JSON from geocoder'));
        }
      });
    }).on('error', reject);
  });
}
