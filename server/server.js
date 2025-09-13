// server.js
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
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/** ---------- CONFIG ---------- **/
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-secret';

const DATA_DIR = path.resolve(__dirname, 'server_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DATA_FILE = path.join(DATA_DIR, 'data.json'); // legacy responses + users
const OPENINGS_FILE = path.join(DATA_DIR, 'openings.json');
const FORMS_FILE = path.join(DATA_DIR, 'forms.json');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || 'Sheet1'; // optional tab name
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
];

const MONGO_URI = process.env.MONGO_URI || null;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'hrtool';

/** ---------- HELPERS: FILE I/O ---------- **/
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
    console.log(`[writeJsonFileAtomic] wrote ${filePath}`);
  } catch (err) {
    console.error('[writeJsonFileAtomic] failed to write', filePath, err && err.stack);
    throw err;
  }
}

/** ---------- Legacy data.json helpers ---------- **/
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const base = { openings: [], responses: [], users: [] };
      writeJsonFileAtomic(DATA_FILE, base);
      console.log('[readData] data.json initialized at', DATA_FILE);
      return base;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : { openings: [], responses: [], users: [] };
    return parsed;
  } catch (err) {
    console.error('[readData] error', err && err.stack);
    return { openings: [], responses: [], users: [] };
  }
}
function writeData(obj) {
  try {
    writeJsonFileAtomic(DATA_FILE, obj);
  } catch (err) {
    console.error('[writeData] err', err && err.message);
  }
}

/** ---------- Ensure persistence files exist & migrate basic legacy data ---------- **/
function ensurePersistenceFilesAndMigrate() {
  if (!fs.existsSync(OPENINGS_FILE)) {
    const legacy = readData();
    const legacyOpenings = Array.isArray(legacy.openings) ? legacy.openings : [];
    if (legacyOpenings.length > 0) {
      writeJsonFileAtomic(OPENINGS_FILE, legacyOpenings);
      console.log('[migration] migrated openings from data.json -> openings.json');
    } else {
      writeJsonFileAtomic(OPENINGS_FILE, []);
    }
  }
  if (!fs.existsSync(FORMS_FILE)) writeJsonFileAtomic(FORMS_FILE, []);
  if (!fs.existsSync(QUESTIONS_FILE)) writeJsonFileAtomic(QUESTIONS_FILE, []);
}
ensurePersistenceFilesAndMigrate();

// serve fallback uploads if Drive fails (kept for compatibility but NOT used for successful flows)
app.use('/uploads', express.static(UPLOADS_DIR));

/** ---------- Google Drive & Sheets helpers ---------- **/
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

// Append row and return updatedRange if available
async function appendToSheetReturnRange(sheetId, tab, valuesArray) {
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set');
  const sheets = await getSheetsService();
  const range = `${tab}!A1`;
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [valuesArray] }
  });
  const updatedRange = res.data && res.data.updates && res.data.updates.updatedRange;
  return updatedRange || null;
}

// Update a specific A1 range (single row)
async function updateSheetRow(sheetId, rangeA1, valuesArray) {
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID not set');
  const sheets = await getSheetsService();
  const res = await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: rangeA1,
    valueInputOption: 'RAW',
    requestBody: { values: [valuesArray] }
  });
  return res.data;
}

// read a range
async function readSheetRange(sheetId, rangeA1) {
  const sheets = await getSheetsService();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: rangeA1 });
  return res.data && res.data.values ? res.data.values : [];
}

/** ---------- Multer / upload ---------- **/
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/** ---------- JWT helpers & auth middleware ---------- **/
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

/** ---------- Passport Google OAuth (unchanged behavior) ---------- **/
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

