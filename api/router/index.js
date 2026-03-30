const { app } = require('@azure/functions');
const https = require('https');

function jsonResponse(status, obj) {
  return {
    status: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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

function getBlobUrl(sasToken, container, blobName) {
  return 'https://carepathiqdata.blob.core.windows.net/' + container + '/' + blobName + sasToken;
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
      path:     urlObj.pathname + urlObj.search,
      method:   'PUT',
      headers: {
        'Content-Type':   contentType,
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

let qhinCache = null, qhinCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

app.http('router', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN || '';

    context.log('Router: ' + request.method + ' action=' + action);

    // ── debug ─────────────────────────────────────────────────────────────────
    if (action === 'debug') {
      return jsonResponse(200, {
        hasSasToken: sasToken.length > 0,
        sasLength: sasToken.length,
        nodeVersion: process.version,
        qhinCached: qhinCache ? qhinCache.length : 0,
        action: action,
        fullUrl: request.url
      });
    }

    // ── npi-proxy ─────────────────────────────────────────────────────────────
    if (action === 'npi-proxy') {
      const npiParams = new URLSearchParams(url.searchParams);
      npiParams.delete('action');
      const qs = '?' + npiParams.toString();
      try {
        const data = await fetchText('https://npiregistry.cms.hhs.gov/api/' + qs);
        return { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: data };
      } catch(err) {
        return jsonResponse(502, { error: 'NPI failed', detail: err.message });
      }
    }

    // ── geocode-proxy ─────────────────────────────────────────────────────────
    if (action === 'geocode-proxy') {
      const gParams = new URLSearchParams(url.searchParams);
      gParams.delete('action');
      const params = Object.fromEntries(gParams.entries());
      const qs2    = gParams.toString() + '&format=json';
      const isRev  = !!params.lat;
      const gUrl   = 'https://nominatim.openstreetmap.org/' + (isRev ? 'reverse?' : 'search?') + qs2;
      try {
        const data = await fetchText(gUrl, { 'User-Agent': 'CarePathIQ/1.0', 'Accept-Language': 'en' });
        return { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: data };
      } catch(err) {
        return jsonResponse(502, { error: 'Geocode failed', detail: err.message });
      }
    }

    // ── qhin-data ─────────────────────────────────────────────────────────────
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

    // ── convert-qhin ──────────────────────────────────────────────────────────
    if (action === 'convert-qhin') {
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
        if (iName < 0 || iLat < 0 || iLon < 0) return jsonResponse(400, { error: 'Columns not found', found: headers.join(', ') });
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
              name: name,
              address:  iAddr  >= 0 ? (cols[iAddr]  || '').trim() : '',
              city:     iCity  >= 0 ? (cols[iCity]  || '').trim() : '',
              state:    iState >= 0 ? (cols[iState] || '').trim() : '',
              postcode: iZip   >= 0 ? (cols[iZip]   || '').trim() : ''
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

    // ── state-load ────────────────────────────────────────────────────────────
    if (action === 'state-load') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const raw = await fetchText(getBlobUrl(sasToken, 'app-state', 'shared-state.json'));
        return { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: raw };
      } catch(err) {
        if (err.message && err.message.startsWith('404')) {
          return jsonResponse(200, { overrides: {}, customSystems: [], excluded: [] });
        }
        return jsonResponse(502, { error: 'State load failed', detail: err.message });
      }
    }

    // ── state-save ────────────────────────────────────────────────────────────
    if (action === 'state-save') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const body = await request.text();
        JSON.parse(body);
        await putText(getBlobUrl(sasToken, 'app-state', 'shared-state.json'), body, 'application/json');
        return jsonResponse(200, { success: true });
      } catch(err) {
        return jsonResponse(500, { error: 'State save failed', detail: err.message });
      }
    }

    // ── icon-load ─────────────────────────────────────────────────────────────
    if (action === 'icon-load') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const system = url.searchParams.get('system') || 'default';
      const blobName = 'icon-' + system.replace(/[^a-z0-9-]/g, '_');
      try {
        const iconUrl = 'https://carepathiqdata.blob.core.windows.net/logos/' + blobName + sasToken;
        const buffer  = await fetchBinary(iconUrl);
        if (!buffer || buffer.length === 0) return jsonResponse(200, { dataUrl: null });
        const dataUrl = 'data:image/png;base64,' + buffer.toString('base64');
        return jsonResponse(200, { dataUrl: dataUrl });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) return jsonResponse(200, { dataUrl: null });
        return jsonResponse(502, { error: 'Icon load failed', detail: err.message });
      }
    }

    // ── icon-save ─────────────────────────────────────────────────────────────
    if (action === 'icon-save') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const system = url.searchParams.get('system') || 'default';
      const blobName = 'icon-' + system.replace(/[^a-z0-9-]/g, '_');
      try {
        const dataUrl = await request.text();
        const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
        if (!matches) return jsonResponse(400, { error: 'Invalid data URL', start: dataUrl.substring(0, 50) });
        const buffer  = Buffer.from(matches[2], 'base64');
        const iconUrl = 'https://carepathiqdata.blob.core.windows.net/logos/' + blobName + sasToken;
        await putBinary(iconUrl, buffer, matches[1]);
        return jsonResponse(200, { success: true, bytes: buffer.length, system: system });
      } catch(err) {
        return jsonResponse(500, { error: 'Icon save failed', detail: err.message });
      }
    }

    // ── icon-clear ────────────────────────────────────────────────────────────
    if (action === 'icon-clear') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      const system = url.searchParams.get('system') || 'default';
      const blobName = 'icon-' + system.replace(/[^a-z0-9-]/g, '_');
      try {
        const iconUrl = 'https://carepathiqdata.blob.core.windows.net/logos/' + blobName + sasToken;
        await putBinary(iconUrl, Buffer.alloc(0), 'image/png');
        return jsonResponse(200, { success: true });
      } catch(err) {
        return jsonResponse(500, { error: 'Icon clear failed', detail: err.message });
      }
    }

    // ── build-cms ─────────────────────────────────────────────────────────────
    // One-time function: downloads CMS data and saves to Blob Storage
    if (action === 'build-cms') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      context.log('Building CMS data...');

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
        // Download CMS Provider of Services file
        context.log('Downloading CMS data...');
        const cmsUrl = 'https://data.cms.gov/api/1/datastore/query/f36c7bbc-82e8-4cfd-9a0d-5e9f5f9c49a0/0?results_format=csv&limit=100000&offset=0';
        const raw = await fetchText(cmsUrl);
        context.log('Downloaded ' + raw.length + ' bytes');

        // Parse CSV
        const lines = raw.split('\n');
        const headers = parseCSVLine(lines[0]);
        context.log('Columns: ' + headers.slice(0,10).join(', ') + '...');

        function col(row, ...names) {
          for (var i = 0; i < names.length; i++) {
            var idx = headers.indexOf(names[i]);
            if (idx >= 0 && row[idx]) return row[idx].trim();
          }
          return '';
        }

        var facilities = [];
        var skipped = 0;

        for (var i = 1; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          var row = parseCSVLine(line);

          var name  = col(row, 'FAC_NAME', 'PRVDR_NM', 'NAME');
          var lat   = parseFloat(col(row, 'LAT_CD', 'LATITUDE', 'lat'));
          var lon   = parseFloat(col(row, 'LONG_CD', 'LONGITUDE', 'lon'));
          var state = col(row, 'STATE_CD', 'STATE');
          var zip   = col(row, 'ZIP_CD', 'ZIP');
          var city  = col(row, 'CITY_NAME', 'CITY');
          var addr  = col(row, 'ST_ADR', 'ADDRESS');
          var type  = col(row, 'PRVDR_CTGRY_CD', 'PROVIDER_TYPE');
          var ccn   = col(row, 'PRVDR_NUM', 'CCN');

          if (!name || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) {
            skipped++;
            continue;
          }

          facilities.push({
            id: 'cms_' + (ccn || i),
            type: 'cms',
            lat: lat, lon: lon,
            _facType: PROVIDER_TYPE_MAP[type] || 'clinic',
            tags: { name: name, address: addr, city: city, state: state, postcode: zip }
          });
        }

        context.log('Parsed ' + facilities.length + ' facilities, skipped ' + skipped);

        // Group by state
        var byState = {};
        facilities.forEach(function(f) {
          var st = f.tags.state || 'XX';
          if (!byState[st]) byState[st] = [];
          byState[st].push(f);
        });

        var output = JSON.stringify({ total: facilities.length, built: new Date().toISOString(), by_state: byState });
        var url = 'https://carepathiqdata.blob.core.windows.net/cms-data/cms_providers.json' + sasToken;
        await putText(url, output, 'application/json');

        return jsonResponse(200, { success: true, facilities: facilities.length, skipped: skipped, states: Object.keys(byState).length });

      } catch(err) {
        context.log.error('CMS build error: ' + err.message);
        return jsonResponse(500, { error: 'CMS build failed', detail: err.message });
      }
    }

    // ── cms-data ──────────────────────────────────────────────────────────────
    if (action === 'cms-data') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const url = 'https://carepathiqdata.blob.core.windows.net/cms-data/cms_providers.json' + sasToken;
        const raw = await fetchText(url);
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400' },
          body: raw
        };
      } catch(err) {
        if (err.message && err.message.startsWith('404')) {
          return jsonResponse(200, { error: 'CMS data not yet uploaded', total: 0, by_state: {} });
        }
        return jsonResponse(502, { error: 'CMS load failed', detail: err.message });
      }
    }

    // ── logo-load ─────────────────────────────────────────────────────────────
    if (action === 'logo-load') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const logoUrl = 'https://carepathiqdata.blob.core.windows.net/logos/cc-logo' + sasToken;
        const buffer  = await fetchBinary(logoUrl);
        if (!buffer || buffer.length === 0) return jsonResponse(200, { dataUrl: null });
        const dataUrl = 'data:image/png;base64,' + buffer.toString('base64');
        return jsonResponse(200, { dataUrl: dataUrl });
      } catch(err) {
        if (err.message && err.message.startsWith('404')) {
          return jsonResponse(200, { dataUrl: null });
        }
        return jsonResponse(502, { error: 'Logo load failed', detail: err.message });
      }
    }

    // ── logo-save ─────────────────────────────────────────────────────────────
    if (action === 'logo-save') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        const dataUrl = await request.text();
        context.log('Logo save received: ' + dataUrl.length + ' chars, starts with: ' + dataUrl.substring(0, 50));
        const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
        if (!matches) {
          return jsonResponse(400, { 
            error: 'Invalid data URL', 
            received_length: dataUrl.length,
            received_start: dataUrl.substring(0, 100)
          });
        }
        const mimeType = matches[1];
        const buffer   = Buffer.from(matches[2], 'base64');
        context.log('Logo buffer: ' + buffer.length + ' bytes, mime: ' + mimeType);
        const logoUrl  = 'https://carepathiqdata.blob.core.windows.net/logos/cc-logo' + sasToken;
        await putBinary(logoUrl, buffer, mimeType);
        return jsonResponse(200, { success: true, bytes: buffer.length, mime: mimeType });
      } catch(err) {
        context.log.error('Logo save error: ' + err.message);
        return jsonResponse(500, { error: 'Logo save failed', detail: err.message });
      }
    }

    // ── logo-clear ────────────────────────────────────────────────────────────
    if (action === 'logo-clear') {
      if (!sasToken) return jsonResponse(500, { error: 'SAS token not configured' });
      try {
        // Upload empty blob to overwrite
        const logoUrl = 'https://carepathiqdata.blob.core.windows.net/logos/cc-logo' + sasToken;
        await putBinary(logoUrl, Buffer.alloc(0), 'image/png');
        return jsonResponse(200, { success: true });
      } catch(err) {
        return jsonResponse(500, { error: 'Logo clear failed', detail: err.message });
      }
    }

    return jsonResponse(404, { error: 'Unknown action: ' + action });
    } catch(topErr) {
      return jsonResponse(500, { error: 'Router crash', detail: topErr.message, stack: topErr.stack });
    }
  }
});
