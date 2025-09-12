// server.js
// Backend: OAuth (Google), file upload -> Drive, append -> Google Sheets,
// simple JSON file persistence for openings/responses/users, JWT auth.
//
// This version keeps users on file only and adds detailed path/log debugging
// so you can see exactly which data.json is being read by the running server.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const stream = require('stream');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-secret';
const ADMIN_SECRET = process.env.ADMIN_SECRET || null; // set this for admin/debug endpoints

// --- Data persistence (local JSON file)
// Use override from env if you want to point to a specific file path
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, 'server_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Deterministic data file path (can be overridden with DATA_FILE env)
const DATA_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(DATA_DIR, 'data.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Startup debug logging of environment and paths
console.log('===== Server startup info =====');
console.log('__dirname:', __dirname);
console.log('process.cwd():', process.cwd());
console.log('Resolved DATA_DIR:', DATA_DIR);
console.log('Resolved DATA_FILE:', DATA_FILE);
console.log('UPLOADS_DIR:', UPLOADS_DIR);
console.log('NODE_ENV:', process.env.NODE_ENV || 'not-set');
console.log('ADMIN_SECRET set:', !!ADMIN_SECRET);
console.log('================================');

function safeSlice(s, n = 2000) {
  try { return String(s).slice(0, n); } catch (e) { return '<unable to slice>'; }
}

// readData / writeData with extra logging (shows which file is read and its content preview)
function readData() {
  try {
    console.log('[readData] called. reading file:', DATA_FILE);
    if (!fs.existsSync(DATA_FILE)) {
      console.log('[readData] data file not found. initializing default data.json at', DATA_FILE);
      const base = { openings: [], responses: [], users: [] };
      fs.writeFileSync(DATA_FILE, JSON.stringify(base, null, 2), 'utf8');
      return base;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    if (!raw || raw.trim().length === 0) {
      console.warn('[readData] data file exists but is empty. reinitializing default structure.');
      const base = { openings: [], responses: [], users: [] };
      fs.writeFileSync(DATA_FILE, JSON.stringify(base, null, 2), 'utf8');
      return base;
    }
    console.log('[readData] data file raw (preview):', safeSlice(raw, 2000));
    const parsed = JSON.parse(raw);
    if (!parsed.openings) parsed.openings = [];
    if (!parsed.responses) parsed.responses = [];
    if (!parsed.users) parsed.users = [];
    console.log('[readData] loaded counts -> openings:', parsed.openings.length, 'responses:', parsed.responses.length, 'users:', parsed.users.length);
    return parsed;
  } catch (err) {
    console.error('[readData] ERROR reading/parsing data file:', err && (err.stack || err.message));
    // return a safe default so server remains functional
    return { openings: [], responses: [], users: [] };
  }
}

function writeData(obj) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8');
    console.log('[writeData] wrote data to', DATA_FILE);
  } catch (err) {
    console.error('[writeData] ERROR writing data file:', err && (err.stack || err.message));
    throw err;
  }
}

// serve fallback uploads if Drive fails
app.use('/uploads', express.static(UPLOADS_DIR));

// --- Google / Drive / Sheets config
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
];

let googleAuthInstance = null;
function getAuthClient() {
  if (googleAuthInstance) return googleAuthInstance;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDS) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDS);
      console.log('[getAuthClient] Using GOOGLE_SERVICE_ACCOUNT_CREDS. client_email=', creds.client_email);
      googleAuthInstance = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: SCOPES
      });
      return googleAuthInstance;
    } catch (err) {
      console.error('[getAuthClient] Failed parsing GOOGLE_SERVICE_ACCOUNT_CREDS:', err && err.message);
      throw err;
    }
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    console.log('[getAuthClient] Using GOOGLE_SERVICE_ACCOUNT_FILE:', keyFile);
    if (!fs.existsSync(keyFile)) {
      console.error('[getAuthClient] GOOGLE_SERVICE_ACCOUNT_FILE path does not exist:', keyFile);
      throw new Error('GOOGLE_SERVICE_ACCOUNT_FILE missing on disk: ' + keyFile);
    }
    googleAuthInstance = new google.auth.GoogleAuth({
      keyFile,
      scopes: SCOPES
    });
    return googleAuthInstance;
  }

  throw new Error('No Google service account credentials configured. Set GOOGLE_SERVICE_ACCOUNT_CREDS or GOOGLE_SERVICE_ACCOUNT_FILE');
}