/** ---------- Robust Mongo connection ---------- **/
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
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      tls: true
    });
    console.log('[mongo] attempting to connect to Atlas...');
    await mongoClientInstance.connect();
    db = mongoClientInstance.db(MONGO_DB_NAME || undefined);
    console.log('✅ Connected to MongoDB:', db.databaseName || '(default from URI)');

    // create helpful indexes
    await Promise.allSettled([
      db.collection('openings').createIndex({ id: 1 }, { unique: true, sparse: true }),
      db.collection('forms').createIndex({ id: 1 }, { unique: true, sparse: true }),
      db.collection('responses').createIndex({ id: 1 }, { unique: true, sparse: true }),
      db.collection('questions').createIndex({ id: 1 }, { unique: true, sparse: true })
    ]);

    return db;
  } catch (err) {
    console.error('[mongo] Failed to connect to MongoDB:', err && (err.stack || err.message));
    db = null;
    try { if (mongoClientInstance) await mongoClientInstance.close(); } catch(e){}
    mongoClientInstance = null;
    throw err;
  }
}

/** ---------- Normalizers ---------- **/
function normalizeDoc(doc) { if (!doc) return doc; const copy = { ...doc }; delete copy._id; return copy; }

/** ---------- STORE HELPERS (openings/forms/questions/responses) ---------- **/

