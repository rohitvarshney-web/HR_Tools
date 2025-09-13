// server.js
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

const { MongoClient } = require('mongodb');

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

// ---------------------------
// Robust MongoDB connection + helpers
// ---------------------------
const MONGO_URI = process.env.MONGO_URI || null;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'hrtool';

let mongoClientInstance = null;
let db = null;

async function connectMongo() {
  if (!MONGO_URI) {
    console.log('[mongo] MONGO_URI not set — skipping MongoDB connection (file fallback enabled)');
    return null;
  }

  if (db) return db;

  try {
    console.log('[mongo] creating MongoClient...');
    mongoClientInstance = new MongoClient(MONGO_URI, {
      // modern driver: omit deprecated options
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      tls: true
    });

    console.log('[mongo] attempting to connect to Atlas...');
    await mongoClientInstance.connect();

    db = mongoClientInstance.db(MONGO_DB_NAME || undefined);
    console.log('✅ Connected to MongoDB:', db.databaseName || '(default from URI)');

    // create lightweight indexes non-blocking (best-effort)
    await Promise.allSettled([
      db.collection('openings').createIndex({ id: 1 }, { unique: true, sparse: true }),
      db.collection('forms').createIndex({ id: 1 }, { unique: true, sparse: true }),
      db.collection('responses').createIndex({ id: 1 }, { unique: true, sparse: true })
    ]);

    return db;
  } catch (err) {
    console.error('[mongo] Failed to connect to MongoDB:', err && (err.stack || err.message));
    db = null;
    try { if (mongoClientInstance) await mongoClientInstance.close(); } catch (e) { /* ignore */ }
    mongoClientInstance = null;
    throw err;
  }
}

// Helper: normalize doc (strip _id)
function normalizeDoc(doc) {
  if (!doc) return doc;
  const copy = { ...doc };
  delete copy._id;
  return copy;
}

// OPENINGS store helpers
async function listOpeningsFromStore() {
  if (db) {
    const rows = await db.collection('openings').find({}).sort({ createdAt: -1 }).toArray();
    return rows.map(normalizeDoc);
  }
  return readJsonFile(OPENINGS_FILE, []);
}
async function getOpeningFromStore(id) {
  if (db) {
    const doc = await db.collection('openings').findOne({ id });
    return normalizeDoc(doc);
  }
  const arr = readJsonFile(OPENINGS_FILE, []);
  return arr.find(o => o.id === id);
}
async function createOpeningInStore(op) {
  if (db) {
    await db.collection('openings').insertOne(op);
    return op;
  }
  const arr = readJsonFile(OPENINGS_FILE, []);
  arr.unshift(op);
  writeJsonFileAtomic(OPENINGS_FILE, arr);
  return op;
}
async function updateOpeningInStore(id, fields) {
  if (db) {
    await db.collection('openings').updateOne({ id }, { $set: fields });
    const doc = await db.collection('openings').findOne({ id });
    return normalizeDoc(doc);
  }
  const arr = readJsonFile(OPENINGS_FILE, []);
  const idx = arr.findIndex(o => o.id === id);
  if (idx === -1) return null;
  arr[idx] = { ...arr[idx], ...fields };
  writeJsonFileAtomic(OPENINGS_FILE, arr);
  return arr[idx];
}
async function deleteOpeningInStore(id) {
  let removed = 0;
  if (db) {
    const res = await db.collection('openings').deleteOne({ id });
    removed = res.deletedCount || 0;
    await db.collection('forms').deleteMany({ openingId: id });
    await db.collection('responses').deleteMany({ openingId: id });
  } else {
    const arr = readJsonFile(OPENINGS_FILE, []);
    const newArr = arr.filter(o => o.id !== id);
    removed = arr.length - newArr.length;
    writeJsonFileAtomic(OPENINGS_FILE, newArr);
  }

  // Ensure file forms are cleaned too
  const forms = readJsonFile(FORMS_FILE, []);
  const newForms = forms.filter(f => f.openingId !== id);
  const deletedFormsCount = forms.length - newForms.length;
  if (deletedFormsCount > 0) writeJsonFileAtomic(FORMS_FILE, newForms);

  // legacy responses in data.json
  const data = readData();
  data.responses = (data.responses || []).filter(r => r.openingId !== id);
  writeData(data);

  return { ok: true, removedOpenings: removed, deletedFormsCount };
}

