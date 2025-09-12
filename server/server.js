// server.js (updated)
// Backend: OAuth (Google), file upload -> Drive, append -> Google Sheets,
// JSON file persistence for openings -> server_data/openings.json
// and forms -> server_data/forms.json; existing data.json kept for responses/users.
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

// Data dirs & files
const DATA_DIR = path.resolve(__dirname, 'server_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DATA_FILE = path.join(DATA_DIR, 'data.json'); // existing legacy file (responses/users)
const OPENINGS_FILE = path.join(DATA_DIR, 'openings.json'); // NEW canonical openings storage
const FORMS_FILE = path.join(DATA_DIR, 'forms.json'); // NEW forms storage
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- Safe file helpers (atomic write)
function readJsonFile(filePath, defaultVal = null) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : defaultVal;
  } catch (err) {
    console.error('[readJsonFile] error reading', filePath, err && err.message);
    return defaultVal;
  }
}
function writeJsonFileAtomic(filePath, obj) {
  try {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
    console.log(`[writeJsonFileAtomic] wrote ${filePath} (${Array.isArray(obj) ? obj.length : Object.keys(obj || {}).length})`);
  } catch (err) {
    console.error('[writeJsonFileAtomic] failed to write', filePath, err && err.stack);
    throw err;
  }
}

// ---------- Legacy data.json helpers (existing behavior)
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const base = { openings: [], responses: [], users: [] };
      writeJsonFileAtomic(DATA_FILE, base);
      console.log('[readData] data.json not found -> initializing at', DATA_FILE);
      return base;
    }
    console.log('[readData] reading', DATA_FILE);
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : { openings: [], responses: [], users: [] };
    console.log(`[readData] counts -> openings: ${(parsed.openings||[]).length} responses: ${(parsed.responses||[]).length} users: ${(parsed.users||[]).length}`);
    return parsed;
  } catch (err) {
    console.error('[readData] error', err && err.stack);
    return { openings: [], responses: [], users: [] };
  }
}
function writeData(obj) {
  try {
    writeJsonFileAtomic(DATA_FILE, obj);
    console.log('[writeData] wrote data.json');
  } catch (err) {
    console.error('[writeData] err', err && err.message);
  }
}

// Ensure canonical openings/forms files and do a non-destructive migration if needed
function ensurePersistenceFilesAndMigrate() {
  // ensure files exist
  if (!fs.existsSync(OPENINGS_FILE)) {
    const legacy = readData();
    const legacyOpenings = Array.isArray(legacy.openings) ? legacy.openings : [];
    if (legacyOpenings.length > 0) {
      // migrate non-destructively: copy legacy openings into openings.json
      writeJsonFileAtomic(OPENINGS_FILE, legacyOpenings);
      console.log('[migration] migrated openings from data.json -> openings.json (count=' + legacyOpenings.length + ')');
    } else {
      writeJsonFileAtomic(OPENINGS_FILE, []);
      console.log('[init] created empty openings.json');
    }
  } else {
    // exists — leave as-is
    console.log('[init] openings.json exists at', OPENINGS_FILE);
  }

  if (!fs.existsSync(FORMS_FILE)) {
    writeJsonFileAtomic(FORMS_FILE, []);
    console.log('[init] created empty forms.json');
  } else {
    console.log('[init] forms.json exists at', FORMS_FILE);
  }
}

ensurePersistenceFilesAndMigrate();

// serve fallback uploads if Drive fails
app.use('/uploads', express.static(UPLOADS_DIR));