/* OPENINGS */
async function listOpeningsFromStore() {
  if (db) {
    const rows = await db.collection('openings').find({}).sort({ createdAt: -1 }).toArray();
    return rows.map(normalizeDoc);
  }
  return readJsonFile(OPENINGS_FILE, []);
}
async function getOpeningFromStore(id) {
  if (db) return normalizeDoc(await db.collection('openings').findOne({ id }));
  const arr = readJsonFile(OPENINGS_FILE, []);
  return arr.find(o => o.id === id);
}
async function createOpeningInStore(op) {
  if (db) { await db.collection('openings').insertOne(op); return op; }
  const arr = readJsonFile(OPENINGS_FILE, []);
  arr.unshift(op);
  writeJsonFileAtomic(OPENINGS_FILE, arr);
  return op;
}
async function updateOpeningInStore(id, fields) {
  if (db) {
    await db.collection('openings').updateOne({ id }, { $set: fields });
    return normalizeDoc(await db.collection('openings').findOne({ id }));
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
  const forms = readJsonFile(FORMS_FILE, []);
  const newForms = forms.filter(f => f.openingId !== id);
  if (newForms.length !== forms.length) writeJsonFileAtomic(FORMS_FILE, newForms);

  const data = readData();
  data.responses = (data.responses || []).filter(r => r.openingId !== id);
  writeData(data);
  return { ok: true, removedOpenings: removed };
}

/* FORMS */
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
  if (db) return normalizeDoc(await db.collection('forms').findOne({ id }));
  const arr = readJsonFile(FORMS_FILE, []);
  return arr.find(f => f.id === id);
}
async function createFormInStore(form) {
  if (db) { await db.collection('forms').insertOne(form); return form; }
  const arr = readJsonFile(FORMS_FILE, []);
  arr.push(form);
  writeJsonFileAtomic(FORMS_FILE, arr);
  return form;
}
async function updateFormInStore(id, patch) {
  if (db) {
    await db.collection('forms').updateOne({ id }, { $set: patch });
    return normalizeDoc(await db.collection('forms').findOne({ id }));
  }
  const arr = readJsonFile(FORMS_FILE, []);
  const idx = arr.findIndex(f => f.id === id);
  if (idx === -1) return null;
  arr[idx] = { ...arr[idx], ...patch, updated_at: new Date().toISOString() };
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

/* QUESTIONS */
async function listQuestionsFromStore() {
  if (db) {
    const rows = await db.collection('questions').find({}).sort({ createdAt: -1 }).toArray();
    return rows.map(normalizeDoc);
  }
  return readJsonFile(QUESTIONS_FILE, []);
}
async function getQuestionFromStore(id) {
  if (db) return normalizeDoc(await db.collection('questions').findOne({ id }));
  const arr = readJsonFile(QUESTIONS_FILE, []);
  return arr.find(q => q.id === id);
}
async function createQuestionInStore(q) {
  if (db) { await db.collection('questions').insertOne(q); return q; }
  const arr = readJsonFile(QUESTIONS_FILE, []);
  arr.unshift(q);
  writeJsonFileAtomic(QUESTIONS_FILE, arr);
  return q;
}
async function updateQuestionInStore(id, patch) {
  if (db) {
    await db.collection('questions').updateOne({ id }, { $set: patch });
    return normalizeDoc(await db.collection('questions').findOne({ id }));
  }
  const arr = readJsonFile(QUESTIONS_FILE, []);
  const idx = arr.findIndex(q => q.id === id);
  if (idx === -1) return null;
  arr[idx] = { ...arr[idx], ...patch, updatedAt: new Date().toISOString() };
  writeJsonFileAtomic(QUESTIONS_FILE, arr);
  return arr[idx];
}
async function deleteQuestionInStore(id) {
  if (db) {
    const res = await db.collection('questions').deleteOne({ id });
    return { ok: true, deleted: res.deletedCount || 0 };
  }
  const arr = readJsonFile(QUESTIONS_FILE, []);
  const newArr = arr.filter(q => q.id !== id);
  if (newArr.length === arr.length) return { ok: false, deleted: 0 };
  writeJsonFileAtomic(QUESTIONS_FILE, newArr);
  return { ok: true, deleted: arr.length - newArr.length };
}

/* RESPONSES */
async function listResponsesFromStore() {
  if (db) {
    const rows = await db.collection('responses').find({}).sort({ createdAt: -1 }).toArray();
    return rows.map(normalizeDoc);
  }
  const data = readData();
  return data.responses || [];
}
async function getResponseFromStore(id) {
  if (db) return normalizeDoc(await db.collection('responses').findOne({ id }));
  const data = readData();
  return (data.responses || []).find(r => r.id === id);
}
async function createResponseInStore(resp) {
  if (db) { await db.collection('responses').insertOne(resp); return resp; }
  const data = readData();
  data.responses.unshift(resp);
  writeData(data);
  return resp;
}
async function updateResponseInStore(id, patch) {
  if (db) {
    await db.collection('responses').updateOne({ id }, { $set: patch });
    return normalizeDoc(await db.collection('responses').findOne({ id }));
  }
  const data = readData();
  const idx = (data.responses || []).findIndex(r => r.id === id);
  if (idx === -1) return null;
  data.responses[idx] = { ...data.responses[idx], ...patch };
  writeData(data);
  return data.responses[idx];
}

/** ---------- ROUTES ---------- **/

// OAuth
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

// api/me
app.get('/api/me', authMiddleware, (req, res) => {
  const data = readData();
  const user = data.users.find(u => u.id === req.user.id || u.email === req.user.email);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  return res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

/* Openings CRUD (protected) */
app.get('/api/openings', authMiddleware, async (req, res) => {
  try { const rows = await listOpeningsFromStore(); return res.json(rows || []); }
  catch(err){ console.error('GET /api/openings', err); return res.status(500).json({ error: 'server_error' }); }
});
app.get('/api/openings/:id', authMiddleware, async (req, res) => {
  try { const item = await getOpeningFromStore(req.params.id); if (!item) return res.status(404).json({ error: 'opening_not_found' }); return res.json(item); }
  catch(err){ console.error('GET /api/openings/:id', err); return res.status(500).json({ error: 'server_error' }); }
});
app.post('/api/openings', authMiddleware, async (req, res) => {
  try {
    const payload = req.body || {};
    const op = { id: `op_${Date.now()}`, title: payload.title || 'Untitled', location: payload.location || 'Remote', department: payload.department || '', preferredSources: Array.isArray(payload.preferredSources) ? payload.preferredSources : (payload.preferredSources ? payload.preferredSources.split(',') : []), durationMins: payload.durationMins || 30, schema: payload.schema || null, createdAt: new Date().toISOString() };
    await createOpeningInStore(op);
    return res.json(op);
  } catch (err) { console.error('POST /api/openings', err); return res.status(500).json({ error: 'server_error' }); }
});
app.put('/api/openings/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const fields = {}; ['title','location','department','preferredSources','durationMins','schema'].forEach(f => { if (req.body[f] !== undefined) fields[f] = req.body[f]; });
    const updated = await updateOpeningInStore(id, fields);
    if (!updated) return res.status(404).json({ error: 'opening_not_found' });
    return res.json(updated);
  } catch (err) { console.error('PUT /api/openings/:id', err); return res.status(500).json({ error: 'server_error' }); }
});
app.delete('/api/openings/:id', authMiddleware, async (req, res) => {
  try { const id = req.params.id; const result = await deleteOpeningInStore(id); return res.json(result); }
  catch (err) { console.error('DELETE /api/openings/:id', err); return res.status(500).json({ error: 'server_error' }); }
});

/* Forms endpoints */
app.get('/api/forms', authMiddleware, async (req, res) => {
  try { const rows = await listFormsFromStore(req.query.openingId); return res.json(rows || []); }
  catch(err){ console.error('GET /api/forms', err); return res.status(500).json({ error: 'server_error' }); }
});
app.get('/api/forms/:id', authMiddleware, async (req, res) => {
  try { const f = await getFormFromStore(req.params.id); if (!f) return res.status(404).json({ error: 'form_not_found' }); return res.json(f); }
  catch(err){ console.error('GET /api/forms/:id', err); return res.status(500).json({ error: 'server_error' }); }
});

// ====== UPDATED: POST /api/forms - server generates canonical meta on publish ======
app.post('/api/forms', authMiddleware, async (req, res) => {
  try {
    const { openingId, data } = req.body || {};
    if (!openingId) return res.status(400).json({ error: 'openingId_required' });
    const op = await getOpeningFromStore(openingId);
    if (!op) return res.status(400).json({ error: 'invalid_openingId' });

    const id = `form_${Date.now()}`;
    const now = new Date().toISOString();
    const formData = data || {};

    // If client requested publish, ensure server generates canonical meta
    if (formData.meta && formData.meta.isPublished) {
      const formId = id;
      const publishedAt = now;
      const frontendBase = FRONTEND_URL.replace(/\/$/, '');
      const genericLink = `${frontendBase}/apply/${formId}?opening=${encodeURIComponent(openingId)}`;
      const sources = Array.isArray(op.preferredSources) && op.preferredSources.length ? op.preferredSources : ['generic'];
      const shareLinks = {};
      sources.forEach(src => {
        shareLinks[src] = `${frontendBase}/apply/${formId}?opening=${encodeURIComponent(openingId)}&src=${encodeURIComponent(src)}`;
      });
      formData.meta = { ...formData.meta, formId, isPublished: true, publishedAt, genericLink, shareLinks };
    } else {
      // keep meta null or as provided (non-published)
      formData.meta = formData.meta || null;
    }

    const newForm = { id, openingId, data: formData, created_at: now, updated_at: now };
    await createFormInStore(newForm);
    console.log('[forms] created form', newForm.id, 'meta=', newForm.data && newForm.data.meta ? 'present' : 'none');
    return res.status(201).json(newForm);
  } catch (err) { console.error('POST /api/forms', err); return res.status(500).json({ error: 'server_error' }); }
});

// ====== UPDATED: PUT /api/forms/:id - augment/generate meta when publishing ======
app.put('/api/forms/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const incomingData = req.body.data !== undefined ? req.body.data : undefined;
    const now = new Date().toISOString();

    const existing = await getFormFromStore(id);
    if (!existing) return res.status(404).json({ error: 'form_not_found' });

    const patched = {};
    if (incomingData !== undefined) {
      patched.data = incomingData;
      patched.updated_at = now;
    } else {
      patched.updated_at = now;
    }

    // determine whether this form will be published (incoming request or already published)
    const willPublish = (incomingData && incomingData.meta && incomingData.meta.isPublished) || (existing.data && existing.data.meta && existing.data.meta.isPublished);
    if (willPublish) {
      const openingId = existing.openingId || (patched.data && patched.data.openingId) || null;
      const op = openingId ? await getOpeningFromStore(openingId) : null;
      const formId = existing.id || id;
      const publishedAt = (incomingData && incomingData.meta && incomingData.meta.publishedAt) || (existing.data && existing.data.meta && existing.data.meta.publishedAt) || now;

      const clientMeta = (incomingData && incomingData.meta) ? { ...incomingData.meta } : (existing.data && existing.data.meta) ? { ...existing.data.meta } : {};
      clientMeta.formId = clientMeta.formId || formId;
      clientMeta.isPublished = true;
      clientMeta.publishedAt = clientMeta.publishedAt || publishedAt;

      const frontendBase = FRONTEND_URL.replace(/\/$/, '');
      clientMeta.genericLink = clientMeta.genericLink || `${frontendBase}/apply/${clientMeta.formId}?opening=${encodeURIComponent(openingId)}`;

      if (!clientMeta.shareLinks) {
        const sources = (op && Array.isArray(op.preferredSources) && op.preferredSources.length) ? op.preferredSources : ['generic'];
        const shareLinks = {};
        sources.forEach(src => {
          shareLinks[src] = `${frontendBase}/apply/${clientMeta.formId}?opening=${encodeURIComponent(openingId)}&src=${encodeURIComponent(src)}`;
        });
        clientMeta.shareLinks = shareLinks;
      }

      patched.data = patched.data || existing.data || {};
      patched.data.meta = clientMeta;
    }

    const updated = await updateFormInStore(id, patched);
    if (!updated) return res.status(404).json({ error: 'form_not_found' });
    console.log('[forms] updated form', id, 'meta=', updated.data && updated.data.meta ? 'present' : 'none');
    return res.json(updated);
  } catch (err) { console.error('PUT /api/forms/:id', err); return res.status(500).json({ error: 'server_error' }); }
});

