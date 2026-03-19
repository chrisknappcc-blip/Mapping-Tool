const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');
const XLSX = require('xlsx');

const EXCEL_FILENAME = 'networklocations_carepathiqtool_geocoded_geocoded.xlsx';

const COL_ALIASES = {
  name:    ['name','displayname','display name','facility','facility name',
            'provider','provider name','practice','location','site','hospital','clinic',
            'organizationname','organization name','legalname','legal name'],
  lat:     ['lat','latitude','lat_dd','y','latitude_dd'],
  lon:     ['lon','lng','longitude','long','lon_dd','x','longitude_dd'],
  system:  ['system','health system','parent system','organization','org','network','group'],
  address: ['address','street','addr','street address','address1','address_1'],
  city:    ['city','city name'],
  state:   ['state','st','state_cd','state code'],
  zip:     ['zip','zipcode','zip code','postal','postal code','postcode'],
  type:    ['type','facility type','provider type','category']
};

function findCol(headers, field) {
  var aliases = COL_ALIASES[field] || [];
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i].toString().toLowerCase().trim();
    if (aliases.indexOf(h) >= 0) return headers[i];
  }
  return null;
}

app.http('convert-qhin', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log('QHIN conversion started');

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

      // Download the Excel file
      context.log('Downloading ' + EXCEL_FILENAME);
      const excelBlob = container.getBlobClient(EXCEL_FILENAME);
      const exists = await excelBlob.exists();
      if (!exists) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Excel file not found: ' + EXCEL_FILENAME })
        };
      }

      const download = await excelBlob.download();
      const buffer   = await streamToBuffer(download.readableStreamBody);

      // Parse Excel
      context.log('Parsing Excel...');
      const workbook  = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet     = workbook.Sheets[sheetName];
      const rows      = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!rows.length) {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Excel file appears empty' })
        };
      }

      const headers = Object.keys(rows[0]);
      context.log('Columns found: ' + headers.join(', '));

      const colName  = findCol(headers, 'name');
      const colLat   = findCol(headers, 'lat');
      const colLon   = findCol(headers, 'lon');
      const colSys   = findCol(headers, 'system');
      const colAddr  = findCol(headers, 'address');
      const colCity  = findCol(headers, 'city');
      const colState = findCol(headers, 'state');
      const colZip   = findCol(headers, 'zip');
      const colType  = findCol(headers, 'type');

      context.log('Mapped columns: name=' + colName + ' lat=' + colLat + ' lon=' + colLon + ' sys=' + colSys);

      // Convert rows to facility objects
      var facilities = [];
      var skipped = 0;

      rows.forEach(function(row, i) {
        var name = colName ? String(row[colName] || '').trim() : '';
        var lat  = colLat  ? parseFloat(row[colLat])  : NaN;
        var lon  = colLon  ? parseFloat(row[colLon])  : NaN;

        if (!name || isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) {
          skipped++;
          return;
        }

        facilities.push({
          id:   'qhin_' + i,
          type: 'excel',
          lat:  lat,
          lon:  lon,
          tags: {
            name:     name,
            address:  colAddr  ? String(row[colAddr]  || '').trim() : '',
            city:     colCity  ? String(row[colCity]  || '').trim() : '',
            state:    colState ? String(row[colState] || '').trim() : '',
            postcode: colZip   ? String(row[colZip]   || '').trim() : '',
          },
          _embeddedSystem: colSys  ? String(row[colSys]  || '').trim() : '',
          _facType:        colType ? String(row[colType] || '').trim() : ''
        });
      });

      context.log('Converted ' + facilities.length + ' facilities, skipped ' + skipped);

      // Save as facilities.json back to the same container
      const jsonBlob    = container.getBlockBlobClient('facilities.json');
      const jsonString  = JSON.stringify(facilities);
      const jsonBuffer  = Buffer.from(jsonString, 'utf8');

      await jsonBlob.uploadData(jsonBuffer, {
        blobHTTPHeaders: { blobContentType: 'application/json' }
      });

      context.log('Saved facilities.json (' + jsonBuffer.length + ' bytes)');

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

function streamToBuffer(stream) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    stream.on('data', function (chunk) { chunks.push(chunk); });
    stream.on('end',  function () { resolve(Buffer.concat(chunks)); });
    stream.on('error', reject);
  });
}
