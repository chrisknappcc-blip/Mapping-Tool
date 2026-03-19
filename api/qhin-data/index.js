const { app } = require('@azure/functions');
const https = require('https');
const crypto = require('crypto');

app.http('qhin-data', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    context.log('QHIN data requested');

    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) {
      return jsonResponse(500, { error: 'Storage connection not configured' });
    }

    try {
      const { accountName, accountKey } = parseConnStr(connStr);
      const container = 'qhin-data';
      const blob      = 'facilities.json';

      const data = await getBlobText(accountName, accountKey, container, blob);
      const facilities = JSON.parse(data);

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
      return jsonResponse(502, { error: 'Failed to load QHIN data', detail: err.message });
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

function parseConnStr(connStr) {
  const parts = {};
  connStr.split(';').forEach(function(part) {
    const idx = part.indexOf('=');
    if (idx > 0) parts[part.substring(0, idx)] = part.substring(idx + 1);
  });
  return {
    accountName: parts['AccountName'],
    accountKey:  parts['AccountKey']
  };
}

function getBlobText(accountName, accountKey, container, blobName) {
  return new Promise(function(resolve, reject) {
    const now     = new Date().toUTCString();
    const version = '2020-10-02';
    const path    = '/' + container + '/' + blobName;

    const stringToSign = [
      'GET', '', '', '', '', '', '', '', '', '', '', '',
      'x-ms-date:' + now + '\nx-ms-version:' + version,
      '/' + accountName + path
    ].join('\n');

    const sig = crypto.createHmac('sha256', Buffer.from(accountKey, 'base64'))
                      .update(stringToSign, 'utf8')
                      .digest('base64');

    const auth = 'SharedKey ' + accountName + ':' + sig;
    const host = accountName + '.blob.core.windows.net';

    const options = {
      hostname: host,
      path:     path,
      method:   'GET',
      headers: {
        'x-ms-date':    now,
        'x-ms-version': version,
        'Authorization': auth
      }
    };

    https.get(options, function(res) {
      let raw = '';
      res.on('data', function(chunk) { raw += chunk; });
      res.on('end', function() {
        if (res.statusCode === 200) {
          resolve(raw);
        } else {
          reject(new Error('Blob storage returned ' + res.statusCode + ': ' + raw.substring(0, 200)));
        }
      });
    }).on('error', reject);
  });
}