app.delete('/api/forms/:id', authMiddleware, async (req, res) => {
  try { const id = req.params.id; const result = await deleteFormInStore(id); return res.json(result); }
  catch (err) { console.error('DELETE /api/forms/:id', err); return res.status(500).json({ error: 'server_error' }); }
});

// Attach an existing question to a form (creates reference entry)
app.post('/api/forms/:id/add-question', authMiddleware, async (req, res) => {
  try {
    const formId = req.params.id;
    const { questionId, position, localLabel, localRequired } = req.body;
    if (!questionId) return res.status(400).json({ error: 'questionId_required' });
    const form = await getFormFromStore(formId);
    if (!form) return res.status(404).json({ error: 'form_not_found' });
    form.data = form.data || {}; form.data.questions = form.data.questions || [];
    const entry = { questionId, localLabel: localLabel || null, localRequired: typeof localRequired === 'boolean' ? localRequired : null };
    if (position === undefined || position === null || position >= form.data.questions.length) form.data.questions.push(entry);
    else form.data.questions.splice(position, 0, entry);
    await updateFormInStore(form.id, { data: form.data, updated_at: new Date().toISOString() });
    return res.json({ ok: true, form });
  } catch (err) { console.error('POST /api/forms/:id/add-question', err); return res.status(500).json({ error: 'server_error' }); }
});

