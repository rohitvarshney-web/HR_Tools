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


/** ---------- Stage -> allowed statuses mapping (single source of truth) ---------- **/
const stageStatusMapping = {
  "Applied": [
    "Pending", // Default
    "Rejected",
    "Candidate Withdrew"
  ],

  "Introductory call": [
    "Pending", // Default
    "Slot Not Selected",
    "Scheduled",
    "To be rescheduled",
    "No Show (To be rescheduled)",
    "Rejected",
    "Ghosted",
    "On Hold",
    "Withdrew",
    "Candidate Withdrew"
  ],

  "In-person Interview": [
    "Pending", // Default
    "Slot Not Selected",
    "Scheduled",
    "To be rescheduled",
    "No Show (To be rescheduled)",
    "Feedback Pending",
    "Rejected",
    "Ghosted",
    "On Hold",
    "Candidate Withdrew"
  ],

  "Virtual Interview01": [
    "Pending", // Default
    "Slot Not Selected",
    "Scheduled",
    "To be rescheduled",
    "No Show (To be rescheduled)",
    "Feedback Pending",
    "Rejected",
    "Ghosted",
    "On Hold",
    "Candidate Withdrew"
  ],

  "Virtual Interview02": [
    "Pending", // Default
    "Slot Not Selected",
    "Scheduled",
    "To be rescheduled",
    "No Show (To be rescheduled)",
    "Feedback Pending",
    "Rejected",
    "Ghosted",
    "On Hold",
    "Candidate Withdrew"
  ],

  "Virtual Interview 03": [
    "Pending", // Default
    "Slot Not Selected",
    "Scheduled",
    "To be rescheduled",
    "No Show (To be rescheduled)",
    "Feedback Pending",
    "Rejected",
    "Ghosted",
    "On Hold",
    "Candidate Withdrew"
  ],

  "Problem statement": [
    "Pending", //Default
    "Sent",
    "Rejected",
    "Ghosted",
    "On Hold",
    "Candidate Withdrew"
  ],

  "Aptitude test": [
    "Pending", //Default
    "Sent",
    "Scheduled",
    "Rejected",
    "Ghosted",
    "On Hold",
    "Candidate Withdrew"
  ],

  "Final interview": [
    "Pending", // Default
    "Slot Not Selected",
    "Scheduled",
    "To be rescheduled",
    "No Show (To be rescheduled)",
    "Feedback Pending",
    "Rejected",
    "Ghosted",
    "On Hold",
    "Candidate Withdrew"
  ],

  "Offer Stage": [
    "Offered", // Default
    "Offer Accepted",
    "Offer Declined",
    "Offer Revoked",
    "Candidate Withdrew"
  ],

  "Joined": [
    "To be joining", //Default
    "Joined"
  ]
};


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

