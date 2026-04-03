const https = require('https');

// ── Helpers ───────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function jsonResponse(statusCode, obj) {
  return {
    statusCode: statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS),
    body: JSON.stringify(obj)
  };
}

function fetchText(url, headers) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: headers || {} }, function(res) {
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
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
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

function fetchBinary(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      var chunks = [];
      res.on('data', function(chunk) { chunks.push(chunk); });
      res.on('end', function() {
        if (res.statusCode === 200) resolve(Buffer.concat(chunks));
        else reject(new Error(res.statusCode + ': ' + chunks.join('').substring(0, 100)));
      });
    }).on('error', reject);
  });
}

function putBinary(url, buffer, contentType) {
  return new Promise(function(resolve, reject) {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'x-ms-blob-type': 'BlockBlob'
      }
    };
    const req = https.request(options, function(res) {
      let raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        if (res.statusCode === 200 || res.statusCode === 201) resolve();
        else reject(new Error('PUT ' + res.statusCode + ': ' + raw.substring(0, 100)));
      });
    });
    req.on('error', reject);
    req.write(buffer);
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


// ── Icon index helpers ────────────────────────────────────────────────────────
// icon-index.json is a simple JSON array of system key strings stored in logos/.
// This avoids needing the List permission on the SAS token.
// Format: ["mass_general_brigham", "beth_israel_lahey", ...]

async function readIconIndex(sasToken) {
  try {
    const raw = await fetchText(getBlobUrl(sasToken, 'logos', 'icon-index.json'));
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    // 404 means no icons saved yet — return empty list, not an error
    if (e.message && e.message.startsWith('404')) return [];
    throw e;
  }
}

async function updateIconIndex(sasToken, system, op) {
  // op: 'add' | 'remove'
  let systems = [];
  try { systems = await readIconIndex(sasToken); } catch(e) { /* start fresh */ }
  if (op === 'add') {
    if (!systems.includes(system)) systems.push(system);
  } else {
    systems = systems.filter(function(s) { return s !== system; });
  }
  await putText(getBlobUrl(sasToken, 'logos', 'icon-index.json'), JSON.stringify(systems), 'application/json');
}

let qhinCache = null, qhinCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