// -------------------- Google / Drive / Sheets config (unchanged) --------------------
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
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDS);
    googleAuthInstance = new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
    return googleAuthInstance;
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    if (!fs.existsSync(keyFile)) throw new Error('GOOGLE_SERVICE_ACCOUNT_FILE missing: ' + keyFile);
    googleAuthInstance = new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
    return googleAuthInstance;
  }
  throw new Error('No Google service account configured');
}
async function getDriveService() { const auth = getAuthClient(); const client = await auth.getClient(); return google.drive({ version: 'v3', auth: client }); }
async function getSheetsService() { const auth = getAuthClient(); const client = await auth.getClient(); return google.sheets({ version: 'v4', auth: client }); }
async function uploadToDrive(fileBuffer, filename, mimeType = 'application/octet-stream') {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID not set');
  const drive = await getDriveService();
  const bufferStream = new stream.PassThrough(); bufferStream.end(Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer));
  const created = await drive.files.create({
    requestBody: { name: filename, parents: [DRIVE_FOLDER_ID] },
    media: { mimeType, body: bufferStream },
    supportsAllDrives: true,
    fields: 'id, webViewLink, webContentLink'
  });
  const fileId = created.data && created.data.id;
  if (!fileId) throw new Error('Drive returned no file id');
  try {
    await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true });
  } catch (err) {
    console.warn('drive.permissions.create failed (org policy?)', err && err.message);
  }
  try {
    const meta = await drive.files.get({ fileId, fields: 'id, webViewLink, webContentLink' });
    return meta.data.webViewLink || meta.data.webContentLink || `https://drive.google.com/file/d/${fileId}/view`;
  } catch (err) {
    return `https://drive.google.com/file/d/${fileId}/view`;
  }
}
async function appendToSheet(sheetId, valuesArray) {
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set');
  const sheets = await getSheetsService();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [valuesArray] }
  });
  return res.status === 200 || res.status === 201;
}

// Multer (memory)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// JWT helpers & auth middleware (unchanged)
function signUserToken(user) { const payload = { id: user.id, email: user.email, role: user.role || 'recruiter' }; return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' }); }
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
      if (!user) return done(null, false, { message: 'email_not_allowed', email });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
  app.use(passport.initialize());
} else {
  console.warn('Google OAuth not configured: GOOGLE_OAUTH_CLIENT_ID/SECRET missing');
}

// OAuth routes (unchanged)
app.get('/auth/google', (req, res, next) => {
  if (!passport._strategy('google')) return res.status(500).json({ error: 'oauth_not_configured' });
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});
app.get('/auth/google/callback', (req, res, next) => {
  if (!passport._strategy('google')) return res.status(500).json({ error: 'oauth_not_configured' });
  passport.authenticate('google', { session: false }, (err, user, info) => {
    if (err) { console.error('OAuth callback error', err); return res.status(500).json({ error: 'oauth_failed' }); }
    if (!user) { return res.status(403).json(info || { message: 'denied' }); }
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

/* -----------------------------
   Openings endpoints (protected)
   read/write from OPENINGS_FILE
   ----------------------------- */

// GET all openings (protected)
app.get('/api/openings', authMiddleware, (req, res) => {
  const openings = readJsonFile(OPENINGS_FILE, []);
  return res.json(openings || []);
});

// GET single opening (protected)
app.get('/api/openings/:id', authMiddleware, (req, res) => {
  const openings = readJsonFile(OPENINGS_FILE, []);
  const item = openings.find(o => o.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'opening_not_found' });
  return res.json(item);
});

// CREATE opening (protected)
app.post('/api/openings', authMiddleware, (req, res) => {
  const payload = req.body || {};
  const openings = readJsonFile(OPENINGS_FILE, []);
  const op = {
    id: `op_${Date.now()}`,
    title: payload.title || 'Untitled',
    location: payload.location || 'Remote',
    department: payload.department || '',
    preferredSources: Array.isArray(payload.preferredSources) ? payload.preferredSources : (payload.preferredSources ? payload.preferredSources.split(',') : []),
    durationMins: payload.durationMins || 30,
    schema: payload.schema || null,
    createdAt: new Date().toISOString()
  };
  openings.unshift(op);
  writeJsonFileAtomic(OPENINGS_FILE, openings);
  console.log('[api POST /api/openings] created', op.id);
  return res.json(op);
});

// UPDATE opening (protected)
app.put('/api/openings/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const openings = readJsonFile(OPENINGS_FILE, []);
  const idx = openings.findIndex(o => o.id === id);
  if (idx === -1) return res.status(404).json({ error: 'opening_not_found' });
  const cur = openings[idx];
  const fields = ['title','location','department','preferredSources','durationMins','schema'];
  fields.forEach(f => { if (req.body[f] !== undefined) cur[f] = req.body[f]; });
  openings[idx] = cur;
  writeJsonFileAtomic(OPENINGS_FILE, openings);
  return res.json(cur);
});

// DELETE opening (protected) — cascade delete forms
app.delete('/api/openings/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  // openings
  const openings = readJsonFile(OPENINGS_FILE, []);
  const filtered = openings.filter(o => o.id !== id);
  if (filtered.length === openings.length) return res.status(404).json({ error: 'opening_not_found' });
  writeJsonFileAtomic(OPENINGS_FILE, filtered);

  // forms cascade
  const forms = readJsonFile(FORMS_FILE, []);
  const newForms = forms.filter(f => f.openingId !== id);
  const deletedFormsCount = forms.length - newForms.length;
  writeJsonFileAtomic(FORMS_FILE, newForms);

  // legacy responses (still in data.json) — preserve existing behavior
  const data = readData();
  data.responses = (data.responses || []).filter(r => r.openingId !== id);
  writeData(data);

  console.log(`[api DELETE /api/openings/${id}] deleted opening and ${deletedFormsCount} forms`);
  return res.json({ ok: true, deletedFormsCount });
});

/* -----------------------------
   Forms endpoints (protected)
   ----------------------------- */

// GET all forms (optionally filter by openingId)
app.get('/api/forms', authMiddleware, (req, res) => {
  const forms = readJsonFile(FORMS_FILE, []);
  const { openingId } = req.query;
  if (openingId) return res.json(forms.filter(f => f.openingId === openingId));
  return res.json(forms);
});

// GET single form
app.get('/api/forms/:id', authMiddleware, (req, res) => {
  const forms = readJsonFile(FORMS_FILE, []);
  const f = forms.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'form_not_found' });
  return res.json(f);
});