async function getDriveService() {
  const auth = getAuthClient();
  const client = await auth.getClient();
  return google.drive({ version: 'v3', auth: client });
}
async function getSheetsService() {
  const auth = getAuthClient();
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function uploadToDrive(fileBuffer, filename, mimeType = 'application/octet-stream') {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID not set in env');
  const drive = await getDriveService();
  const bufferStream = new stream.PassThrough();
  bufferStream.end(Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer));

  console.log(`[uploadToDrive] Uploading to Drive: name=${filename} size=${(fileBuffer ? fileBuffer.length : 0)} mime=${mimeType} folder=${DRIVE_FOLDER_ID}`);

  const created = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [DRIVE_FOLDER_ID],
    },
    media: {
      mimeType,
      body: bufferStream
    },
    supportsAllDrives: true,
    fields: 'id, webViewLink, webContentLink'
  });

  const fileId = created.data && created.data.id;
  if (!fileId) throw new Error('Drive returned no file id');

  console.log('[uploadToDrive] Drive file created id=', fileId);

  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true
    });
  } catch (err) {
    console.warn('[uploadToDrive] Failed to set "anyone" permission (org policy may block):', err && err.message);
  }

  try {
    const meta = await drive.files.get({ fileId, fields: 'id, webViewLink, webContentLink', supportsAllDrives: true });
    const link = meta.data.webViewLink || meta.data.webContentLink || `https://drive.google.com/file/d/${fileId}/view`;
    console.log('[uploadToDrive] Drive link:', link);
    return link;
  } catch (err) {
    console.warn('[uploadToDrive] drive.files.get failed:', err && err.message);
    return `https://drive.google.com/file/d/${fileId}/view`;
  }
}

// Append row to sheets (anchor at A1 behaviour retained)
async function appendToSheet(sheetId, valuesArray) {
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set in env');
  const sheets = await getSheetsService();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:Z',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [valuesArray] }
  });
  return res.status === 200 || res.status === 201;
}

// Multer (memory)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// JWT helpers
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

// Passport Google OAuth
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_OAUTH_CALLBACK || `${FRONTEND_URL}/auth/google/callback`
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      // Read data file each sign-in attempt so we always use the file on disk (no in-memory cache).
      console.log('[OAuth] sign-in attempt. reading allowlist from file:', DATA_FILE);
      const data = readData(); // readData logs detailed info
      const email = profile.emails && profile.emails[0] && profile.emails[0].value;
      console.log('[OAuth] attempt email=', email, 'profile.id=', profile.id);

      // Normalize emails to lower-case for comparison
      const allowlisted = (data.users || []).filter(u => (u.email || '').toLowerCase() === (email || '').toLowerCase());
      console.log('[OAuth] allowlisted matches found:', allowlisted.length, allowlisted.map(u => u.email));

      if (!allowlisted || allowlisted.length === 0) {
        console.warn('[OAuth] attempt by non-allowlisted email:', email);
        return done(null, false, { message: 'email_not_allowed', email });
      }

      // Use the first match
      let user = allowlisted[0];
      if (!user.id) user.id = `u_${Date.now()}`;
      user.name = user.name || profile.displayName || '';
      user.createdAt = user.createdAt || new Date().toISOString();

      // Ensure the file contains this exact record (update if needed)
      const idx = (data.users || []).findIndex(u => (u.email || '').toLowerCase() === (email || '').toLowerCase());
      if (idx === -1) {
        data.users.push(user);
        writeData(data);
      } else {
        data.users[idx] = user;
        writeData(data);
      }

      return done(null, user);
    } catch (err) {
      console.error('[OAuth] Strategy error:', err && (err.stack || err.message));
      return done(err);
    }
  }));
  app.use(passport.initialize());
} else {
  console.warn('Google OAuth not configured: GOOGLE_OAUTH_CLIENT_ID/SECRET missing');
}

// OAuth routes
app.get('/auth/google', (req, res, next) => {
  if (!passport._strategy('google')) return res.status(500).json({ error: 'oauth_not_configured' });
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!passport._strategy('google')) return res.status(500).json({ error: 'oauth_not_configured' });
  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err) {
      console.error('[OAuth callback] error', err);
      return res.status(500).json({ error: 'oauth_failed' });
    }
    if (!user) {
      console.warn('[OAuth callback] denied:', info);
      const redirectTo = `${FRONTEND_URL}?oauth_error=${encodeURIComponent(info?.message || 'denied')}`;
      return res.redirect(redirectTo);
    }
    const token = signUserToken(user);
    const redirectTo = `${FRONTEND_URL}?token=${encodeURIComponent(token)}`;
    return res.redirect(redirectTo);
  })(req, res, next);
});