// FORMS store helpers
async function listFormsFromStore(openingId) {
  if (db) {
    const q = openingId ? { openingId } : {};
    const rows = await db.collection('forms').find(q).toArray();
    return rows.map(normalizeDoc);
  }
  const arr = readJsonFile(FORMS_FILE, []);
  return openingId ? arr.filter(f => f.openingId === openingId) : arr;
}
async function getFormFromStore(id) {
  if (db) {
    const doc = await db.collection('forms').findOne({ id });
    return normalizeDoc(doc);
  }
  const arr = readJsonFile(FORMS_FILE, []);
  return arr.find(f => f.id === id);
}
async function createFormInStore(form) {
  if (db) {
    await db.collection('forms').insertOne(form);
    return form;
  }
  const arr = readJsonFile(FORMS_FILE, []);
  arr.push(form);
  writeJsonFileAtomic(FORMS_FILE, arr);
  return form;
}
async function updateFormInStore(id, patch) {
  if (db) {
    await db.collection('forms').updateOne({ id }, { $set: patch });
    const doc = await db.collection('forms').findOne({ id });
    return normalizeDoc(doc);
  }
  const arr = readJsonFile(FORMS_FILE, []);
  const idx = arr.findIndex(f => f.id === id);
  if (idx === -1) return null;
  arr[idx] = { ...arr[idx], ...patch };
  writeJsonFileAtomic(FORMS_FILE, arr);
  return arr[idx];
}
async function deleteFormInStore(id) {
  if (db) {
    const res = await db.collection('forms').deleteOne({ id });
    return { ok: true, deleted: res.deletedCount || 0 };
  }
  const arr = readJsonFile(FORMS_FILE, []);
  const newArr = arr.filter(f => f.id !== id);
  if (newArr.length === arr.length) return { ok: false, deleted: 0 };
  writeJsonFileAtomic(FORMS_FILE, newArr);
  return { ok: true, deleted: arr.length - newArr.length };
}

/* -------------------------
   OAuth routes, user endpoints remain unchanged (using legacy data.json)
   ------------------------- */

// OAuth routes
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
   use DB if available, else file fallback
   ----------------------------- */