// CREATE form
app.post('/api/forms', authMiddleware, (req, res) => {
  const { openingId, data } = req.body || {};
  if (!openingId) return res.status(400).json({ error: 'openingId_required' });
  const openings = readJsonFile(OPENINGS_FILE, []);
  if (!openings.find(o => o.id === openingId)) return res.status(400).json({ error: 'invalid_openingId' });
  const forms = readJsonFile(FORMS_FILE, []);
  const id = `form_${Date.now()}`;
  const now = new Date().toISOString();
  const newForm = { id, openingId, data: data || {}, created_at: now, updated_at: now };
  forms.push(newForm);
  writeJsonFileAtomic(FORMS_FILE, forms);
  console.log('[api POST /api/forms] created', id);
  return res.status(201).json(newForm);
});

// UPDATE form
app.put('/api/forms/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const forms = readJsonFile(FORMS_FILE, []);
  const idx = forms.findIndex(f => f.id === id);
  if (idx === -1) return res.status(404).json({ error: 'form_not_found' });
  const cur = forms[idx];
  cur.data = req.body.data !== undefined ? req.body.data : cur.data;
  cur.updated_at = new Date().toISOString();
  forms[idx] = cur;
  writeJsonFileAtomic(FORMS_FILE, forms);
  console.log('[api PUT /api/forms/:id] updated', id);
  return res.json(cur);
});

// DELETE form
app.delete('/api/forms/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const forms = readJsonFile(FORMS_FILE, []);
  const newForms = forms.filter(f => f.id !== id);
  if (newForms.length === forms.length) return res.status(404).json({ error: 'form_not_found' });
  writeJsonFileAtomic(FORMS_FILE, newForms);
  console.log('[api DELETE /api/forms/:id] deleted', id);
  return res.json({ ok: true, deletedFormId: id });
});

/* -------------------------
   Responses (protected) - unchanged
   ------------------------- */
app.get('/api/responses', authMiddleware, (req, res) => {
  const data = readData();
  return res.json(data.responses || []);
});

/* -------------------------
   Public endpoints for openings & schema (no auth)
   Now operate on openings.json
   ------------------------- */

