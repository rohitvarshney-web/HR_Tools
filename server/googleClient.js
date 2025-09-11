// server/googleClient.js
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

function getAuth() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || path.resolve(__dirname, './google-service-account.json');
  if (!fs.existsSync(keyFile)) {
    throw new Error(`Service account key file not found at ${keyFile}`);
  }
  return new google.auth.GoogleAuth({
    keyFile,
    scopes: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/spreadsheets'
    ]
  });
}

async function getDriveClient() {
  const auth = getAuth();
  const client = await auth.getClient();
  return google.drive({ version: 'v3', auth: client });
}

async function getSheetsClient() {
  const auth = getAuth();
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

module.exports = { getDriveClient, getSheetsClient };