/** ---------- Startup migration helper: ensure is_deleted exists ---------- **/
async function ensureIsDeletedField() {
  if (!db) return;
  const collections = ['openings', 'forms', 'responses'];
  for (const col of collections) {
    try {
      const res = await db.collection(col).updateMany(
        { is_deleted: { $exists: false } },
        { $set: { is_deleted: false } }
      );
      const matched = res.matchedCount !== undefined ? res.matchedCount : (res.n || 0);
      const modified = res.modifiedCount !== undefined ? res.modifiedCount : (res.nModified || 0);
      console.log(`[migration:is_deleted] ${col}: matched=${matched}, modified=${modified}`);
    } catch (err) {
      console.error(`[migration:is_deleted] error on ${col}`, err && err.message);
    }
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
  // ensure is_deleted default exists
  if (op.is_deleted === undefined) op.is_deleted = false;
  if (db) { await db.collection('openings').insertOne(op); return op; }
  const arr = readJsonFile(OPENINGS_FILE, []);
  arr.unshift(op);
  writeJsonFileAtomic(OPENINGS_FILE, arr);
  return op;
}
async function updateOpeningInStore(id, fields) {
  // only persist is_deleted if explicitly provided (caller controls it)
  // if fields.is_deleted is undefined, we don't alter the field
  const patch = { ...fields };
  if (patch.is_deleted === undefined) delete patch.is_deleted;
  if (db) {
    await db.collection('openings').updateOne({ id }, { $set: patch });
    return normalizeDoc(await db.collection('openings').findOne({ id }));
  }
  const arr = readJsonFile(OPENINGS_FILE, []);
  const idx = arr.findIndex(o => o.id === id);
  if (idx === -1) return null;
  arr[idx] = { ...arr[idx], ...patch };
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
async function getFormForOpeningFromStore(openingId) {
  const forms = await listFormsFromStore(openingId);
  return (forms && forms.length) ? forms[0] : null;
}
async function createFormInStore(form) {
  if (form.is_deleted === undefined) form.is_deleted = false;
  if (db) { await db.collection('forms').insertOne(form); return form; }
  const arr = readJsonFile(FORMS_FILE, []);
  arr.push(form);
  writeJsonFileAtomic(FORMS_FILE, arr);
  return form;
}
async function updateFormInStore(id, patch) {
  const p = { ...patch };
  if (p.is_deleted === undefined) delete p.is_deleted;
  if (db) {
    await db.collection('forms').updateOne({ id }, { $set: p });
    return normalizeDoc(await db.collection('forms').findOne({ id }));
  }
  const arr = readJsonFile(FORMS_FILE, []);
  const idx = arr.findIndex(f => f.id === id);
  if (idx === -1) return null;
  arr[idx] = { ...arr[idx], ...p, updated_at: new Date().toISOString() };
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
  if (!id) return null;
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
async function listResponsesFromStore(query = {}) {
  // accept optional query filter { openingId }
  if (db) {
    const q = {};
    if (query.openingId) q.openingId = query.openingId;
    const rows = await db.collection('responses').find(q).sort({ createdAt: -1 }).toArray();
    return rows.map(normalizeDoc);
  }
  const data = readData();
  const arr = data.responses || [];
  if (query.openingId) return arr.filter(r => r.openingId === query.openingId);
  return arr;
}
async function getResponseFromStore(id) {
  if (db) return normalizeDoc(await db.collection('responses').findOne({ id }));
  const data = readData();
  return (data.responses || []).find(r => r.id === id);
}
async function createResponseInStore(resp) {
  if (resp.is_deleted === undefined) resp.is_deleted = false;
  if (db) { await db.collection('responses').insertOne(resp); return resp; }
  const data = readData();
  data.responses.unshift(resp);
  writeData(data);
  return resp;
}
async function updateResponseInStore(id, patch) {
  const p = { ...patch };
  if (p.is_deleted === undefined) delete p.is_deleted;
  if (db) {
    await db.collection('responses').updateOne({ id }, { $set: p });
    return normalizeDoc(await db.collection('responses').findOne({ id }));
  }
  const data = readData();
  const idx = (data.responses || []).findIndex(r => r.id === id);
  if (idx === -1) return null;
  data.responses[idx] = { ...data.responses[idx], ...p };
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
    const op = { id: `op_${Date.now()}`, title: payload.title || 'Untitled', location: payload.location || 'Remote', department: payload.department || '', preferredSources: Array.isArray(payload.preferredSources) ? payload.preferredSources : (payload.preferredSources ? payload.preferredSources.split(',') : []), durationMins: payload.durationMins || 30, schema: payload.schema || null, createdAt: new Date().toISOString(), is_deleted: false };
    await createOpeningInStore(op);
    return res.json(op);
  } catch (err) { console.error('POST /api/openings', err); return res.status(500).json({ error: 'server_error' }); }
});
app.put('/api/openings/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const fields = {}; ['title','location','department','preferredSources','durationMins','schema','is_deleted'].forEach(f => { if (req.body[f] !== undefined) fields[f] = req.body[f]; });
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
app.post('/api/forms', authMiddleware, async (req, res) => {
  try {
    const { openingId, data } = req.body || {};
    if (!openingId) return res.status(400).json({ error: 'openingId_required' });
    const op = await getOpeningFromStore(openingId);
    if (!op) return res.status(400).json({ error: 'invalid_openingId' });
    const id = `form_${Date.now()}`;
    const now = new Date().toISOString();
    const newForm = { id, openingId, data: data || {}, created_at: now, updated_at: now, is_deleted: false };
    await createFormInStore(newForm);
    return res.status(201).json(newForm);
  } catch (err) { console.error('POST /api/forms', err); return res.status(500).json({ error: 'server_error' }); }
});
app.put('/api/forms/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const patch = req.body.data !== undefined ? { data: req.body.data, updated_at: new Date().toISOString() } : { updated_at: new Date().toISOString() };
    if (req.body.is_deleted !== undefined) patch.is_deleted = req.body.is_deleted;
    const updated = await updateFormInStore(id, patch);
    if (!updated) return res.status(404).json({ error: 'form_not_found' });
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


// Return full mapping (protected — optional; require auth)
app.get('/api/stages-statuses', authMiddleware, (req, res) => {
  return res.json(stageStatusMapping);
});

// Compatibility route: frontend expects /api/stage-status-mapping
app.get('/api/stage-status-mapping', authMiddleware, (req, res) => {
  return res.json(stageStatusMapping);
});

// Return statuses for a single stage (protected)
app.get('/api/stages/:stage/statuses', authMiddleware, (req, res) => {
  const stage = req.params.stage;
  if (!stage) return res.status(400).json({ error: 'missing_stage' });
  const statuses = stageStatusMapping[stage];
  if (!statuses) return res.status(404).json({ error: 'stage_not_found' });
  return res.json({ stage, statuses });
});



/* Responses endpoints */
// Support optional query ?openingId= to return only responses for a given opening
app.get('/api/responses', authMiddleware, async (req, res) => {
  try {
    const openingId = req.query.openingId;
    const rows = await listResponsesFromStore(openingId ? { openingId } : {});
    return res.json(rows || []);
  } catch (err) { console.error('GET /api/responses', err); return res.status(500).json({ error: 'server_error' }); }
});
app.get('/api/responses/:id', authMiddleware, async (req, res) => {
  try { const r = await getResponseFromStore(req.params.id); if (!r) return res.status(404).json({ error: 'response_not_found' }); return res.json(r); }
  catch (err) { console.error('GET /api/responses/:id', err); return res.status(500).json({ error: 'server_error' }); }
});

// Generic update for a response (used by frontend to update fields like is_deleted)
app.put('/api/responses/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const patch = { ...req.body };
    // protect id field
    delete patch.id;
    patch.updatedAt = new Date().toISOString();
    const updated = await updateResponseInStore(id, patch);
    if (!updated) return res.status(404).json({ error: 'response_not_found' });
    return res.json({ ok: true, updated });
  } catch (err) {
    console.error('PUT /api/responses/:id error', err && err.stack);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Update a candidate's status (persist to DB/files + update sheet row if known)
app.put('/api/responses/:id/status', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { status, stage: requestedStage } = req.body;
    if (!status) return res.status(400).json({ error: 'missing_status' });

    let updatedResp = null;
    const now = new Date().toISOString();

    // Helper to try update by different selectors
    async function tryUpdate(selector) {
      if (!db) return null;
      const updateRes = await db.collection('responses').findOneAndUpdate(
        selector,
        { $set: { status, updatedAt: now } },
        { returnDocument: 'after' }
      );
      return updateRes && updateRes.value ? normalizeDoc(updateRes.value) : null;
    }

    // Helper: fetch existing response (by id or ObjectId)
    async function fetchExistingResponseById(rawId) {
      if (!db) return null;
      let doc = await db.collection('responses').findOne({ id: rawId });
      if (doc) return normalizeDoc(doc);
      // try ObjectId if looks like one
      if (/^[0-9a-fA-F]{24}$/.test(rawId)) {
        try {
          const { ObjectId } = require('mongodb');
          doc = await db.collection('responses').findOne({ _id: new ObjectId(rawId) });
          return doc ? normalizeDoc(doc) : null;
        } catch (e) {
          // ignore conversion errors
        }
      }
      return null;
    }

    // Helper: validate status against mapping for a stage (mapping may not have entry)
    // stageCandidates is array of possible stages, first matching mapping will be used.
    function validateStatusForStage(stageCandidates = []) {
      for (const s of stageCandidates) {
        if (!s) continue;
        const allowed = stageStatusMapping && stageStatusMapping[s];
        if (allowed) {
          if (!allowed.includes(status)) {
            return { ok: false, stage: s, allowed };
          }
          return { ok: true, stage: s, allowed };
        }
      }
      // No mapping found for any candidate stage -> treat as allowed (no mapping to validate against)
      return { ok: true, stage: null, allowed: null };
    }

    if (db) {
      // fetch response first so we can validate stage -> status
      const existingResp = await fetchExistingResponseById(id);

      // build candidates: explicit requestedStage first, then fields on existing response
      const stageCandidates = [];
      if (requestedStage) stageCandidates.push(requestedStage);
      if (existingResp) {
        if (existingResp.stage) stageCandidates.push(existingResp.stage);
        if (existingResp.currentStage) stageCandidates.push(existingResp.currentStage);
        if (existingResp.current_stage) stageCandidates.push(existingResp.current_stage);
      }

      const validation = validateStatusForStage(stageCandidates);
      if (!validation.ok) {
        return res.status(400).json({ error: 'status_not_allowed_for_stage', stage: validation.stage, allowed: validation.allowed });
      }

      // If caller provided explicit stage and response exists, optionally persist the stage as well
      if (requestedStage && existingResp) {
        try {
          await db.collection('responses').updateOne({ id: existingResp.id }, { $set: { stage: requestedStage, updatedAt: now } });
        } catch (err) {
          // non-fatal: log and continue
          console.warn('Failed to persist stage on response:', err && err.message);
        }
      }

      // perform the status update (try by id)
      updatedResp = await tryUpdate({ id });

      // fallback: if not found by id, try ObjectId selector (if id looks like one)
      if (!updatedResp && /^[0-9a-fA-F]{24}$/.test(id)) {
        try {
          const { ObjectId } = require('mongodb');
          updatedResp = await tryUpdate({ _id: new ObjectId(id) });
        } catch (e) {
          // ignore conversion errors
        }
      }

      // If still not found, return 404
      if (!updatedResp) {
        return res.status(404).json({ error: 'response_not_found' });
      }
    } else {
      // file-backed store
      const data = readData();
      const idx = (data.responses || []).findIndex(r => r.id === id);
      if (idx === -1) return res.status(404).json({ error: 'response_not_found' });

      // Build stageCandidates from requestedStage and stored fields
      const stored = data.responses[idx];
      const stageCandidates = [];
      if (requestedStage) stageCandidates.push(requestedStage);
      if (stored.stage) stageCandidates.push(stored.stage);
      if (stored.currentStage) stageCandidates.push(stored.currentStage);
      if (stored.current_stage) stageCandidates.push(stored.current_stage);

      const validation = validateStatusForStage(stageCandidates);
      if (!validation.ok) {
        return res.status(400).json({ error: 'status_not_allowed_for_stage', stage: validation.stage, allowed: validation.allowed });
      }

      // optionally persist stage
      if (requestedStage) data.responses[idx].stage = requestedStage;

      data.responses[idx].status = status;
      data.responses[idx].updatedAt = now;
      writeData(data);
      updatedResp = data.responses[idx];
    }

    // If sheetRange stored, update that row in Google Sheet (same as before)
    if (SHEET_ID && updatedResp && updatedResp.sheetRange) {
      try {
        const sheetRange = updatedResp.sheetRange;
        const sheetName = sheetRange.split('!')[0];
        const header = (await readSheetRange(SHEET_ID, `${sheetName}!1:1`))[0] || [];
        let statusIndex = header.findIndex(h => (h || '').toString().toLowerCase().trim() === 'status');
        const existingRow = (await readSheetRange(SHEET_ID, sheetRange))[0] || [];
        if (statusIndex === -1) {
          statusIndex = existingRow.length;
        }
        while (existingRow.length <= statusIndex) existingRow.push('');
        existingRow[statusIndex] = status;
        await updateSheetRow(SHEET_ID, sheetRange, existingRow);
        console.log(`[api] updated sheet ${sheetRange} with status=${status}`);
      } catch (err) {
        console.error('Failed to update Google Sheet row for response', id, err && err.message);
        // don't fail the whole request for sheet errors; return success with sheetUpdate:failed
        return res.status(200).json({ ok: true, updatedResp, sheetUpdate: 'failed', sheetError: (err && err.message) });
      }
    }

    return res.json({ ok: true, updatedResp });
  } catch (err) {
    console.error('PUT /api/responses/:id/status error', err && err.stack);
    return res.status(500).json({ error: 'server_error', message: err?.message || 'unknown' });
  }
});



/** ---------- Toggle endpoints (is_deleted + cascade) ---------- **/

// Toggle opening is_deleted and cascade to forms + responses
app.patch('/api/openings/:id/toggle-delete', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { is_deleted } = req.body;
    const opening = await getOpeningFromStore(id);
    if (!opening) return res.status(404).json({ error: 'opening_not_found' });

    const newVal = typeof is_deleted === 'boolean' ? is_deleted : !opening.is_deleted;

    // update opening
    await updateOpeningInStore(id, { is_deleted: newVal, updatedAt: new Date().toISOString() });

    // cascade forms
    const forms = await listFormsFromStore(id);
    for (const f of forms) {
      await updateFormInStore(f.id, { is_deleted: newVal, updated_at: new Date().toISOString() });
    }

    // cascade responses
    const responses = await listResponsesFromStore();
    const filtered = responses.filter(r => r.openingId === id);
    for (const r of filtered) {
      await updateResponseInStore(r.id, { is_deleted: newVal, updatedAt: new Date().toISOString() });
    }

    return res.json({ ok: true, openingId: id, is_deleted: newVal });
  } catch (err) {
    console.error('PATCH /api/openings/:id/toggle-delete error', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

// Toggle response is_deleted independently
app.patch('/api/responses/:id/toggle-delete', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const response = await getResponseFromStore(id);
    if (!response) return res.status(404).json({ error: 'response_not_found' });

    const newVal = typeof req.body.is_deleted === 'boolean' ? req.body.is_deleted : !response.is_deleted;
    const updated = await updateResponseInStore(id, { is_deleted: newVal, updatedAt: new Date().toISOString() });

    return res.json({ ok: true, responseId: id, is_deleted: newVal, updated });
  } catch (err) {
    console.error('PATCH /api/responses/:id/toggle-delete error', err);
    return res.status(500).json({ error: 'server_error' });
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
    const op = { id: `op_${Date.now()}`, title: payload.title || 'Untitled', location: payload.location || 'Remote', department: payload.department || '', preferredSources: Array.isArray(payload.preferredSources) ? payload.preferredSources : (payload.preferredSources ? payload.preferredSources.split(',') : []), durationMins: payload.durationMins || 30, schema: payload.schema || null, createdAt: new Date().toISOString(), is_deleted: false };
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

/* Apply endpoint - store response, upload resume to Drive (strict: no local fallback), append to Sheet and record sheetRange
   - accept any uploaded file field names (upload.any())
   - map submitted answer keys (ids or labels) to question labels using form schema (if available)
   - extract mandatory fields (fullName, email, phone, resumeLink) to top-level response fields
   - append sheet row with separate columns for those fields
*/
app.post('/api/apply', upload.any(), async (req, res) => {
  try {
    const openingId = req.query.opening || req.body.opening;
    const src = req.query.src || req.body.src || 'unknown';
    if (!openingId) return res.status(400).json({ error: 'missing opening id' });

    const opening = await getOpeningFromStore(openingId) || readData().openings.find(o => o.id === openingId);
    const openingTitle = opening ? opening.title : null;
    const openingLocation = opening ? opening.location : null;

    // resume upload (strict: require Drive upload to succeed if a file was uploaded)
    let resumeLink = null;
    let resumeFileObj = null;

    // Accept multiple possible fieldnames for resume (q_resume, resume, resumeFile, cv, etc.)
    const possibleResumeFieldNames = new Set(['resume', 'q_resume', 'resumeFile', 'cv', 'q_cv', 'file', 'attachment', 'upload_resume']);
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      // find a file that looks like the resume or fallback to first file
      resumeFileObj = req.files.find(f => possibleResumeFieldNames.has((f.fieldname || '').toString())) || req.files[0];
    }

    if (resumeFileObj && resumeFileObj.buffer) {
      const filename = `${Date.now()}_${(resumeFileObj.originalname || 'resume')}`;

      // If DRIVE_FOLDER_ID not configured, return config error to caller
      if (!DRIVE_FOLDER_ID) {
        console.error('Drive folder ID not set; cannot upload resume.');
        return res.status(500).json({ error: 'drive_config_missing', message: 'Server is not configured to upload resumes to Google Drive. Please contact the administrator.' });
      }

      try {
        // Upload to Drive and set public read permission (best-effort)
        const bufferStream = new stream.PassThrough(); bufferStream.end(resumeFileObj.buffer);
        const drive = await getDriveService();
        const created = await drive.files.create({
          requestBody: { name: filename, parents: [DRIVE_FOLDER_ID] },
          media: { mimeType: resumeFileObj.mimetype || 'application/octet-stream', body: bufferStream },
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

    // collect raw answers posted by frontend (keys can be question ids like "q_123" OR labels if frontend sends labels)
    const rawAnswers = {};
    Object.keys(req.body || {}).forEach(k => {
      // skip special internal keys used for form metadata (opening, src etc.)
      if (['opening','src','_csrf'].includes(k)) return;
      rawAnswers[k] = req.body[k];
    });

    // try to fetch server-stored form for this opening (if any) to resolve question ids -> labels
    const formForOpening = await getFormForOpeningFromStore(openingId);
    const formQuestions = (formForOpening && formForOpening.data && Array.isArray(formForOpening.data.questions)) ? formForOpening.data.questions : [];

    // Build mapping from possible keys (ids / questionId / localLabel / id) -> label
    const idToLabel = {};
    for (const fq of formQuestions) {
      let label = null;
      if (fq.label) label = fq.label;
      if (!label && fq.localLabel) label = fq.localLabel;
      if (!label && fq.questionId) {
        const qdoc = await getQuestionFromStore(fq.questionId).catch(()=>null);
        if (qdoc && qdoc.label) label = qdoc.label;
      }
      if (!label && fq.id && fq.label) label = fq.label;
      if (!label && fq.id && fq.localLabel) label = fq.localLabel;
      if (!label && (fq.title || fq.name)) label = fq.title || fq.name;
      if (!label) continue;

      const possibleKeys = new Set();
      if (fq.questionId) possibleKeys.add(fq.questionId);
      if (fq.id) possibleKeys.add(fq.id);
      if (fq.id) possibleKeys.add(`q_${fq.id}`);
      if (fq.questionId) possibleKeys.add(`q_${fq.questionId}`);
      possibleKeys.add(label);
      possibleKeys.add(label.toLowerCase());
      if (fq.localLabel) possibleKeys.add(fq.localLabel);

      for (const k of possibleKeys) {
        if (k) idToLabel[k] = label;
      }
    }

    // Also include global question bank entries
    const questionBank = await listQuestionsFromStore();
    for (const q of (questionBank || [])) {
      if (!q || !q.id) continue;
      if (q.label) {
        idToLabel[q.id] = q.label;
        idToLabel[`q_${q.id}`] = q.label;
        idToLabel[q.label] = q.label;
        idToLabel[q.label.toLowerCase()] = q.label;
      }
    }

    // Normalize rawAnswers into labelAnswers: label -> answer
    const labelAnswers = {};
    for (const k of Object.keys(rawAnswers)) {
      const val = rawAnswers[k];
      let label = idToLabel[k];
      if (!label && idToLabel[k.toLowerCase()]) label = idToLabel[k.toLowerCase()];
      if (!label && typeof k === 'string' && k.trim().length > 0) label = k;
      if (!label) {
        const stripped = k.replace(/^q_/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        const found = Object.keys(idToLabel).find(key => key && key.replace(/^q_/, '').replace(/[^a-z0-9]/gi, '').toLowerCase() === stripped);
        if (found) label = idToLabel[found];
      }
      if (!label) label = k;
      labelAnswers[label] = val;
    }

    // Extract mandatory fields into top-level properties (best-effort)
    const findAndRemoveFirstMatch = (candidates) => {
      for (const cand of candidates) {
        if (labelAnswers[cand] !== undefined) {
          const v = labelAnswers[cand];
          delete labelAnswers[cand];
          return v;
        }
        const foundKey = Object.keys(labelAnswers).find(k => (k || '').toString().toLowerCase().trim() === cand.toLowerCase().trim());
        if (foundKey) {
          const v = labelAnswers[foundKey];
          delete labelAnswers[foundKey];
          return v;
        }
      }
      const lowerKeys = Object.keys(labelAnswers).map(k => ({ k, kl: (k||'').toLowerCase() }));
      for (const cand of candidates) {
        for (const o of lowerKeys) {
          if (o.kl.includes(cand.toLowerCase())) {
            const v = labelAnswers[o.k];
            delete labelAnswers[o.k];
            return v;
          }
        }
      }
      return null;
    };

    const fullNameCandidates = ['full name','fullname','name','candidate name','applicant name','your name'];
    const emailCandidates = ['email address','email','e-mail','mail'];
    const phoneCandidates = ['phone number','phone','mobile','mobile number','contact number'];
    const resumeCandidates = ['upload resume / cv','upload resume','resume','cv','upload cv','upload resume/cv','upload resume / cv'];

    const extractedFullName = findAndRemoveFirstMatch(fullNameCandidates) || null;
    const extractedEmail = findAndRemoveFirstMatch(emailCandidates) || null;
    const extractedPhone = findAndRemoveFirstMatch(phoneCandidates) || null;
    const extractedResumeFromAnswers = findAndRemoveFirstMatch(resumeCandidates) || null;
    const finalResumeLink = resumeLink || extractedResumeFromAnswers || null;

    // Build the response object that will be persisted
    const resp = {
      id: `resp_${Date.now()}`,
      openingId,
      openingTitle,
      location: openingLocation || null,
      source: src,
      fullName: extractedFullName || null,
      email: extractedEmail || null,
      phone: extractedPhone || null,
      resumeLink: finalResumeLink,
      answers: labelAnswers,
      createdAt: new Date().toISOString(),
      stage: 'Applied',
      status: 'Applied',
      sheetRange: null,
      is_deleted: false
    };

    // Prepare sheet row.
    const rowVals = [
      new Date().toISOString(),
      openingId,
      openingTitle || '',
      openingLocation || '',
      src,
      resp.fullName || '',
      resp.email || '',
      resp.phone || '',
      resp.resumeLink || '',
      JSON.stringify(resp.answers || {})
    ];

    let sheetRange = null;
    if (SHEET_ID) {
      try {
        sheetRange = await appendToSheetReturnRange(SHEET_ID, SHEET_TAB, rowVals);
        resp.sheetRange = sheetRange;
        console.log('Appended to sheet, range=', sheetRange);
      } catch (err) {
        console.error('appendToSheet error', err && err.message);
        resp.sheetRange = null;
      }
    }

    // persist to DB & file (file kept as legacy)
    try { await createResponseInStore(resp); } catch(e){ console.error('Failed to persist response to store', e && e.message); }

    // Respond success
    return res.json({ ok: true, resumeLink: resp.resumeLink, sheetRange: resp.sheetRange });
  } catch (err) {
    console.error('Error in /api/apply', err && err.stack);
    return res.status(500).json({ error: 'server_error', message: err?.message || 'unknown' });
  }
});

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

/** ---------- STARTUP: try Mongo, run migration, fallback to files ---------- **/
connectMongo()
  .then(async () => {
    console.log('[startup] Mongo attempt finished (connected or verified). Running startup migrations...');
    try {
      await ensureIsDeletedField();
    } catch (err) {
      console.warn('[startup] ensureIsDeletedField failed', err && err.message);
    }
    console.log('[startup] Starting HTTP server...');
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
