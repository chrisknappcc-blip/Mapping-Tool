const { app } = require('@azure/functions');
const https = require('https');
const crypto = require('crypto');

// ── Helpers ───────────────────────────────────────────────────────────────────
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
        else reject(new Error(res.statusCode + ': ' + raw.substring(0, 300)));
      });
    }).on('error', reject);
  });
}

function putText(url, content, contentType) {
  return new Promise(function(resolve, reject) {
    const bodyBuffer = Buffer.from(content, 'utf8');
    const urlObj     = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   'PUT',
      headers: {
        'Content-Type':   contentType,
        'Content-Length': bodyBuffer.length,
        'x-ms-blob-type': 'BlockBlob'
      }
    };
    const req = https.request(options, function(res) {
      let raw = '';
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() {
        if (res.statusCode === 200 || res.statusCode === 201) resolve();
        else reject(new Error('PUT ' + res.statusCode + ': ' + raw.substring(0, 200)));
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

function getBlobUrl(sasToken, container, blobName) {
  return 'https://carepathiqdata.blob.core.windows.net/' + container + '/' + blobName + sasToken;
}

function parseCSVLine(line) {
  var result = [], current = '', inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === '\t') && !inQuotes) {
      result.push(current); current = '';
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

// ── In-memory caches ──────────────────────────────────────────────────────────
let qhinCache = null, qhinCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

// ── Route handlers ────────────────────────────────────────────────────────────

async function handleNpiProxy(request, context) {
  const params = Object.fromEntries(request.query.entries());
  const qs = new URLSearchParams(params).toString();
  const npiUrl = 'https://npiregistry.cms.hhs.gov/api/?' + qs;
  context.log('NPI: ' + npiUrl);
  try {
    const data = await fetchText(npiUrl);
    return { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: data };
  } catch(err) {
    return jsonResponse(502, { error: 'NPI failed', detail: err.message });
  }
}

async function handleGeocodeProxy(request, context) {
  const params = Object.fromEntries(request.query.entries());
  const qs = new URLSearchParams(params).toString();
  const isReverse = !!params.lat;
  const nominatimUrl = 'https://nominatim.openstreetmap.org/' + (isReverse ? 'reverse?' : 'search?') + qs + '&format=json';
  context.log('Geocode: ' + nominatimUrl);
  try {
    const client = { get: function(url, opts, cb) { return https.get(url, opts, cb); } };
    const data = await new Promise(function(resolve, reject) {
      https.get(nominatimUrl, { headers: { 'User-Agent': 'CarePathIQ/1.0', 'Accept-Language': 'en' } }, function(res) {
        let raw = '';
        res.on('data', function(c) { raw += c; });
        res.on('end', function() {
          if (res.statusCode === 200) resolve(raw);
          else reject(new Error(res.statusCode + ': ' + raw.substring(0, 100)));
        });
      }).on('error', reject);
    });
    return { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: data };
  } catch(err) {
    return jsonResponse(502, { error: 'Geocode failed', detail: err.message });
  }
}

async function handleQhinData(request, context) {
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN || '';
  if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });

  if (qhinCache && (Date.now() - qhinCacheTime) < CACHE_TTL) {
    return jsonResponse(200, { facilities: qhinCache, count: qhinCache.length });
  }

  try {
    const raw = await fetchText(getBlobUrl(sasToken, 'qhin-data', 'facilities.json'));
    qhinCache = JSON.parse(raw);
    qhinCacheTime = Date.now();
    context.log('QHIN: loaded ' + qhinCache.length + ' facilities');
    return jsonResponse(200, { facilities: qhinCache, count: qhinCache.length });
  } catch(err) {
    return jsonResponse(502, { error: 'QHIN load failed', detail: err.message });
  }
}

async function handleConvertQhin(request, context) {
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN || '';
  if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });

  try {
    const raw     = await fetchText(getBlobUrl(sasToken, 'qhin-data', 'facilities.csv'));
    const lines   = raw.split('\n');
    const headers = parseCSVLine(lines[0]);

    function colIdx(name) {
      return headers.findIndex(function(h) { return h.toLowerCase().trim() === name.toLowerCase(); });
    }

    const iName = colIdx('DisplayName'), iLat = colIdx('Latitude'), iLon = colIdx('Longitude');
    const iAddr = colIdx('Address'), iCity = colIdx('City'), iState = colIdx('State');
    const iZip  = colIdx('ZipCode'), iOrg  = colIdx('OrganizationId');

    if (iName < 0 || iLat < 0 || iLon < 0) {
      return jsonResponse(400, { error: 'Required columns not found', found: headers.join(', ') });
    }

    var facilities = [], skipped = 0;
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var cols = parseCSVLine(line);
      var name = (cols[iName] || '').trim();
      var lat  = parseFloat(cols[iLat]);
      var lon  = parseFloat(cols[iLon]);
      if (!name || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) { skipped++; continue; }
      facilities.push({
        id: 'qhin_' + (iOrg >= 0 ? (cols[iOrg] || i) : i),
        type: 'excel', lat: lat, lon: lon,
        tags: {
          name:     name,
          address:  iAddr  >= 0 ? (cols[iAddr]  || '').trim() : '',
          city:     iCity  >= 0 ? (cols[iCity]  || '').trim() : '',
          state:    iState >= 0 ? (cols[iState] || '').trim() : '',
          postcode: iZip   >= 0 ? (cols[iZip]   || '').trim() : ''
        },
        _embeddedSystem: '', _facType: ''
      });
    }

    await putText(getBlobUrl(sasToken, 'qhin-data', 'facilities.json'), JSON.stringify(facilities), 'application/json');
    qhinCache = null; // clear cache
    return jsonResponse(200, { success: true, facilities: facilities.length, skipped: skipped });
  } catch(err) {
    return jsonResponse(500, { error: 'Conversion failed', detail: err.message });
  }
}