/* Questions endpoints */
app.get('/api/questions', authMiddleware, async (req, res) => {
  try { const rows = await listQuestionsFromStore(); return res.json(rows || []); }
  catch (err) { console.error('GET /api/questions', err); return res.status(500).json({ error: 'server_error' }); }
});
app.post('/api/questions', authMiddleware, async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.type || !payload.label) return res.status(400).json({ error: 'type_and_label_required' });
    const q = { id: `q_${Date.now()}`, type: payload.type, label: payload.label, required: !!payload.required, options: Array.isArray(payload.options) ? payload.options : (payload.options ? payload.options.split('\n').map(s=>s.trim()).filter(Boolean) : []), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), meta: payload.meta || {} };
    await createQuestionInStore(q);
    return res.status(201).json(q);
  } catch (err) { console.error('POST /api/questions', err); return res.status(500).json({ error: 'server_error' }); }
});
app.put('/api/questions/:id', authMiddleware, async (req, res) => {
  try { const id = req.params.id; const patch = { ...req.body, updatedAt: new Date().toISOString() }; const updated = await updateQuestionInStore(id, patch); if (!updated) return res.status(404).json({ error: 'question_not_found' }); return res.json(updated); }
  catch (err) { console.error('PUT /api/questions/:id', err); return res.status(500).json({ error: 'server_error' }); }
});
app.delete('/api/questions/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const forms = await listFormsFromStore();
    const used = forms.some(f => (f.data && Array.isArray(f.data.questions) && f.data.questions.some(q => q.questionId === id)));
    if (used) return res.status(400).json({ error: 'question_in_use' });
    const result = await deleteQuestionInStore(id);
    return res.json(result);
  } catch (err) { console.error('DELETE /api/questions/:id', err); return res.status(500).json({ error: 'server_error' }); }
});