// ── Netlify Function handler ───────────────────────────────────────────────────
exports.handler = async function(event, context) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  const params = event.queryStringParameters || {};
  const action = params.action || '';
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN || '';

  console.log('Router: ' + event.httpMethod + ' action=' + action);

  try {

    // ── debug ───────────────────────────────────────────────────────────────
    if (action === 'debug') {
      return jsonResponse(200, {
        hasSasToken: sasToken.length > 0,
        sasLength: sasToken.length,
        nodeVersion: process.version,
        qhinCached: qhinCache ? qhinCache.length : 0,
        action: action,
        platform: 'netlify'
      });
    }

    // ── npi-proxy ────────────────────────────────────────────────────────────
    if (action === 'npi-proxy') {
      const npiParams = Object.assign({}, params);
      delete npiParams.action;
      const qs = '?' + new URLSearchParams(npiParams).toString();
      try {
        const data = await fetchText('https://npiregistry.cms.hhs.gov/api/' + qs);
        return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS), body: data };
      } catch(err) {
        return jsonResponse(502, { error: 'NPI failed', detail: err.message });
      }
    }

    // ── geocode-proxy ────────────────────────────────────────────────────────
    if (action === 'geocode-proxy') {
      const gParams = Object.assign({}, params);
      delete gParams.action;
      const qs2 = new URLSearchParams(gParams).toString() + '&format=json';
      const isRev = !!gParams.lat;
      const gUrl = 'https://nominatim.openstreetmap.org/' + (isRev ? 'reverse?' : 'search?') + qs2;
      try {
        const data = await fetchText(gUrl, { 'User-Agent': 'CarePathIQ/1.0', 'Accept-Language': 'en' });
        return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS), body: data };
      } catch(err) {
        return jsonResponse(502, { error: 'Geocode failed', detail: err.message });
      }
    }

    // ── geocache-get ─────────────────────────────────────────────────────────
    // Read a single entry from the persistent geocode cache.
    // ?action=geocache-get&key=zip:02115
    // Returns { hit: true, lat, lon } or { hit: false }
    if (action === 'geocache-get') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const cacheKey = params.key || '';
      if (!cacheKey) return jsonResponse(400, { error: 'key param required' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'geocode_cache.json'));
        const cache = JSON.parse(raw);
        const entry = cache[cacheKey];
        if (entry && entry.lat && entry.lon) {
          return jsonResponse(200, { hit: true, lat: entry.lat, lon: entry.lon });
        }
        return jsonResponse(200, { hit: false });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) return jsonResponse(200, { hit: false });
        return jsonResponse(502, { error: 'Geocache get failed', detail: err.message });
      }
    }

    // ── geocache-set ─────────────────────────────────────────────────────────
    // Write one or more entries to the persistent geocode cache (read-modify-write).
    // POST body: JSON object of { key: { lat, lon } } pairs
    if (action === 'geocache-set') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      let newEntries;
      try { newEntries = JSON.parse(event.body || '{}'); } catch(e) { return jsonResponse(400, { error: 'Invalid JSON body' }); }
      try {
        let cache = {};
        try {
          const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'geocode_cache.json'));
          cache = JSON.parse(raw);
        } catch(e) { /* cache doesn't exist yet — start fresh */ }

        const ts = new Date().toISOString();
        Object.keys(newEntries).forEach(function(k) {
          cache[k] = { lat: newEntries[k].lat, lon: newEntries[k].lon, ts: ts };
        });

        await putText(getBlobUrl(sasToken, 'app-state', 'geocode_cache.json'), JSON.stringify(cache), 'application/json');
        return jsonResponse(200, { success: true, total_cached: Object.keys(cache).length });
      } catch(err) {
        return jsonResponse(500, { error: 'Geocache set failed', detail: err.message });
      }
    }

    // ── qhin-data ────────────────────────────────────────────────────────────
    if (action === 'qhin-data') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      if (qhinCache && (Date.now() - qhinCacheTime) < CACHE_TTL) {
        return jsonResponse(200, { facilities: qhinCache, count: qhinCache.length });
      }
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'qhin-data', 'facilities.json'));
        qhinCache = JSON.parse(raw);
        qhinCacheTime = Date.now();
        return jsonResponse(200, { facilities: qhinCache, count: qhinCache.length });
      } catch(err) {
        return jsonResponse(502, { error: 'QHIN load failed', detail: err.message });
      }
    }

    // ── convert-qhin ─────────────────────────────────────────────────────────
    if (action === 'convert-qhin') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'qhin-data', 'facilities.csv'));
        const lines = raw.split('\n');
        const headers = parseCSVLine(lines[0]);
        function colIdx(name) {
          return headers.findIndex(function(h) { return h.toLowerCase().trim() === name.toLowerCase(); });
        }
        const iName = colIdx('DisplayName'), iLat = colIdx('Latitude'), iLon = colIdx('Longitude');
        const iAddr = colIdx('Address'), iCity = colIdx('City'), iState = colIdx('State');
        const iZip = colIdx('ZipCode'), iOrg = colIdx('OrganizationId');
        if (iName < 0 || iLat < 0 || iLon < 0) return jsonResponse(400, { error: 'Columns not found', found: headers.join(', ') });
        var facilities = [], skipped = 0;
        for (var i = 1; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          var cols = parseCSVLine(line);
          var name = (cols[iName] || '').trim();
          var lat = parseFloat(cols[iLat]);
          var lon = parseFloat(cols[iLon]);
          if (!name || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) { skipped++; continue; }
          facilities.push({
            id: 'qhin_' + (iOrg >= 0 ? (cols[iOrg] || i) : i),
            type: 'excel', lat: lat, lon: lon,
            tags: {
              name: name,
              address: iAddr >= 0 ? (cols[iAddr] || '').trim() : '',
              city: iCity >= 0 ? (cols[iCity] || '').trim() : '',
              state: iState >= 0 ? (cols[iState] || '').trim() : '',
              postcode: iZip >= 0 ? (cols[iZip] || '').trim() : ''
            },
            _embeddedSystem: '', _facType: ''
          });
        }
        await putText(getBlobUrl(sasToken, 'qhin-data', 'facilities.json'), JSON.stringify(facilities), 'application/json');
        qhinCache = null;
        return jsonResponse(200, { success: true, facilities: facilities.length, skipped: skipped });
      } catch(err) {
        return jsonResponse(500, { error: 'Conversion failed', detail: err.message });
      }
    }

    // ── state-load ───────────────────────────────────────────────────────────
    if (action === 'state-load') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'shared-state.json'));
        return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS), body: raw };
      } catch(err) {
        if (err.message && err.message.startsWith('404')) {
          return jsonResponse(200, { overrides: {}, customSystems: [], excluded: [] });
        }
        return jsonResponse(502, { error: 'State load failed', detail: err.message });
      }
    }

    // ── state-save ───────────────────────────────────────────────────────────
    if (action === 'state-save') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const body = event.body || '{}';
        JSON.parse(body);
        await putText(getBlobUrl(sasToken, 'app-state', 'shared-state.json'), body, 'application/json');
        return jsonResponse(200, { success: true });
      } catch(err) {
        return jsonResponse(500, { error: 'State save failed', detail: err.message });
      }
    }

    // ── icon-load ────────────────────────────────────────────────────────────
    if (action === 'icon-load') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const system = params.system || 'default';
      const blobName = 'icon-' + system.replace(/[^a-z0-9-]/g, '_');
      try {
        const buffer = await fetchBinary(getBlobUrl(sasToken, 'logos', blobName));
        if (!buffer || buffer.length === 0) return jsonResponse(200, { dataUrl: null });
        return jsonResponse(200, { dataUrl: 'data:image/png;base64,' + buffer.toString('base64') });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) return jsonResponse(200, { dataUrl: null });
        return jsonResponse(502, { error: 'Icon load failed', detail: err.message });
      }
    }

    // ── icon-save ────────────────────────────────────────────────────────────
    if (action === 'icon-save') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const system = params.system || 'default';
      const blobName = 'icon-' + system.replace(/[^a-z0-9-]/g, '_');
      try {
        const dataUrl = event.body || '';
        const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
        if (!matches) return jsonResponse(400, { error: 'Invalid data URL' });
        const buffer = Buffer.from(matches[2], 'base64');
        await putBinary(getBlobUrl(sasToken, 'logos', blobName), buffer, matches[1]);
        // Update icon index
        await updateIconIndex(sasToken, system, 'add');
        return jsonResponse(200, { success: true, bytes: buffer.length, system: system });
      } catch(err) {
        return jsonResponse(500, { error: 'Icon save failed', detail: err.message });
      }
    }

    // ── icon-clear ───────────────────────────────────────────────────────────
    if (action === 'icon-clear') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const system = params.system || 'default';
      const blobName = 'icon-' + system.replace(/[^a-z0-9-]/g, '_');
      try {
        await putBinary(getBlobUrl(sasToken, 'logos', blobName), Buffer.alloc(0), 'image/png');
        // Update icon index
        await updateIconIndex(sasToken, system, 'remove');
        return jsonResponse(200, { success: true });
      } catch(err) {
        return jsonResponse(500, { error: 'Icon clear failed', detail: err.message });
      }
    }

    // ── logo-load ────────────────────────────────────────────────────────────
    if (action === 'logo-load') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const buffer = await fetchBinary(getBlobUrl(sasToken, 'logos', 'cc-logo'));
        if (!buffer || buffer.length === 0) return jsonResponse(200, { dataUrl: null });
        return jsonResponse(200, { dataUrl: 'data:image/png;base64,' + buffer.toString('base64') });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) return jsonResponse(200, { dataUrl: null });
        return jsonResponse(502, { error: 'Logo load failed', detail: err.message });
      }
    }

    // ── logo-save ────────────────────────────────────────────────────────────
    if (action === 'logo-save') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const dataUrl = event.body || '';
        const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
        if (!matches) return jsonResponse(400, { error: 'Invalid data URL' });
        const buffer = Buffer.from(matches[2], 'base64');
        await putBinary(getBlobUrl(sasToken, 'logos', 'cc-logo'), buffer, matches[1]);
        return jsonResponse(200, { success: true, bytes: buffer.length });
      } catch(err) {
        return jsonResponse(500, { error: 'Logo save failed', detail: err.message });
      }
    }

    // ── logo-clear ───────────────────────────────────────────────────────────
    if (action === 'logo-clear') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        await putBinary(getBlobUrl(sasToken, 'logos', 'cc-logo'), Buffer.alloc(0), 'image/png');
        return jsonResponse(200, { success: true });
      } catch(err) {
        return jsonResponse(500, { error: 'Logo clear failed', detail: err.message });
      }
    }

    // ── cms-columns ──────────────────────────────────────────────────────────
    // Diagnostic: shows what columns CMS API actually returns
    if (action === 'cms-columns') {
      try {
        const cmsUrl = 'https://data.cms.gov/sites/default/files/2026-01/c500f848-83b3-4f29-a677-562243a2f23b/Hospital_and_other.DATA.Q4_2025.csv';
        const raw = await fetchText(cmsUrl);
        const lines = raw.split('\n');
        const headers = parseCSVLine(lines[0]);
        const sample = lines[1] ? parseCSVLine(lines[1]) : [];
        const preview = {};
        headers.forEach(function(h, i) { preview[h] = sample[i] || ''; });
        return jsonResponse(200, { columns: headers, sample: preview, total_lines: lines.length });
      } catch(err) {
        return jsonResponse(500, { error: 'CMS columns check failed', detail: err.message });
      }
    }

    // ── build-cms ────────────────────────────────────────────────────────────
    if (action === 'build-cms') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const PROVIDER_TYPE_MAP = {
        '01':'hospital','02':'hospital','03':'hospital','04':'hospital',
        '05':'hospital','06':'hospital','07':'outpatient','08':'outpatient',
        '09':'rehab','10':'rehab','11':'clinic','12':'rehab',
        '13':'outpatient','14':'rehab','15':'outpatient','16':'rehab',
        '17':'clinic','18':'outpatient','19':'clinic','20':'clinic',
        '21':'hospital','22':'clinic','23':'outpatient','24':'clinic',
        '25':'specialist','26':'rehab','27':'clinic','28':'outpatient',
        '29':'outpatient','31':'outpatient','33':'hospital'
      };
      try {
        const cmsUrl = 'https://data.cms.gov/sites/default/files/2026-01/c500f848-83b3-4f29-a677-562243a2f23b/Hospital_and_other.DATA.Q4_2025.csv';
        const raw = await fetchText(cmsUrl);
        const lines = raw.split('\n');
        const headers = parseCSVLine(lines[0]);
        function col(row, ...names) {
          for (var i = 0; i < names.length; i++) {
            var idx = headers.indexOf(names[i]);
            if (idx >= 0 && row[idx]) return row[idx].trim();
          }
          return '';
        }
        var facilities = [], skipped = 0;
        for (var i = 1; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          var row = parseCSVLine(line);
          var name = col(row, 'FAC_NAME', 'PRVDR_NM', 'NAME');
          var lat = parseFloat(col(row, 'LAT_CD', 'LATITUDE', 'lat'));
          var lon = parseFloat(col(row, 'LONG_CD', 'LONGITUDE', 'lon'));
          var state = col(row, 'STATE_CD', 'STATE');
          var zip = col(row, 'ZIP_CD', 'ZIP');
          var city = col(row, 'CITY_NAME', 'CITY');
          var addr = col(row, 'ST_ADR', 'ADDRESS');
          var type = col(row, 'PRVDR_CTGRY_CD', 'PROVIDER_TYPE');
          var ccn = col(row, 'PRVDR_NUM', 'CCN');
          if (!name || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) { skipped++; continue; }
          facilities.push({
            id: 'cms_' + (ccn || i), type: 'cms', lat: lat, lon: lon,
            _facType: PROVIDER_TYPE_MAP[type] || 'clinic',
            tags: { name: name, address: addr, city: city, state: state, postcode: zip }
          });
        }
        var byState = {};
        facilities.forEach(function(f) {
          var st = f.tags.state || 'XX';
          if (!byState[st]) byState[st] = [];
          byState[st].push(f);
        });
        var output = JSON.stringify({ total: facilities.length, built: new Date().toISOString(), by_state: byState });
        await putText(getBlobUrl(sasToken, 'cms-data', 'cms_providers.json'), output, 'application/json');

        // Build lookup index: keyed by "STATE|ZIP5|normalizedName" -> _facType
        // Used by cms-lookup for post-load enrichment (no coordinates needed)
        function normalizeName(n) {
          return n.toLowerCase()
            .replace(/[^a-z0-9 ]/g, '')
            .replace(/\b(the|of|and|at|a|an|for|center|centre|medical|health|care|hospital|clinic|system|services|inc|llc|corp)\b/g, '')
            .replace(/\s+/g, ' ').trim();
        }
        var lookup = {};
        facilities.forEach(function(f) {
          var st  = f.tags.state || '';
          var zip = (f.tags.postcode || '').substring(0, 5);
          var nm  = normalizeName(f.tags.name || '');
          if (!st || !nm) return;
          // Index by state+zip+name and also state+name (zip may differ by a digit)
          var key1 = st + '|' + zip + '|' + nm;
          var key2 = st + '||' + nm;
          if (!lookup[key1]) lookup[key1] = f._facType;
          if (!lookup[key2]) lookup[key2] = f._facType; // first match wins
        });
        var lookupOutput = JSON.stringify({ built: new Date().toISOString(), index: lookup });
        await putText(getBlobUrl(sasToken, 'cms-data', 'cms_lookup.json'), lookupOutput, 'application/json');

        return jsonResponse(200, { success: true, facilities: facilities.length, skipped: skipped, states: Object.keys(byState).length, lookup_keys: Object.keys(lookup).length });
      } catch(err) {
        return jsonResponse(500, { error: 'CMS build failed', detail: err.message });
      }
    }

    // ── cms-data ─────────────────────────────────────────────────────────────
    if (action === 'cms-data') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'cms-data', 'cms_providers.json'));
        return { statusCode: 200, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' }, CORS_HEADERS), body: raw };
      } catch(err) {
        if (err.message && err.message.startsWith('404')) {
          return jsonResponse(200, { error: 'CMS data not yet uploaded', total: 0, by_state: {} });
        }
        return jsonResponse(502, { error: 'CMS load failed', detail: err.message });
      }
    }

    // ── cms-lookup ───────────────────────────────────────────────────────────
    // Loads the cms_lookup.json index and matches a batch of facilities by
    // name + state + zip, returning verified _facType values for enrichment.
    // POST body: JSON array of { id, name, state, zip }
    // Returns: { matches: { id: _facType } }
    if (action === 'cms-lookup') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'cms-data', 'cms_lookup.json'));
        const data = JSON.parse(raw);
        const index = data.index || {};

        function normalizeName(n) {
          return n.toLowerCase()
            .replace(/[^a-z0-9 ]/g, '')
            .replace(/\b(the|of|and|at|a|an|for|center|centre|medical|health|care|hospital|clinic|system|services|inc|llc|corp)\b/g, '')
            .replace(/\s+/g, ' ').trim();
        }

        let batch;
        try { batch = JSON.parse(event.body || '[]'); } catch(e) { batch = []; }
        if (!Array.isArray(batch)) return jsonResponse(400, { error: 'Body must be JSON array' });

        const matches = {};
        batch.forEach(function(f) {
          if (!f.id || !f.name) return;
          var st  = (f.state || '').toUpperCase();
          var zip = (f.zip  || '').substring(0, 5);
          var nm  = normalizeName(f.name);
          // Try state+zip+name first, then state+name fallback
          var hit = index[st + '|' + zip + '|' + nm] || index[st + '||' + nm];
          if (hit) matches[f.id] = hit;
        });

        return jsonResponse(200, { matches: matches, queried: batch.length, matched: Object.keys(matches).length });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) {
          return jsonResponse(200, { matches: {}, queried: 0, matched: 0, note: 'CMS lookup index not yet built — run build-cms first' });
        }
        return jsonResponse(502, { error: 'CMS lookup failed', detail: err.message });
      }
    }


    // ── icon-list ────────────────────────────────────────────────────────────────────────
    // Lists icons by reading icon-index.json from Blob (avoids needing List permission on SAS token).
    // Returns: { icons: [ { system: "mass_general_brigham", blobName: "icon-mass_general_brigham" }, ... ] }
    if (action === 'icon-list') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const systems = await readIconIndex(sasToken);
        const icons = systems.map(function(system) {
          return { system: system, blobName: 'icon-' + system };
        });
        return jsonResponse(200, { icons });
      } catch(err) {
        return jsonResponse(502, { error: 'Icon list failed', detail: err.message });
      }
    }
