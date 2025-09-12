// server.js
// Backend: OAuth (Google), file upload -> Drive, append -> Google Sheets,
// per-opening subsheets with metadata columns, questions -> mapped columns.

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
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-secret';

// --- Data persistence
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

// --- Google config
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
      console.log('Using GOOGLE_SERVICE_ACCOUNT_CREDS. client_email=', creds.client_email);
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

// sanitize sheet title
function sanitizeSheetTitle(title) {
  if (!title) title = 'sheet';
  return String(title).replace(/[\\\/\?\*\[\]\:]/g, '_').slice(0, 90);
}

/**
 * ensureSheetTabWithHeaders:
 * - ensures a sheet/tab with `sheetTitle` exists
 * - reads existing header row; if empty or missing, writes the header row:
 *     [Timestamp, OpeningId, OpeningTitle, Source, ResumeLink, ...question labels]
 * - returns the headers array used
 */
async function ensureSheetTabWithHeaders(spreadsheetId, sheetTitle, questionSchema = []) {
  if (!spreadsheetId) throw new Error('spreadsheetId required');
  const sheets = await getSheetsService();
  const cleanTitle = sanitizeSheetTitle(sheetTitle);

  // get spreadsheet metadata & sheetId list
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const existingSheets = (meta.data.sheets || []).map(s => s.properties?.title);

  // add sheet if missing
  if (!existingSheets.includes(cleanTitle)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: cleanTitle } } }]
      }
    });
    console.log('Added sheet tab', cleanTitle);
  }

  // build headers: metadata first, then questions labels
  const metaHeaders = ['Timestamp', 'OpeningId', 'OpeningTitle', 'Source', 'ResumeLink'];
  const questionHeaders = (Array.isArray(questionSchema) ? questionSchema.map(q => q.label || q.id) : []);
  const headers = [...metaHeaders, ...questionHeaders];

  // check if header already exists (read A1:Z1)
  try {
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${cleanTitle}!A1:Z1`
    });
    const vals = existing.data.values && existing.data.values[0];
    const hasHeader = Array.isArray(vals) && vals.some(cell => cell && String(cell).trim() !== '');
    if (!hasHeader) {
      // write header row (A1)
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${cleanTitle}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] }
      });
      console.log('Wrote header row for sheet', cleanTitle);
    } else {
      console.log('Sheet', cleanTitle, 'already has header; skipping write.');
    }
  } catch (err) {
    // If read fails for some reason, attempt to write header anyway
    console.warn('Could not read header row; attempting to write header:', err && err.message);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${cleanTitle}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] }
    });
  }

  return headers;
}

// Append a row to a specific sheet tab, starting at A (use A1 to anchor to col A)
async function appendRowToSheetTab(spreadsheetId, sheetTitle, valuesArray) {
  if (!spreadsheetId) throw new Error('spreadsheetId required');
  const sheets = await getSheetsService();
  const range = `${sanitizeSheetTitle(sheetTitle)}!A1`;
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [valuesArray] }
  });
  return res.status === 200 || res.status === 201;
}

// Generic fallback append to Sheet1 (force A1 anchor)
async function appendToSheet(spreadsheetId, valuesArray) {
  if (!spreadsheetId) throw new Error('spreadsheetId required');
  const sheets = await getSheetsService();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [valuesArray] }
  });
  return res.status === 200 || res.status === 201;
}

// Drive upload helper (buffer -> stream), sets public permission where possible
async function uploadToDrive(fileBuffer, filename, mimeType = 'application/octet-stream') {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID not set in env');
  const drive = await getDriveService();

  const bufferStream = new stream.PassThrough();
  bufferStream.end(Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer));

  console.log(`Uploading to Drive: name=${filename} size=${(fileBuffer ? fileBuffer.length : 0)} mime=${mimeType} folder=${DRIVE_FOLDER_ID}`);

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

  // set permission
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true
    });
  } catch (err) {
    console.warn('Failed to set file permission:', err && err.message);
  }

  // fetch link
  try {
    const meta = await drive.files.get({ fileId, fields: 'id, webViewLink, webContentLink', supportsAllDrives: true });
    const link = meta.data.webViewLink || meta.data.webContentLink || `https://drive.google.com/file/d/${fileId}/view`;
    return link;
  } catch (err) {
    console.warn('drive.files.get failed, returning generic view link', err && err.message);
    return `https://drive.google.com/file/d/${fileId}/view`;
  }
}

// Multer
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

// Passport Google OAuth: register users on callback and issue JWT
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

// --- Openings endpoints
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
    schema: payload.schema || null, // schema = [{ id, label, type, options? }]
    createdAt: new Date().toISOString()
  };
  data.openings.unshift(op);
  writeData(data);
  return res.json(op);
});

app.post('/api/openings/:id/schema', authMiddleware, (req, res) => {
  const id = req.params.id;
  const incoming = req.body.schema;
  if (!incoming) return res.status(400).json({ error: 'missing schema' });
  const data = readData();
  const idx = data.openings.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: 'opening_not_found' });
  data.openings[idx].schema = incoming;
  writeData(data);
  return res.json({ ok: true, schema: incoming });
});