// List public openings
app.get('/public/openings', (req, res) => {
  try {
    const openings = readJsonFile(OPENINGS_FILE, []);
    return res.json(openings || []);
  } catch (err) {
    console.error('GET /public/openings error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Create opening publicly (no auth)
app.post('/public/openings', (req, res) => {
  try {
    const payload = req.body || {};
    const openings = readJsonFile(OPENINGS_FILE, []);
    const op = {
      id: `op_${Date.now()}`,
      title: payload.title || 'Untitled',
      location: payload.location || 'Remote',
      department: payload.department || '',
      preferredSources: Array.isArray(payload.preferredSources) ? payload.preferredSources : (payload.preferredSources ? payload.preferredSources.split(',') : []),
      durationMins: payload.durationMins || 30,
      schema: payload.schema || null,
      createdAt: new Date().toISOString()
    };
    openings.unshift(op);
    writeJsonFileAtomic(OPENINGS_FILE, openings);
    console.log('[public POST /public/openings] created', op.id);
    return res.json(op);
  } catch (err) {
    console.error('POST /public/openings error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Get opening schema (public)
app.get('/public/openings/:id/schema', (req, res) => {
  try {
    const id = req.params.id;
    const openings = readJsonFile(OPENINGS_FILE, []);
    const op = openings.find(o => o.id === id);
    if (!op) return res.status(404).json({ error: 'opening_not_found' });
    return res.json({ schema: op.schema || null });
  } catch (err) {
    console.error('GET /public/openings/:id/schema error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Save opening schema (public)
app.post('/public/openings/:id/schema', (req, res) => {
  try {
    const id = req.params.id;
    const schema = req.body.schema;
    if (!schema || !Array.isArray(schema)) return res.status(400).json({ error: 'missing_or_invalid_schema' });
    const openings = readJsonFile(OPENINGS_FILE, []);
    const idx = openings.findIndex(o => o.id === id);
    if (idx === -1) return res.status(404).json({ error: 'opening_not_found' });
    openings[idx].schema = schema;
    writeJsonFileAtomic(OPENINGS_FILE, openings);
    console.log('[public POST /public/openings/:id/schema] saved schema for', id);
    return res.json({ ok: true, schema });
  } catch (err) {
    console.error('POST /public/openings/:id/schema error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Delete opening publicly (no auth) — cascade delete forms (careful!)
app.delete('/public/openings/:id', (req, res) => {
  try {
    const id = req.params.id;
    const openings = readJsonFile(OPENINGS_FILE, []);
    const before = openings.length;
    const newOpenings = openings.filter(o => o.id !== id);
    const removed = before - newOpenings.length;
    if (removed === 0) return res.status(404).json({ error: 'opening_not_found' });
    writeJsonFileAtomic(OPENINGS_FILE, newOpenings);

    // cascade forms
    const forms = readJsonFile(FORMS_FILE, []);
    const newForms = forms.filter(f => f.openingId !== id);
    const deletedFormsCount = forms.length - newForms.length;
    writeJsonFileAtomic(FORMS_FILE, newForms);

    // legacy responses cleanup (still preserved behavior)
    const data = readData();
    data.responses = (data.responses || []).filter(r => r.openingId !== id);
    writeData(data);

    console.log(`[public DELETE /public/openings/${id}] removed opening and ${deletedFormsCount} forms`);
    return res.json({ ok: true, deletedFormsCount });
  } catch (err) {
    console.error('DELETE /public/openings/:id error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* -------------------------
   Public apply endpoint -> upload resume to Drive, append to Sheet, persist locally (unchanged)
   ------------------------- */
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  try {
    const openingId = req.query.opening || req.body.opening;
    const src = req.query.src || req.body.src || 'unknown';
    if (!openingId) return res.status(400).json({ error: 'missing opening id' });

    const data = readData();
    const opening = (readJsonFile(OPENINGS_FILE, []) || []).find(o => o.id === openingId) || data.openings.find(o => o.id === openingId);
    const openingTitle = opening ? opening.title : null;

    // Resume upload to Drive (or fallback to local)
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

    const answers = {};
    Object.keys(req.body || {}).forEach(k => { answers[k] = req.body[k]; });

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