// GET all openings (protected)
app.get('/api/openings', authMiddleware, async (req, res) => {
  try {
    const openings = await listOpeningsFromStore();
    return res.json(openings || []);
  } catch (err) {
    console.error('GET /api/openings error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// GET single opening (protected)
app.get('/api/openings/:id', authMiddleware, async (req, res) => {
  try {
    const item = await getOpeningFromStore(req.params.id);
    if (!item) return res.status(404).json({ error: 'opening_not_found' });
    return res.json(item);
  } catch (err) {
    console.error('GET /api/openings/:id error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// CREATE opening (protected)
app.post('/api/openings', authMiddleware, async (req, res) => {
  try {
    const payload = req.body || {};
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
    await createOpeningInStore(op);
    console.log('[api POST /api/openings] created', op.id);
    return res.json(op);
  } catch (err) {
    console.error('POST /api/openings error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// UPDATE opening (protected)
app.put('/api/openings/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const fields = {};
    ['title','location','department','preferredSources','durationMins','schema'].forEach(f => { if (req.body[f] !== undefined) fields[f] = req.body[f]; });
    const updated = await updateOpeningInStore(id, fields);
    if (!updated) return res.status(404).json({ error: 'opening_not_found' });
    return res.json(updated);
  } catch (err) {
    console.error('PUT /api/openings/:id error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// DELETE opening (protected) — cascade delete forms
app.delete('/api/openings/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await deleteOpeningInStore(id);
    return res.json(result);
  } catch (err) {
    console.error('DELETE /api/openings/:id error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* -----------------------------
   Forms endpoints (protected)
   ----------------------------- */

// GET all forms (optionally filter by openingId)
app.get('/api/forms', authMiddleware, async (req, res) => {
  try {
    const { openingId } = req.query;
    const forms = await listFormsFromStore(openingId);
    return res.json(forms || []);
  } catch (err) {
    console.error('GET /api/forms error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// GET single form
app.get('/api/forms/:id', authMiddleware, async (req, res) => {
  try {
    const f = await getFormFromStore(req.params.id);
    if (!f) return res.status(404).json({ error: 'form_not_found' });
    return res.json(f);
  } catch (err) {
    console.error('GET /api/forms/:id error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// CREATE form
app.post('/api/forms', authMiddleware, async (req, res) => {
  try {
    const { openingId, data } = req.body || {};
    if (!openingId) return res.status(400).json({ error: 'openingId_required' });
    const opening = await getOpeningFromStore(openingId);
    if (!opening) return res.status(400).json({ error: 'invalid_openingId' });
    const id = `form_${Date.now()}`;
    const now = new Date().toISOString();
    const newForm = { id, openingId, data: data || {}, created_at: now, updated_at: now };
    await createFormInStore(newForm);
    console.log('[api POST /api/forms] created', id);
    return res.status(201).json(newForm);
  } catch (err) {
    console.error('POST /api/forms error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// UPDATE form
app.put('/api/forms/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const patch = {};
    if (req.body.data !== undefined) patch.data = req.body.data;
    patch.updated_at = new Date().toISOString();
    const updated = await updateFormInStore(id, patch);
    if (!updated) return res.status(404).json({ error: 'form_not_found' });
    console.log('[api PUT /api/forms/:id] updated', id);
    return res.json(updated);
  } catch (err) {
    console.error('PUT /api/forms/:id error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// DELETE form
app.delete('/api/forms/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await deleteFormInStore(id);
    if (!result.ok) return res.status(404).json({ error: 'form_not_found' });
    console.log('[api DELETE /api/forms/:id] deleted', id);
    return res.json(result);
  } catch (err) {
    console.error('DELETE /api/forms/:id error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* -------------------------
   Responses (protected) - legacy stored in data.json and optionally in DB
   ------------------------- */
app.get('/api/responses', authMiddleware, async (req, res) => {
  try {
    if (db) {
      const rows = await db.collection('responses').find({}).sort({ createdAt: -1 }).toArray();
      return res.json(rows.map(normalizeDoc));
    }
    const data = readData();
    return res.json(data.responses || []);
  } catch (err) {
    console.error('GET /api/responses error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* -------------------------
   Public endpoints for openings & schema (no auth)
   ------------------------- */

// List public openings
app.get('/public/openings', async (req, res) => {
  try {
    const openings = await listOpeningsFromStore();
    return res.json(openings || []);
  } catch (err) {
    console.error('GET /public/openings error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Create opening publicly (no auth)
app.post('/public/openings', async (req, res) => {
  try {
    const payload = req.body || {};
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
    await createOpeningInStore(op);
    console.log('[public POST /public/openings] created', op.id);
    return res.json(op);
  } catch (err) {
    console.error('POST /public/openings error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Get opening schema (public)
app.get('/public/openings/:id/schema', async (req, res) => {
  try {
    const op = await getOpeningFromStore(req.params.id);
    if (!op) return res.status(404).json({ error: 'opening_not_found' });
    return res.json({ schema: op.schema || null });
  } catch (err) {
    console.error('GET /public/openings/:id/schema error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Save opening schema (public)
app.post('/public/openings/:id/schema', async (req, res) => {
  try {
    const id = req.params.id;
    const schema = req.body.schema;
    if (!schema || !Array.isArray(schema)) return res.status(400).json({ error: 'missing_or_invalid_schema' });
    const op = await getOpeningFromStore(id);
    if (!op) return res.status(404).json({ error: 'opening_not_found' });
    op.schema = schema;
    op.updatedAt = new Date().toISOString();
    await updateOpeningInStore(id, { schema: op.schema, updatedAt: op.updatedAt });
    console.log('[public POST /public/openings/:id/schema] saved schema for', id);
    return res.json({ ok: true, schema: op.schema });
  } catch (err) {
    console.error('POST /public/openings/:id/schema error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Delete opening publicly (no auth) — cascade delete forms (careful!)
app.delete('/public/openings/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const result = await deleteOpeningInStore(id);
    console.log(`[public DELETE /public/openings/${id}] removed opening`);
    return res.json(result);
  } catch (err) {
    console.error('DELETE /public/openings/:id error', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* -------------------------
   Public apply endpoint -> upload resume to Drive, append to Sheet, persist locally (unchanged behavior)
   ------------------------- */
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  try {
    const openingId = req.query.opening || req.body.opening;
    const src = req.query.src || req.body.src || 'unknown';
    if (!openingId) return res.status(400).json({ error: 'missing opening id' });

    // find opening from DB or files/legacy
    const opening = await getOpeningFromStore(openingId) || readData().openings.find(o => o.id === openingId);
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

    // persist responses: both DB (if available) and legacy data.json
    if (db) {
      try {
        await db.collection('responses').insertOne(resp);
      } catch (err) {
        console.warn('Failed to write response to DB, will fallback to file. err=', err && err.message);
      }
    }

    const data = readData();
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

// Start server after attempting Mongo connection (but fallback to file store)
connectMongo()
  .then(() => {
    console.log('[startup] Mongo attempt finished (connected or verified). Starting HTTP server...');
    app.listen(PORT, () => {
      console.log(`Backend listening on ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[startup] Mongo connection failed. Starting server with file-based fallback.', err && err.message);
    app.listen(PORT, () => {
      console.log(`Backend listening on ${PORT} (without Mongo)`);
    });
  });