app.put('/api/openings/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const data = readData();
  const idx = data.openings.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: 'opening_not_found' });
  const cur = data.openings[idx];
  const fields = ['title','location','department','preferredSources','durationMins','schema'];
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

// Public apply endpoint -> upload resume to Drive, append to opening sheet (with metadata columns)
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  try {
    const openingId = req.query.opening || req.body.opening;
    const src = req.query.src || req.body.src || 'unknown';
    if (!openingId) return res.status(400).json({ error: 'missing opening id' });

    const data = readData();
    const opening = data.openings.find(o => o.id === openingId);
    const openingTitle = opening ? opening.title : '';
    const sheetTabName = opening ? `${opening.id}` : `opening_${openingId}`;

    // accept _schema inline if provided (stringified JSON or object)
    let providedSchema = null;
    if (req.body && req.body._schema) {
      try {
        providedSchema = typeof req.body._schema === 'string' ? JSON.parse(req.body._schema) : req.body._schema;
        if (Array.isArray(providedSchema) && opening) {
          opening.schema = providedSchema;
          writeData(data);
          console.log('Saved schema for opening', openingId);
        }
      } catch (err) {
        console.warn('Invalid _schema provided; ignoring', err && err.message);
        providedSchema = null;
      }
    }
    const activeSchema = (opening && opening.schema) ? opening.schema : providedSchema;

    // handle resume upload
    let resumeLink = null;
    if (req.file && req.file.buffer) {
      const filename = `${Date.now()}_${(req.file.originalname || 'resume')}`;
      try {
        resumeLink = await uploadToDrive(req.file.buffer, filename, req.file.mimetype || 'application/octet-stream');
        console.log('Drive upload success resumeLink=', resumeLink);
      } catch (err) {
        console.error('Drive upload failed:', err && (err.stack || err.message));
        // fallback local
        try {
          const localPath = path.join(UPLOADS_DIR, filename);
          fs.writeFileSync(localPath, req.file.buffer);
          const host = req.get('host');
          const protocol = req.protocol;
          resumeLink = `${protocol}://${host}/uploads/${encodeURIComponent(filename)}`;
          console.log('Saved fallback file locally at', localPath, '->', resumeLink);
        } catch (fsErr) {
          console.error('Failed to save fallback file locally', fsErr && fsErr.message);
        }
      }
    } else {
      console.log('No resume file present in submission');
    }

    // collect answers (skip _schema)
    const answers = {};
    Object.keys(req.body || {}).forEach(k => { if (k === '_schema') return; answers[k] = req.body[k]; });

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

    // If a schema exists for this opening, ensure sheet tab headers and append mapped row
    if (SHEET_ID && activeSchema && Array.isArray(activeSchema) && activeSchema.length) {
      try {
        // ensure headers: metadata + question labels (only write header if not present)
        await ensureSheetTabWithHeaders(SHEET_ID, sheetTabName, activeSchema);

        // Build valuesArray that exactly matches headers
        const metaValues = [ new Date().toISOString(), openingId, openingTitle, src, resumeLink || '' ];

        // Map question schema order to answers (schema items should have unique id fields)
        const questionValues = activeSchema.map(s => {
          // prioritize answer by question id (s.id). If not present, try by label text or fallback empty
          let val = '';
          if (s.id && answers[s.id] !== undefined) val = answers[s.id];
          else if (answers[s.label] !== undefined) val = answers[s.label];
          else if (answers[s.name] !== undefined) val = answers[s.name];
          // handle arrays
          if (Array.isArray(val)) return val.join(', ');
          return (val === undefined || val === null) ? '' : String(val);
        });
        const valuesArray = [...metaValues, ...questionValues];

        // append anchored to A1 so the row starts at column A
        await appendRowToSheetTab(SHEET_ID, sheetTabName, valuesArray);
        console.log('Appended mapped row to sheet tab', sheetTabName);
      } catch (err) {
        console.error('Failed to append mapped row to sheet/subsheet:', err && (err.stack || err.message));
        // fallback: generic append to Sheet1 with JSON blob
        try {
          const genericRow = [new Date().toISOString(), openingId, openingTitle || '', src, resumeLink || '', JSON.stringify(answers)];
          if (SHEET_ID) {
            await appendToSheet(SHEET_ID, genericRow);
            console.log('Appended fallback generic row to Sheet1');
          }
        } catch (err2) {
          console.error('Fallback appendToSheet failed', err2 && err2.message);
        }
      }
    } else {
      // No schema: fallback generic append to Sheet1 (anchored to A1)
      if (SHEET_ID) {
        try {
          const genericRow = [new Date().toISOString(), openingId, openingTitle || '', src, resumeLink || '', JSON.stringify(answers)];
          await appendToSheet(SHEET_ID, genericRow);
          console.log('Appended generic row to Sheet1 (no schema)');
        } catch (err) {
          console.error('appendToSheet (generic) failed', err && err.message);
        }
      } else {
        console.warn('SHEET_ID not set; skipping sheet append');
      }
    }

    return res.json({ ok: true, resumeLink });
  } catch (err) {
    console.error('Error in /api/apply', err && (err.stack || err.message));
    return res.status(500).json({ error: 'server_error', message: err?.message || 'unknown' });
  }
});

// health
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Backend listening on ${PORT}`);
});
