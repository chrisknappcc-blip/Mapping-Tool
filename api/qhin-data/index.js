const { app } = require('@azure/functions');
const { BlobServiceClient } = require('@azure/storage-blob');

// In-memory cache so we don't re-parse the Excel on every request
let cachedData = null;
let cacheTime  = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

app.http('qhin-data', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log('QHIN data requested');

    // Return cached data if still fresh
    if (cachedData && (Date.now() - cacheTime) < CACHE_TTL_MS) {
      context.log('Returning cached QHIN data (' + cachedData.length + ' facilities)');
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600'
        },
        body: JSON.stringify({ facilities: cachedData, count: cachedData.length })
      };
    }

    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) {
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Storage connection not configured' })
      };
    }

    try {
      // Connect to blob storage
      const blobClient = BlobServiceClient.fromConnectionString(connStr);
      const container  = blobClient.getContainerClient('qhin-data');
      const blob       = container.getBlobClient('facilities.json');

      // Check the file exists
      const exists = await blob.exists();
      if (!exists) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            error: 'QHIN data not yet uploaded',
            message: 'Upload facilities.json to the qhin-data container in Azure Blob Storage'
          })
        };
      }

      // Download and parse
      const download = await blob.download();
      const raw = await streamToString(download.readableStreamBody);
      const facilities = JSON.parse(raw);

      // Cache it
      cachedData = facilities;
      cacheTime  = Date.now();

      context.log('Loaded ' + facilities.length + ' QHIN facilities from blob storage');

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600'
        },
        body: JSON.stringify({ facilities: facilities, count: facilities.length })
      };

    } catch (err) {
      context.log.error('QHIN data error: ' + err.message);
      return {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to load QHIN data', detail: err.message })
      };
    }
  }
});

function streamToString(stream) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    stream.on('data', function (chunk) { chunks.push(chunk.toString()); });
    stream.on('end',  function () { resolve(chunks.join('')); });
    stream.on('error', reject);
  });
}
