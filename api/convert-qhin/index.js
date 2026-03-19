const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

const CSV_FILENAME = 'facilities.csv';

app.http('convert-qhin', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log('QHIN CSV conversion started');

    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) {
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Storage connection not configured' })
      };
    }

    try {
      const blobClient = BlobServiceClient.fromConnectionString(connStr);
      const container  = blobClient.getContainerClient('qhin-data');

      context.log('Downloading ' + CSV_FILENAME);
      const csvBlob = container.getBlobClient(CSV_FILENAME);
      const exists  = await csvBlob.exists();
      if (!exists) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'CSV file not found: ' + CSV_FILENAME })
        };
      }

      const download = await csvBlob.download();
      const raw      = await streamToString(download.readableStreamBody);

      context.log('Parsing CSV...');
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

      context.log('Column indices: name=' + iName + ' lat=' + iLat + ' lon=' + iLon);

      if (iName < 0 || iLat < 0 || iLon < 0) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Required columns not found',
            detail: 'Need DisplayName, Latitude, Longitude. Found: ' + headers.join(', ')
          })
        };
      }

      var facilities = [];
      var skipped    = 0;

      for (var i = 1; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        var cols = parseCSVLine(line);
        var name = iName >= 0 ? (cols[iName] || '').trim() : '';
        var lat  = iLat  >= 0 ? parseFloat(cols[iLat])  : NaN;
        var lon  = iLon  >= 0 ? parseFloat(cols[iLon])  : NaN;

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

      const jsonBlob   = container.getBlockBlobClient('facilities.json');
      const jsonString = JSON.stringify(facilities);
      const jsonBuffer = Buffer.from(jsonString, 'utf8');

      await jsonBlob.uploadData(jsonBuffer, {
        blobHTTPHeaders: { blobContentType: 'application/json' }
      });

      context.log('Saved facilities.json (' + (jsonBuffer.length / 1024 / 1024).toFixed(1) + ' MB)');

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          facilities: facilities.length,
          skipped: skipped,
          message: 'facilities.json saved to qhin-data container'
        })
      };

    } catch (err) {
      context.log.error('Conversion error: ' + err.message);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Conversion failed', detail: err.message })
      };
    }
  }
});

function parseCSVLine(line) {
  var result = [];
  var current = '';
  var inQuotes = false;

  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === ',' || ch === '\t') && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function streamToString(stream) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    stream.on('data', function (chunk) { chunks.push(chunk.toString()); });
    stream.on('end',  function () { resolve(chunks.join('')); });
    stream.on('error', reject);
  });
}
