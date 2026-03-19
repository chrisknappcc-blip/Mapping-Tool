const { app } = require('@azure/functions');
const https = require('https');

app.http('state-save', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log('Saving shared state');

    const sasToken    = process.env.AZURE_STORAGE_SAS_TOKEN || '';
    const accountName = 'carepathiqdata';

    if (!sasToken) {
      return jsonResponse(500, { error: 'SAS token not configured' });
    }

    try {
      const body    = await request.text();
      const state   = JSON.parse(body);
      const content = JSON.stringify(state);
      const url     = 'https://' + accountName + '.blob.core.windows.net/app-state/shared-state.json' + sasToken;

      await putText(url, content, 'application/json');
      context.log('Saved shared state');
      return jsonResponse(200, { success: true });

    } catch(err) {
      context.log.error('State save error: ' + err.message);
      return jsonResponse(500, { error: 'Failed to save state', detail: err.message });
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
        else reject(new Error('PUT returned ' + res.statusCode + ': ' + raw.substring(0, 200)));
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}