/* Responses endpoints */
app.get('/api/responses', authMiddleware, async (req, res) => {
  try { const rows = await listResponsesFromStore(); return res.json(rows || []); }
  catch (err) { console.error('GET /api/responses', err); return res.status(500).json({ error: 'server_error' }); }
});
app.get('/api/responses/:id', authMiddleware, async (req, res) => {
  try { const r = await getResponseFromStore(req.params.id); if (!r) return res.status(404).json({ error: 'response_not_found' }); return res.json(r); }
  catch (err) { console.error('GET /api/responses/:id', err); return res.status(500).json({ error: 'server_error' }); }
});

// Update a candidate's status (persist to DB/files + update sheet row if known)
app.put('/api/responses/:id/status', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'missing_status' });

    let updatedResp = null;
    // Update in DB or file
    const now = new Date().toISOString();
    if (db) {
      const updateRes = await db.collection('responses').findOneAndUpdate({ id }, { $set: { status, updatedAt: now } }, { returnDocument: 'after' });
      if (!updateRes.value) return res.status(404).json({ error: 'response_not_found' });
      updatedResp = normalizeDoc(updateRes.value);
    } else {
      const data = readData();
      const idx = (data.responses || []).findIndex(r => r.id === id);
      if (idx === -1) return res.status(404).json({ error: 'response_not_found' });
      data.responses[idx].status = status;
      data.responses[idx].updatedAt = now;
      writeData(data);
      updatedResp = data.responses[idx];
    }

    // If sheetRange stored, update that row in Google Sheet
    if (SHEET_ID && updatedResp && updatedResp.sheetRange) {
      try {
        // Determine the sheet tab from sheetRange (e.g. "Sheet1!A5:F5" => "Sheet1")
        const sheetRange = updatedResp.sheetRange;
        const sheetName = sheetRange.split('!')[0];
        // read header row to find 'Status' column
        const header = (await readSheetRange(SHEET_ID, `${sheetName}!1:1`))[0] || [];
        let statusIndex = header.findIndex(h => (h || '').toString().toLowerCase().trim() === 'status');
        // read existing row values
        const existingRow = (await readSheetRange(SHEET_ID, sheetRange))[0] || [];
        if (statusIndex === -1) {
          // append status as next column (extend existingRow)
          statusIndex = existingRow.length; // 0-based index
        }
        while (existingRow.length <= statusIndex) existingRow.push('');
        existingRow[statusIndex] = status;
        // convert statusIndex (0-based) to A1 range columns: we will update the exact same range (sheetRange)
        await updateSheetRow(SHEET_ID, sheetRange, existingRow);
        console.log(`[api] updated sheet ${sheetRange} with status=${status}`);
      } catch (err) {
        console.error('Failed to update Google Sheet row for response', id, err && err.message);
        return res.status(200).json({ ok: true, updatedResp, sheetUpdate: 'failed', sheetError: (err && err.message) });
      }
    }

    return res.json({ ok: true, updatedResp });
  } catch (err) {
    console.error('PUT /api/responses/:id/status error', err && err.stack);
    return res.status(500).json({ error: 'server_error', message: err?.message || 'unknown' });
  }
});

