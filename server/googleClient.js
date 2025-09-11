// server/googleClient.js
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

export function getGoogleAuth() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './google-service-account.json';
  const fullPath = path.resolve(keyFile);
  if (!fs.existsSync(fullPath)) throw new Error(`Service account key file not found: ${fullPath}`);

  const auth = new google.auth.GoogleAuth({
    keyFile: fullPath,
    scopes: [
      'https://www.googleapis.com/auth/drive.file', // create files in drive
      'https://www.googleapis.com/auth/drive', // if you need broader drive access
      'https://www.googleapis.com/auth/spreadsheets'
    ],
  });
  return auth;
}

export async function getDriveClient() {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  return google.drive({ version: 'v3', auth: client });
}

export async function getSheetsClient() {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}
