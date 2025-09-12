// server.js
// Backend: OAuth (Google), file upload -> Drive, append -> Google Sheets,
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
const stream = require('stream');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-secret';

// --- Data persistence (local JSON file)
const DATA_DIR = path.resolve(__dirname, 'server_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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

// serve fallback uploads if Drive fails
app.use('/uploads', express.static(UPLOADS_DIR));

// --- Google / Drive / Sheets config
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Scopes needed
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
];

// Auth client cache
let googleAuthInstance = null;

/**
 * getAuthClient:
 * - If GOOGLE_SERVICE_ACCOUNT_CREDS is set (JSON string), parse and use credentials.
 * - Else if GOOGLE_SERVICE_ACCOUNT_FILE is set, use keyFile.
 * - Else throw.
 *
 * Returns a GoogleAuth instance.
 */
function getAuthClient() {
  if (googleAuthInstance) return googleAuthInstance;

  // Option 1: JSON creds in env var
  if (process.env.GOOGLE_SERVICE_ACCOUNT_CREDS) {
    try {
      const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDS);
      console.log('Using GOOGLE_SERVICE_ACCOUNT_CREDS (env JSON). client_email=', creds.client_email);
      googleAuthInstance = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: SCOPES
      });
      return googleAuthInstance;
    } catch (err) {
      console.error('Failed parsing GOOGLE_SERVICE_ACCOUNT_CREDS:', err && err.message);
      throw err;
    }
  }

  // Option 2: key file path
  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    if (!fs.existsSync(keyFile)) {
      console.error('GOOGLE_SERVICE_ACCOUNT_FILE path does not exist:', keyFile);
      throw new Error('GOOGLE_SERVICE_ACCOUNT_FILE missing on disk: ' + keyFile);
    }
    console.log('Using GOOGLE_SERVICE_ACCOUNT_FILE at', keyFile);
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

/**
 * uploadToDrive
 * - fileBuffer: Buffer
 * - filename: string
 * - mimeType: string
 *
 * Returns: webViewLink string on success.
 *
 * Throws on fatal errors (caller can catch and fallback to local save).
 */
async function uploadToDrive(fileBuffer, filename, mimeType = 'application/octet-stream') {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID not set in env');
  const drive = await getDriveService();

  // Convert buffer to readable stream for googleapis multipart handler.
  const bufferStream = new stream.PassThrough();
  bufferStream.end(Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer));

  console.log(`Uploading to Drive: name=${filename} size=${(fileBuffer ? fileBuffer.length : 0)} mime=${mimeType} folder=${DRIVE_FOLDER_ID}`);

  // Use the stream as media.body
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

  console.log('Drive file created id=', fileId);

  // Make file viewable via link (anyoneWithLink). This may fail in some org policies.
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      },
      supportsAllDrives: true
    });
    console.log('Set permission: anyone reader on fileId=', fileId);
  } catch (err) {
    // Not fatal — many orgs block "anyone" sharing; we'll continue and return webViewLink if available.
    console.warn('Failed to set "anyone" permission (may be org policy). Continuing. err=', err && err.message);
  }

  // get webViewLink
  try {
    const meta = await drive.files.get({ fileId, fields: 'id, webViewLink, webContentLink' });
    const link = meta.data.webViewLink || meta.data.webContentLink || `https://drive.google.com/file/d/${fileId}/view`;
    console.log('Drive link for fileId=', fileId, '->', link);
    return link;
  } catch (err) {
    console.warn('drive.files.get failed for fileId=', fileId, err && err.message);
    return `https://drive.google.com/file/d/${fileId}/view`;
  }
}

// Append row to sheets
async function appendToSheet(sheetId, valuesArray) {
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set in env');
  const sheets = await getSheetsService();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1',   // 👈 anchor at A1 so rows always start from column A
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [valuesArray]
    }
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

// OAuth routes
app.get('/auth/google', (req, res, next) => {
  if (!passport._strategy('google')) return res.status(500).json({ error: 'oauth_not_configured' });
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!passport._strategy('google')) return res.status(500).json({ error: 'oauth_not_configured' });
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) {
      console.error('OAuth callback error', err);
      return res.status(500).json({ error: 'oauth_failed' });
    }
    const token = signUserToken(user);
    const redirectTo = `${FRONTEND_URL}?token=${encodeURIComponent(token)}`;
    return res.redirect(redirectTo);
  })(req, res, next);
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

// Responses (protected)
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

    // find opening title if available
    const data = readData();
    const opening = data.openings.find(o => o.id === openingId);
    const openingTitle = opening ? opening.title : null;

    // Resume upload
    let resumeLink = null;
    if (req.file && req.file.buffer) {
      const filename = `${Date.now()}_${(req.file.originalname || 'resume')}`;
      try {
        // Attempt Drive upload first
        resumeLink = await uploadToDrive(req.file.buffer, filename, req.file.mimetype || 'application/octet-stream');
        console.log('Drive upload success, resumeLink=', resumeLink);
      } catch (err) {
        // Drive failed — log and fallback to saving locally and serving via /uploads
        console.error('Drive upload failed:', err && (err.stack || err.message));
        try {
          const localPath = path.join(UPLOADS_DIR, filename);
          fs.writeFileSync(localPath, req.file.buffer);
          // construct absolute URL based on incoming request host
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