/* Public endpoints for openings/schema - work with OPENINGS_FILE or DB */
app.get('/public/openings', async (req, res) => {
  try { const rows = await listOpeningsFromStore(); return res.json(rows || []); }
  catch (err) { console.error('GET /public/openings', err); return res.status(500).json({ error: 'server_error' }); }
});
app.post('/public/openings', async (req, res) => {
  try {
    const payload = req.body || {};
    const op = { id: `op_${Date.now()}`, title: payload.title || 'Untitled', location: payload.location || 'Remote', department: payload.department || '', preferredSources: Array.isArray(payload.preferredSources) ? payload.preferredSources : (payload.preferredSources ? payload.preferredSources.split(',') : []), durationMins: payload.durationMins || 30, schema: payload.schema || null, createdAt: new Date().toISOString() };
    await createOpeningInStore(op);
    return res.json(op);
  } catch (err) { console.error('POST /public/openings', err); return res.status(500).json({ error: 'server_error' }); }
});
app.get('/public/openings/:id/schema', async (req, res) => {
  try { const op = await getOpeningFromStore(req.params.id); if (!op) return res.status(404).json({ error: 'opening_not_found' }); return res.json({ schema: op.schema || null }); }
  catch (err) { console.error('GET /public/openings/:id/schema', err); return res.status(500).json({ error: 'server_error' }); }
});
app.post('/public/openings/:id/schema', async (req, res) => {
  try {
    const id = req.params.id;
    const schema = req.body.schema;
    if (!schema || !Array.isArray(schema)) return res.status(400).json({ error: 'missing_or_invalid_schema' });
    const op = await getOpeningFromStore(id);
    if (!op) return res.status(404).json({ error: 'opening_not_found' });
    op.schema = schema; op.updatedAt = new Date().toISOString();
    await updateOpeningInStore(id, { schema: op.schema, updatedAt: op.updatedAt });
    return res.json({ ok: true, schema: op.schema });
  } catch (err) { console.error('POST /public/openings/:id/schema', err); return res.status(500).json({ error: 'server_error' }); }
});