// ── search-cache-get ──────────────────────────────────────────────────────
    if (action === 'search-cache-get') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const cacheKey = params.key || '';
      if (!cacheKey) return jsonResponse(400, { error: 'key param required' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'search_cache.json'));
        const cache = JSON.parse(raw);
        const entry = cache[cacheKey];
        if (!entry) return jsonResponse(200, { hit: false });
        const age = Date.now() - new Date(entry.ts).getTime();
        if (age > 30 * 24 * 60 * 60 * 1000) return jsonResponse(200, { hit: false, expired: true });
        return jsonResponse(200, { hit: true, facilities: entry.facilities });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) return jsonResponse(200, { hit: false });
        return jsonResponse(502, { error: 'Search cache get failed', detail: err.message });
      }
    }

    // ── search-cache-set ──────────────────────────────────────────────────────
    if (action === 'search-cache-set') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch(e) { return jsonResponse(400, { error: 'Invalid JSON' }); }
      const { key, facilities } = body;
      if (!key || !facilities) return jsonResponse(400, { error: 'key and facilities required' });
      try {
        let cache = {};
        try {
          const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'search_cache.json'));
          cache = JSON.parse(raw);
        } catch(e) { /* start fresh */ }
        const now = Date.now();
        Object.keys(cache).forEach(function(k) {
          if (now - new Date(cache[k].ts).getTime() > 30 * 24 * 60 * 60 * 1000) delete cache[k];
        });
        cache[key] = { facilities: facilities, ts: new Date().toISOString() };
        await putText(getBlobUrl(sasToken, 'app-state', 'search_cache.json'), JSON.stringify(cache), 'application/json');
        return jsonResponse(200, { success: true, cached_searches: Object.keys(cache).length });
      } catch(err) {
        return jsonResponse(500, { error: 'Search cache set failed', detail: err.message });
      }
    }
    return jsonResponse(404, { error: 'Unknown action: ' + action });

  } catch(topErr) {
    return jsonResponse(500, { error: 'Router crash', detail: topErr.message, stack: topErr.stack });
  }
};
