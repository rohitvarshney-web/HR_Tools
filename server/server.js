// server.js
// Backend: OAuth (Google), file upload -> Drive, append -> Google Sheets,
// per-opening subsheets, mapping question ids -> column headers.

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
app.use(express.json({ limit: '10mb' }));
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

// Utility: sanitize sheet title (max 100 chars, remove problematic chars)
function sanitizeSheetTitle(title) {
  if (!title) title = 'sheet';
  // remove slashes and weird chars, trim to 90 chars
  return String(title).replace(/[\\\/\?\*\[\]\:]/g, '_').slice(0, 90);
}

/**
 * ensureSheetTab
 * - Checks whether a sheet/tab with the provided title exists in the spreadsheet.
 * - If not, creates it.
 * - Ensures first row (headers) matches provided headers array: updates header row if needed.
 * Returns: { sheetTitle, ok: true }
 */
async function ensureSheetTab(spreadsheetId, sheetTitle, headers = []) {
  if (!spreadsheetId) throw new Error('spreadsheetId required');
  const sheets = await getSheetsService();

  const cleanTitle = sanitizeSheetTitle(sheetTitle);

  // Get current spreadsheet metadata
  const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const existingSheets = (meta.data.sheets || []).map(s => s.properties?.title);

  // Add sheet if missing
  if (!existingSheets.includes(cleanTitle)) {
    console.log('Adding new sheet/tab:', cleanTitle);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: cleanTitle } } }
        ]
      }
    });
  }

  // Prepare header row and update if needed
  if (headers && headers.length) {
    // read current header row (A1:Z1)
    try {
      const read = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${cleanTitle}!1:1`
      });
      const current = (read.data.values && read.data.values[0]) || [];
      // compare current headers and desired headers
      let needUpdate = false;
      if (current.length !== headers.length) needUpdate = true;
      else {
        for (let i = 0; i < headers.length; i++) {
          if ((current[i] || '') !== (headers[i] || '')) { needUpdate = true; break; }
        }
      }
      if (needUpdate) {
        console.log('Updating header row for', cleanTitle, 'headers=', headers);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${cleanTitle}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [headers] }
        });
      }
    } catch (err) {
      // if reading failed (e.g., empty sheet), write headers
      console.warn('Header read failed or missing; writing headers for', cleanTitle, err && err.message);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${cleanTitle}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] }
      });
    }
  }

  return { sheetTitle: cleanTitle, ok: true };
}

/**
 * appendRowToSheet
 * - spreadsheetId
 * - sheetTitle
 * - valuesArray (array aligned with headers)
 */
async function appendRowToSheet(spreadsheetId, sheetTitle, valuesArray) {
  const sheets = await getSheetsService();
  const range = `${sanitizeSheetTitle(sheetTitle)}!A:Z`;
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [valuesArray] }
  });
  return res.status === 200 || res.status === 201;
}

// Drive upload (same logic as before) — uses stream.PassThrough for media
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

  // attempt to make it readable by link (may be blocked by org policy)
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true
    });
    console.log('Set permission: anyone reader on fileId=', fileId);
  } catch (err) {
    console.warn('Failed to set "anyone" permission (may be org policy). Continuing. err=', err && err.message);
  }

  // fetch webViewLink
  try {
    const meta = await drive.files.get({ fileId, fields: 'id, webViewLink, webContentLink' });
    const link = meta.data.webViewLink || meta.data.webContentLink || `https://drive.google.com/file/d/${fileId}/view`;
    console.log('Drive link:', link);
    return link;
  } catch (err) {
    console.warn('drive.files.get failed for fileId=', fileId, err && err.message);
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

// Passport Google OAuth (unchanged)
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
        user = { id: `u_${Date.now()}`, email, name: profile.displayName || '', role: 'recruiter', createdAt: new Date().toISOString() };
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
app.get('/auth/google', (req, res, next) => {
  if (!passport._strategy('google')) return res.status(500).json({ error: 'oauth_not_configured' });
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});
app.get('/auth/google/callback', (req, res, next) => {
  if (!passport._strategy('google')) return res.status(500).json({ error: 'oauth_not_configured' });
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) return res.status(500).json({ error: 'oauth_failed' });
    const token = signUserToken(user);
    return res.redirect(`${FRONTEND_URL}?token=${encodeURIComponent(token)}`);
  })(req, res, next);
});

// --- API endpoints (openings, responses) ---