/*
  NEW: Protected endpoints to get/update an opening's schema.
  Purpose: frontend modal (form editor per-opening) can fetch and persist schema directly on the opening
  without needing to manage separate "forms" entries. This keeps the Form tab removable while keeping
  functionality for per-opening forms via the opening.schema field.
*/
app.get('/api/openings/:id/schema', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const op = await getOpeningFromStore(id);
    if (!op) return res.status(404).json({ error: 'opening_not_found' });
    return res.json({ schema: op.schema || null });
  } catch (err) {
    console.error('GET /api/openings/:id/schema', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

app.put('/api/openings/:id/schema', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const schema = req.body.schema;
    if (!schema || !Array.isArray(schema)) return res.status(400).json({ error: 'missing_or_invalid_schema' });
    const op = await getOpeningFromStore(id);
    if (!op) return res.status(404).json({ error: 'opening_not_found' });
    op.schema = schema;
    const updatedAt = new Date().toISOString();
    await updateOpeningInStore(id, { schema: op.schema, updatedAt });
    return res.json({ ok: true, schema: op.schema });
  } catch (err) {
    console.error('PUT /api/openings/:id/schema', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* Apply endpoint - store response, upload resume to Drive (strict: no local fallback), append to Sheet and record sheetRange */
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  try {
    const openingId = req.query.opening || req.body.opening;
    const src = req.query.src || req.body.src || 'unknown';
    if (!openingId) return res.status(400).json({ error: 'missing opening id' });

    const opening = await getOpeningFromStore(openingId) || readData().openings.find(o => o.id === openingId);
    const openingTitle = opening ? opening.title : null;

    // resume upload (strict: require Drive upload to succeed)
    let resumeLink = null;
    if (req.file && req.file.buffer) {
      const filename = `${Date.now()}_${(req.file.originalname || 'resume')}`;

      // If DRIVE_FOLDER_ID not configured, return config error to caller
      if (!DRIVE_FOLDER_ID) {
        console.error('Drive folder ID not set; cannot upload resume.');
        return res.status(500).json({ error: 'drive_config_missing', message: 'Server is not configured to upload resumes to Google Drive. Please contact the administrator.' });
      }

      try {
        // Upload to Drive and set public read permission (best-effort)
        const bufferStream = new stream.PassThrough(); bufferStream.end(req.file.buffer);
        const drive = await getDriveService();
        const created = await drive.files.create({
          requestBody: { name: filename, parents: [DRIVE_FOLDER_ID] },
          media: { mimeType: req.file.mimetype || 'application/octet-stream', body: bufferStream },
          supportsAllDrives: true,
          fields: 'id, webViewLink, webContentLink'
        });

        const fileId = created.data && created.data.id;
        if (!fileId) {
          throw new Error('no_file_id_returned');
        }

        // make file readable by anyone (best-effort; ignore permission errors but still return link)
        try {
          await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true });
        } catch (permErr) {
          console.warn('drive.permissions.create failed (may be org policy) - continuing, permission error:', permErr && permErr.message);
        }

        // fetch metadata to pick best link
        const meta = await drive.files.get({ fileId, fields: 'id, webViewLink, webContentLink' }).catch(() => null);
        resumeLink = (meta && (meta.data && (meta.data.webViewLink || meta.data.webContentLink))) || `https://drive.google.com/file/d/${fileId}/view`;
        console.log('Drive upload success:', resumeLink);
      } catch (err) {
        console.error('Drive upload failed:', err && (err.stack || err.message));
        // IMPORTANT: do NOT save file locally. Inform frontend to re-upload.
        return res.status(502).json({ error: 'drive_upload_failed', message: 'Resume upload to Google Drive failed. Please re-upload your resume.' });
      }
    } else {
      // No file uploaded — still allow (maybe form without resume), but set resumeLink null
      console.log('No resume file provided in submission.');
    }

    const answers = {};
    Object.keys(req.body || {}).forEach(k => { answers[k] = req.body[k]; });

    let sheetRange = null;
    // build row as [timestamp, openingId, openingTitle, src, resumeLink, JSON.stringify(answers)]
    const rowVals = [ new Date().toISOString(), openingId, openingTitle || '', src, resumeLink || '', JSON.stringify(answers) ];
    if (SHEET_ID) {
      try {
        sheetRange = await appendToSheetReturnRange(SHEET_ID, SHEET_TAB, rowVals);
        console.log('Appended to sheet, range=', sheetRange);
      } catch (err) {
        console.error('appendToSheet error', err && err.message);
        sheetRange = null;
      }
    }

    const resp = { id: `resp_${Date.now()}`, openingId, openingTitle, source: src, resumeLink: resumeLink || null, answers, createdAt: new Date().toISOString(), sheetRange, status: 'Applied' };

    // persist to DB & file (file kept as legacy)
    try { await createResponseInStore(resp); } catch(e){ console.error('Failed to persist response to store', e && e.message); }

    // Respond success (resumeLink always from Drive when present)
    return res.json({ ok: true, resumeLink, sheetRange });
  } catch (err) {
    console.error('Error in /api/apply', err && err.stack);
    return res.status(500).json({ error: 'server_error', message: err?.message || 'unknown' });
  }
});

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

/** ---------- STARTUP: try Mongo, fallback to files ---------- **/
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