async function handleStateLoad(request, context) {
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN || '';
  if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
  try {
    const raw   = await fetchText(getBlobUrl(sasToken, 'app-state', 'shared-state.json'));
    return { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: raw };
  } catch(err) {
    if (err.message && err.message.startsWith('404')) {
      return jsonResponse(200, { overrides: {}, customSystems: [], excluded: [] });
    }
    return jsonResponse(502, { error: 'State load failed', detail: err.message });
  }
}

async function handleStateSave(request, context) {
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN || '';
  if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
  try {
    const body = await request.text();
    JSON.parse(body); // validate JSON
    await putText(getBlobUrl(sasToken, 'app-state', 'shared-state.json'), body, 'application/json');
    return jsonResponse(200, { success: true });
  } catch(err) {
    return jsonResponse(500, { error: 'State save failed', detail: err.message });
  }
}

async function handleDebug(request, context) {
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN || '';
  return jsonResponse(200, {
    hasSasToken: sasToken.length > 0,
    sasTokenLength: sasToken.length,
    nodeVersion: process.version,
    qhinCached: qhinCache ? qhinCache.length : 0
  });
}

// ── Single router function ────────────────────────────────────────────────────
app.http('router', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'router/{*action}',
  handler: async (request, context) => {
    const action = request.params.action || '';
    context.log('Router: ' + request.method + ' /' + action);

    if (action === 'npi-proxy')     return handleNpiProxy(request, context);
    if (action === 'geocode-proxy') return handleGeocodeProxy(request, context);
    if (action === 'qhin-data')     return handleQhinData(request, context);
    if (action === 'convert-qhin')  return handleConvertQhin(request, context);
    if (action === 'state-load')    return handleStateLoad(request, context);
    if (action === 'state-save')    return handleStateSave(request, context);
    if (action === 'debug')         return handleDebug(request, context);

    return jsonResponse(404, { error: 'Unknown action: ' + action });
  }
});