app.get('/api/me', authMiddleware, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.user.id || u.email === req.user.email);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  return res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

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
    schema: payload.schema || null, // optional schema: [{id,label},...]
    createdAt: new Date().toISOString()
  };
  data.openings.unshift(op);
  writeData(data);
  return res.json(op);
});

// update opening schema (protected): body.schema = [{id,label},...]
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

// --- Public apply endpoint -> upload resume to Drive, append to opening sheet (subsheet) ---
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  try {
    const openingId = req.query.opening || req.body.opening;
    const src = req.query.src || req.body.src || 'unknown';
    if (!openingId) return res.status(400).json({ error: 'missing opening id' });

    const data = readData();
    const opening = data.openings.find(o => o.id === openingId);
    const openingTitle = opening ? opening.title : null;
    const sheetTabName = opening ? (`${opening.id}`) : `opening_${openingId}`; // sheet tab = opening id (unique)

    // If client sent schema in this request, accept & save it.
    // _schema may be JSON string or object: [{id,label}, ...]
    let providedSchema = null;
    if (req.body && req.body._schema) {
      try {
        providedSchema = typeof req.body._schema === 'string' ? JSON.parse(req.body._schema) : req.body._schema;
        if (Array.isArray(providedSchema)) {
          // Save to opening record for future mapping (only if opening exists)
          if (opening) {
            opening.schema = providedSchema;
            writeData(data);
            console.log('Saved schema for opening', openingId);
          }
        } else {
          providedSchema = null;
        }
      } catch (err) {
        console.warn('Invalid _schema provided, ignoring', err && err.message);
        providedSchema = null;
      }
    }

    // Build active schema: prefer stored opening.schema, else providedSchema, else null
    const activeSchema = (opening && opening.schema) ? opening.schema : providedSchema;

    // Handle resume upload (Drive attempt + fallback to local)
    let resumeLink = null;
    if (req.file && req.file.buffer) {
      const filename = `${Date.now()}_${(req.file.originalname || 'resume')}`;
      try {
        resumeLink = await uploadToDrive(req.file.buffer, filename, req.file.mimetype || 'application/octet-stream');
        console.log('Drive upload success resumeLink=', resumeLink);
      } catch (err) {
        console.error('Drive upload failed:', err && (err.stack || err.message));
        // fallback to local
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

    // collect answers: req.body contains non-file fields merged by multer
    // Note: keys are expected to be question ids (as frontend sets name={q.id})
    const answers = {};
    Object.keys(req.body || {}).forEach(k => {
      if (k === '_schema') return; // skip
      answers[k] = req.body[k];
    });

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

    // If we have a sheet id and a schema, ensure sheet tab & headers and append mapped values
    if (SHEET_ID && activeSchema && Array.isArray(activeSchema) && activeSchema.length) {
      try {
        // activeSchema is array of {id,label}. Construct headers in same order
        const headers = activeSchema.map(s => s.label || s.id);

        // Ensure tab created & header row set
        await ensureSheetTab(SHEET_ID, sheetTabName, headers);

        // build values array aligned to headers
        const valuesArray = activeSchema.map(s => {
          // answers keys may be strings; prefer answers[s.id]
          const v = answers[s.id];
          // If it's an array (checkboxes), join
          if (Array.isArray(v)) return v.join(', ');
          return (v === undefined || v === null) ? '' : String(v);
        });

        // Prepend timestamp and maybe other meta columns? (User asked columns per question; we'll add timestamp as first column)
        // Option A: If you want timestamp as first column, add header and shift values. But since user asked columns = question labels, we only write question columns.
        await appendRowToSheet(SHEET_ID, sheetTabName, valuesArray);
        console.log('Appended mapped row to sheet tab', sheetTabName);
      } catch (err) {
        console.error('Failed to append mapped row to sheet/subsheet:', err && (err.stack || err.message));
        // fallback: append a generic row to a top-level sheet (Sheet1)
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
      // No schema: append generic row to sheet if possible
      if (SHEET_ID) {
        try {
          const genericRow = [new Date().toISOString(), openingId, openingTitle || '', src, resumeLink || '', JSON.stringify(answers)];
          await appendToSheet(SHEET_ID, genericRow);
          console.log('Appended generic row to Sheet1 (no schema)');
        } catch (err) {
          console.error('appendToSheet (generic) failed', err && err.message);
        }
      } else {
        console.warn('SHEET_ID not configured; skipping sheet append');
      }
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