// Admin debug endpoints: protected by ADMIN_SECRET header value (x-admin-secret)
function requireAdminSecret(req, res, next) {
  if (!ADMIN_SECRET) return res.status(403).json({ error: 'admin_secret_not_configured' });
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== ADMIN_SECRET) return res.status(403).json({ error: 'invalid_admin_secret' });
  return next();
}

// Debug: return the resolved data file path and parsed contents (protected)
app.get('/admin/debug-datafile', requireAdminSecret, (req, res) => {
  try {
    const exists = fs.existsSync(DATA_FILE);
    const raw = exists ? fs.readFileSync(DATA_FILE, 'utf8') : null;
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
    return res.json({ DATA_FILE, exists, rawPreview: raw ? safeSlice(raw, 2000) : null, parsed });
  } catch (err) {
    return res.status(500).json({ error: 'failed', message: err && err.message });
  }
});

// Admin: list users (protected)
app.get('/admin/users', requireAdminSecret, (req, res) => {
  const data = readData();
  return res.json({ users: data.users || [] });
});

// Admin: add user to allowlist (protected) - body: { email, name, role }
app.post('/admin/users', requireAdminSecret, (req, res) => {
  const { email, name, role } = req.body || {};
  if (!email) return res.status(400).json({ error: 'missing_email' });
  const data = readData();
  if (!data.users) data.users = [];
  const emailLower = (email || '').toLowerCase();
  const existing = data.users.find(u => (u.email || '').toLowerCase() === emailLower);
  if (existing) return res.status(409).json({ error: 'user_exists', user: existing });
  const u = { id: `u_${Date.now()}`, email, name: name || '', role: role || 'recruiter', createdAt: new Date().toISOString() };
  data.users.push(u);
  writeData(data);
  console.log('[admin] added allowlist user:', u.email);
  return res.json({ ok: true, user: u });
});

// API: get current user
app.get('/api/me', authMiddleware, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.user.id || u.email === req.user.email);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  return res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// Openings CRUD (protected)
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

app.get('/api/responses', authMiddleware, (req, res) => {
  const data = readData();
  return res.json(data.responses || []);
});

// Public apply endpoint -> upload resume to Drive, append to Sheet, persist locally
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  try {
    const openingId = req.query.opening || req.body.opening;
    const src = req.query.src || req.body.src || 'unknown';
    if (!openingId) return res.status(400).json({ error: 'missing opening id' });

    const data = readData();
    const opening = data.openings.find(o => o.id === openingId);
    const openingTitle = opening ? opening.title : null;

    // Resume upload
    let resumeLink = null;
    if (req.file && req.file.buffer) {
      const filename = `${Date.now()}_${(req.file.originalname || 'resume')}`;
      try {
        resumeLink = await uploadToDrive(req.file.buffer, filename, req.file.mimetype || 'application/octet-stream');
        console.log('Drive upload success, resumeLink=', resumeLink);
      } catch (err) {
        console.error('Drive upload failed:', err && (err.stack || err.message));
        try {
          const localPath = path.join(UPLOADS_DIR, filename);
          fs.writeFileSync(localPath, req.file.buffer);
          const host = req.get('host');
          const protocol = req.protocol;
          resumeLink = `${protocol}://${host}/uploads/${encodeURIComponent(filename)}`;
          console.log('Saved fallback file locally at', localPath, '->', resumeLink);
        } catch (fsErr) {
          console.error('Failed to save fallback file locally', fsErr && (fsErr.stack || fsErr.message));
        }
      }
    } else {
      console.log('No resume file in submission (req.file empty)');
    }

    // collect non-file fields
    const answers = {};
    Object.keys(req.body || {}).forEach(k => { answers[k] = req.body[k]; });

    // persist locally
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

    // Append to sheet (best-effort)
    try {
      const row = [ new Date().toISOString(), openingId, openingTitle || '', src, resumeLink || '', JSON.stringify(answers) ];
      if (SHEET_ID) {
        await appendToSheet(SHEET_ID, row);
        console.log('Appended row to sheet', SHEET_ID);
      } else {
        console.warn('SHEET_ID not set; skipping appendToSheet');
      }
    } catch (err) {
      console.error('appendToSheet error', err && (err.stack || err.message));
    }

    return res.json({ ok: true, resumeLink });
  } catch (err) {
    console.error('Error in /api/apply', err && (err.stack || err.message));
    return res.status(500).json({ error: 'server_error', message: err?.message || 'unknown' });
  }
});

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Backend listening on ${PORT}`);
});
