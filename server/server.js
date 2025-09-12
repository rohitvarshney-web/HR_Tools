// server.js
// Full backend: OAuth (Google), file upload -> Drive, append -> Google Sheets,
// simple JSON file persistence for openings/responses/users, JWT auth.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const stream = require('stream'); // used for Drive uploads

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-secret';

// Paths & storage
const DATA_DIR = path.resolve(__dirname, 'server_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// Ensure a default data file
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const base = { openings: [], responses: [], users: [] };
      fs.writeFileSync(DATA_FILE, JSON.stringify(base, null, 2));
      return base;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    console.error('readData err', err);
    return { openings: [], responses: [], users: [] };
  }
}
function writeData(obj) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}

// --- Google config (folder / sheet IDs)
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Scopes required
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
];

// --- BEGIN improved Google auth & upload helpers ---
// Supports either:
//  - GOOGLE_SERVICE_ACCOUNT_CREDS (JSON string) OR
//  - GOOGLE_SERVICE_ACCOUNT_FILE (path to JSON file on disk)
let googleCredsObj = null;
let googleAuthClient = null;

function loadServiceAccount() {
  if (googleCredsObj) return googleCredsObj;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDS) {
    try {
      googleCredsObj = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDS);
      console.log('Loaded GOOGLE_SERVICE_ACCOUNT_CREDS from env. service_account_email=', googleCredsObj.client_email);
      return googleCredsObj;
    } catch (err) {
      console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_CREDS', err && err.message);
      throw err;
    }
  }

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (keyFile && fs.existsSync(keyFile)) {
    try {
      const raw = fs.readFileSync(keyFile, 'utf8');
      googleCredsObj = JSON.parse(raw);
      console.log('Loaded GOOGLE_SERVICE_ACCOUNT_FILE from disk. service_account_email=', googleCredsObj.client_email);
      return googleCredsObj;
    } catch (err) {
      console.error('Failed to read/parse GOOGLE_SERVICE_ACCOUNT_FILE at', keyFile, err && err.message);
      throw err;
    }
  }

  console.warn('No Google service account credentials found. Set GOOGLE_SERVICE_ACCOUNT_CREDS or GOOGLE_SERVICE_ACCOUNT_FILE');
  return null;
}

function getGoogleAuth() {
  if (googleAuthClient) return googleAuthClient;
  const creds = loadServiceAccount();
  if (!creds) throw new Error('No Google service account credentials available');

  googleAuthClient = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
  });

  return googleAuthClient;
}

async function getDriveService() {
  const auth = getGoogleAuth();
  await auth.authorize(); // ensures tokens
  return google.drive({ version: 'v3', auth });
}

async function getSheetsService() {
  const auth = getGoogleAuth();
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// Improved upload that logs fileId and link and returns webViewLink
async function uploadToDrive(fileBuffer, filename, mimeType = 'application/octet-stream') {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID not set');
  const creds = loadServiceAccount();
  if (!creds) throw new Error('Google creds missing');

  const drive = await getDriveService();

  // convert buffer to stream
  const bufferStream = new stream.PassThrough();
  bufferStream.end(Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer));

  console.log(`Uploading file to Drive: name=${filename} size=${(fileBuffer ? fileBuffer.length : 0)} mime=${mimeType} folder=${DRIVE_FOLDER_ID}`);

  const createRes = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [DRIVE_FOLDER_ID],
    },
    media: {
      mimeType,
      body: bufferStream,
    },
    fields: 'id, webViewLink, webContentLink'
  });

  const fileId = createRes.data && createRes.data.id;
  console.log('Drive upload created fileId=', fileId);

  // try to set permission to anyone with link
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
    console.log('Drive permission set to anyone (reader) for fileId=', fileId);
  } catch (err) {
    console.warn('drive.permissions.create failed for fileId=', fileId, 'error=', err && err.message);
    // not fatal: file may still be accessible by accounts with access to folder
  }

  // get metadata to retrieve webViewLink reliably
  try {
    const meta = await drive.files.get({ fileId, fields: 'id, webViewLink, webContentLink' });
    const link = meta.data.webViewLink || meta.data.webContentLink || `https://drive.google.com/file/d/${fileId}/view`;
    console.log('Drive file accessible at', link);
    return link;
  } catch (err) {
    console.warn('drive.files.get failed for fileId=', fileId, 'err=', err && err.message);
    return `https://drive.google.com/file/d/${fileId}/view`;
  }
}
// --- END improved Google auth & upload helpers ---

// --- Helpers: Append row to Google Sheet
async function appendToSheet(sheetId, valuesArray) {
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set');
  const sheets = await getSheetsService();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:Z', // adjust sheet name if different
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [valuesArray]
    }
  });
  return res.status === 200 || res.status === 201;
}

// --- Multer setup (memory storage)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// --- JWT helpers
function signUserToken(user) {
  const payload = { id: user.id, email: user.email, role: user.role || 'recruiter' };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'missing_auth' });
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'invalid_auth_format' });
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_or_expired_token' });
  }
}

