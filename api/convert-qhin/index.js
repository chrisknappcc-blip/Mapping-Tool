const { app } = require('@azure/functions');
const https = require('https');

const CSV_FILENAME    = 'facilities.csv';
const JSON_FILENAME   = 'facilities.json';
const ACCOUNT_NAME    = 'carepathiqdata';
const CONTAINER       = 'qhin-data';

app.http('convert-qhin', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log('QHIN CSV conversion started');

    const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN || '';
    if (!sasToken) {
      return jsonResponse(500, { error: 'SAS token not configured' });
    }

    const baseUrl = 'https://' + ACCOUNT_NAME + '.blob.core.windows.net/' + CONTAINER + '/';

    try {
      // Download CSV
      const csvUrl = baseUrl + CSV_FILENAME + sasToken;
      context.log('Downloading CSV...');
      const raw = await fetchText(csvUrl);
      context.log('Downloaded ' + raw.length + ' bytes');

      // Parse CSV
      const lines   = raw.split('\n');
      const headers = parseCSVLine(lines[0]);
      context.log('Columns: ' + headers.join(', '));

      function colIdx(name) {
        return headers.findIndex(function(h) {
          return h.toLowerCase().trim() === name.toLowerCase();
        });
      }

      const iName  = colIdx('DisplayName');
      const iLat   = colIdx('Latitude');
      const iLon   = colIdx('Longitude');
      const iAddr  = colIdx('Address');
      const iCity  = colIdx('City');
      const iState = colIdx('State');
      const iZip   = colIdx('ZipCode');
      const iOrg   = colIdx('OrganizationId');

      context.log('name=' + iName + ' lat=' + iLat + ' lon=' + iLon);

      if (iName < 0 || iLat < 0 || iLon < 0) {
        return jsonResponse(400, {
          error: 'Required columns not found',
          found: headers.join(', ')
        });
      }

      var facilities = [];
      var skipped    = 0;

      for (var i = 1; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        var cols = parseCSVLine(line);
        var name = (cols[iName] || '').trim();
        var lat  = parseFloat(cols[iLat]);
        var lon  = parseFloat(cols[iLon]);

        if (!name || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) {
          skipped++;
          continue;
        }

        facilities.push({
          id:   'qhin_' + (iOrg >= 0 ? (cols[iOrg] || i) : i),
          type: 'excel',
          lat:  lat,
          lon:  lon,
          tags: {
            name:     name,
            address:  iAddr  >= 0 ? (cols[iAddr]  || '').trim() : '',
            city:     iCity  >= 0 ? (cols[iCity]  || '').trim() : '',
            state:    iState >= 0 ? (cols[iState] || '').trim() : '',
            postcode: iZip   >= 0 ? (cols[iZip]   || '').trim() : ''
          },
          _embeddedSystem: '',
          _facType: ''
        });
      }

      context.log('Converted ' + facilities.length + ' facilities, skipped ' + skipped);

      // Upload facilities.json via PUT
      const jsonString = JSON.stringify(facilities);
      const jsonUrl    = baseUrl + JSON_FILENAME + sasToken;
      await putText(jsonUrl, jsonString, 'application/json');

      context.log('Saved facilities.json (' + (jsonString.length / 1024 / 1024).toFixed(1) + ' MB)');

      return jsonResponse(200, {
        success: true,
        facilities: facilities.length,
        skipped: skipped,
        message: 'facilities.json saved to qhin-data container'
      });

    } catch (err) {
      context.log.error('Conversion error: ' + err.message);
      return jsonResponse(500, { error: 'Conversion failed', detail: err.message });
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
        else reject(new Error('GET returned ' + res.statusCode + ': ' + raw.substring(0, 300)));
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
        else reject(new Error('PUT returned ' + res.statusCode + ': ' + raw.substring(0, 300)));
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

function parseCSVLine(line) {
  var result = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === '\t') && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