// --- Passport Google OAuth (stateless redirect)
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_OAUTH_CALLBACK || `${FRONTEND_URL}/auth/google/callback`
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const data = readData();
      const email = profile.emails && profile.emails[0] && profile.emails[0].value;
      let user = data.users.find(u => u.email === email);
      if (!user) {
        user = {
          id: `u_${Date.now()}`,
          email,
          name: profile.displayName || '',
          role: 'recruiter',
          createdAt: new Date().toISOString()
        };
        data.users.push(user);
        writeData(data);
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
  app.use(passport.initialize());
} else {
  console.warn('Google OAuth not configured: GOOGLE_OAUTH_CLIENT_ID/SECRET missing');
}

// --- OAuth routes
app.get('/auth/google', (req, res, next) => {
  if (!passport._strategy('google')) return res.status(500).json({ error: 'oauth_not_configured' });
  // state or return_to can be added if needed
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// callback: issue JWT and redirect to frontend with token
app.get('/auth/google/callback', (req, res, next) => {
  if (!passport._strategy('google')) return res.status(500).json({ error: 'oauth_not_configured' });
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) {
      console.error('OAuth callback error', err);
      return res.status(500).json({ error: 'oauth_failed' });
    }
    const token = signUserToken(user);
    // Redirect to frontend with token in query string
    const redirectTo = `${FRONTEND_URL}?token=${encodeURIComponent(token)}`;
    return res.redirect(redirectTo);
  })(req, res, next);
});

// --- API: get current user
app.get('/api/me', authMiddleware, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.user.id || u.email === req.user.email);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  // do not return secret fields
  return res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// --- Openings CRUD (protected)
app.get('/api/openings', authMiddleware, (req, res) => {
  const data = readData();
  return res.json(data.openings || []);
});

app.post('/api/openings', authMiddleware, (req, res) => {
  const payload = req.body || {};
  const data = readData();
  const op = {
    id: `op_${Date.now()}`,
    title: payload.title || 'Untitled',
    location: payload.location || 'Remote',
    department: payload.department || '',
    preferredSources: Array.isArray(payload.preferredSources) ? payload.preferredSources : (payload.preferredSources ? payload.preferredSources.split(',') : []),
    durationMins: payload.durationMins || 30,
    createdAt: new Date().toISOString()
  };
  data.openings.unshift(op);
  writeData(data);
  return res.json(op);
});

app.put('/api/openings/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const data = readData();
  const idx = data.openings.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: 'opening_not_found' });
  const cur = data.openings[idx];
  const fields = ['title','location','department','preferredSources','durationMins'];
  fields.forEach(f => { if (req.body[f] !== undefined) cur[f] = req.body[f]; });
  data.openings[idx] = cur;
  writeData(data);
  return res.json(cur);
});

app.delete('/api/openings/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const data = readData();
  data.openings = data.openings.filter(o => o.id !== id);
  data.responses = data.responses.filter(r => r.openingId !== id);
  writeData(data);
  return res.json({ ok: true });
});

// --- Responses (protected)
app.get('/api/responses', authMiddleware, (req, res) => {
  const data = readData();
  return res.json(data.responses || []);
});

// --- Public apply endpoint (no auth) -> upload resume to Drive, append row to sheet, persist locally
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  try {
    const openingId = req.query.opening || req.body.opening;
    const src = req.query.src || req.body.src || 'unknown';
    if (!openingId) return res.status(400).json({ error: 'missing opening id' });

    // find opening title optionally
    const data = readData();
    const opening = data.openings.find(o => o.id === openingId);
    const openingTitle = opening ? opening.title : null;

    // handle resume upload
    let resumeLink = null;
    if (req.file && req.file.buffer) {
      const filename = `${Date.now()}_${(req.file.originalname || 'resume')}`;
      try {
        resumeLink = await uploadToDrive(req.file.buffer, filename, req.file.mimetype || 'application/octet-stream');
      } catch (err) {
        console.error('Drive upload failed', err && (err.stack || err.message || err));
        // continue but still try to append row (with empty resume link)
      }
    } else {
      console.log('No file attached with request (req.file empty)');
    }

    // collect answers (all non-file form fields)
    const answers = {};
    // req.body holds fields (Multer merges fields into body)
    Object.keys(req.body || {}).forEach(k => { answers[k] = req.body[k]; });

    // persist response locally
    const resp = {
      id: `resp_${Date.now()}`,
      openingId,
      openingTitle,
      source: src,
      resumeLink: resumeLink || null,
      answers,
      createdAt: new Date().toISOString()
    };
    data.responses.unshift(resp);
    writeData(data);

    // append to Google Sheet (best-effort)
    try {
      const row = [ new Date().toISOString(), openingId, openingTitle || '', src, resumeLink || '', JSON.stringify(answers) ];
      if (SHEET_ID) {
        await appendToSheet(SHEET_ID, row);
        console.log('Appended row to sheet', SHEET_ID);
      } else {
        console.warn('SHEET_ID not set, skipping appendToSheet');
      }
    } catch (err) {
      console.error('appendToSheet error', err && (err.stack || err.message || err));
    }

    return res.json({ ok: true, resumeLink });
  } catch (err) {
    console.error('Error in /api/apply', err && (err.stack || err.message || err));
    return res.status(500).json({ error: 'server_error', message: err?.message || 'unknown' });
  }
});

// --- Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// --- Start server
app.listen(PORT, () => {
  console.log(`Backend listening on ${PORT}`);
});
