// server.js
// Backend: OAuth (Google optional), file upload -> Drive (or fallback to local),
// per-opening sheet tabs with human-readable question columns, append responses starting at column A.

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

// --- Local persistence & uploads fallback
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

/**
 * getAuthClient:
 * - If GOOGLE_SERVICE_ACCOUNT_CREDS is set (JSON string), parse and use credentials.
 * - Else if GOOGLE_SERVICE_ACCOUNT_FILE is set, use keyFile.
 */
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

// sanitize sheet tab title (Sheets limits & forbidden chars)
function sanitizeSheetTitle(title) {
  if (!title) title = 'sheet';
  return String(title).replace(/[\\\/\?\*\[\]\:]/g, '_').slice(0, 90);
}

// Ensure a sheet tab exists and set header row (metadata + question labels)
async function ensureSheetTabWithHeaders(spreadsheetId, sheetTitle, questionSchema = []) {
  if (!spreadsheetId) throw new Error('spreadsheetId required');
  const sheets = await getSheetsService();
  const cleanTitle = sanitizeSheetTitle(sheetTitle);

  // get spreadsheet metadata
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
  } else {
    // sheet exists; we will still update header to reflect schema (idempotent)
  }

  // build headers: metadata first, then question labels (human readable)
  const metaHeaders = ['Timestamp', 'OpeningId', 'OpeningTitle', 'Source', 'ResumeLink'];
  const questionHeaders = (Array.isArray(questionSchema) ? questionSchema.map(q => (q.label || q.id || '').toString()) : []);
  const headers = [...metaHeaders, ...questionHeaders];

  // write header row to A1 so subsequent appends start at column A
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${cleanTitle}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] }
  });

  return headers;
}

// Append row to a sheet tab starting at column A
async function appendRowToSheetTab(spreadsheetId, sheetTitle, valuesArray) {
  if (!spreadsheetId) throw new Error('spreadsheetId required');
  const sheets = await getSheetsService();
  const range = `${sanitizeSheetTitle(sheetTitle)}!A1`; // anchor at A1 so append uses column A
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [valuesArray] }
  });
  return res.status === 200 || res.status === 201;
}

// Fallback generic append (keeps older behavior)
async function appendToSheet(spreadsheetId, valuesArray) {
  if (!spreadsheetId) throw new Error('spreadsheetId required');
  const sheets = await getSheetsService();
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1!A:Z',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [valuesArray] }
  });
  return res.status === 200 || res.status === 201;
}

// Drive upload helper (stream-based), returns a shareable view link (best effort)
async function uploadToDrive(fileBuffer, filename, mimeType = 'application/octet-stream') {
  if (!DRIVE_FOLDER_ID) throw new Error('DRIVE_FOLDER_ID not set in env');
  const drive = await getDriveService();

  const bufferStream = new stream.PassThrough();
  bufferStream.end(Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer));

  console.log(`Uploading to Drive: name=${filename} size=${(fileBuffer ? fileBuffer.length : 0)} mime=${mimeType} folder=${DRIVE_FOLDER_ID}`);

  const created = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [DRIVE_FOLDER_ID]
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

  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true
    });
    console.log('Set permission: anyone reader on fileId=', fileId);
  } catch (err) {
    console.warn('Failed to set file permission (may be org policy):', err && err.message);
  }

  try {
    const meta = await drive.files.get({ fileId, fields: 'id, webViewLink, webContentLink', supportsAllDrives: true });
    const link = meta.data.webViewLink || meta.data.webContentLink || `https://drive.google.com/file/d/${fileId}/view`;
    return link;
  } catch (err) {
    console.warn('drive.files.get failed, returning generic view link', err && err.message);
    return `https://drive.google.com/file/d/${fileId}/view`;
  }
}

// Multer (memory)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// --- (OPTIONAL) Auth helpers and Passport pieces (unchanged from your previous setup)
// If you are not using OAuth for form submitters, leave /api/apply public as below.
// Keep your passport oauth code here if you need the admin UI protected by auth.

// simple JWT utilities (for admin endpoints)
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

// --- Openings CRUD (protected endpoints for admin UI)
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
    // schema: array of { id, label, type, options? } - may be set later via /api/openings/:id/schema
    schema: payload.schema || null,
    createdAt: new Date().toISOString()
  };
  data.openings.unshift(op);
  writeData(data);
  return res.json(op);
});

// Save schema for an opening (admin action). Schema items should include id and label.
app.post('/api/openings/:id/schema', authMiddleware, (req, res) => {
  const id = req.params.id;
  const incoming = req.body.schema;
  if (!incoming || !Array.isArray(incoming)) return res.status(400).json({ error: 'missing schema array' });
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

// --- Public apply endpoint
// This endpoint is public so your externally-hosted form can POST directly to it.
// Example: POST https://your-backend.com/api/apply?opening=op_123&src=LinkedIn
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  try {
    const openingId = req.query.opening || req.body.opening;
    const src = req.query.src || req.body.src || 'unknown';
    if (!openingId) return res.status(400).json({ error: 'missing opening id' });

    // load opening
    const data = readData();
    const opening = data.openings.find(o => o.id === openingId);
    const openingTitle = opening ? opening.title : '';
    // tab name: prefer opening id (guaranteed unique); you can change to opening.title if you want readable tabs
    const sheetTabName = opening ? opening.id : `opening_${openingId}`;

    // accept inline _schema (optional) and persist to opening if present
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

    // --- handle resume upload: Drive -> fallback local
    let resumeLink = null;
    if (req.file && req.file.buffer) {
      const filename = `${Date.now()}_${(req.file.originalname || 'resume')}`;
      try {
        resumeLink = await uploadToDrive(req.file.buffer, filename, req.file.mimetype || 'application/octet-stream');
        console.log('Drive upload success resumeLink=', resumeLink);
      } catch (err) {
        console.error('Drive upload failed:', err && (err.stack || err.message));
        // fallback local save & serve via /uploads
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

    // collect answers (skip internal keys)
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

    // --- If schema present, ensure tab + header and append mapped row (question labels used)
    if (SHEET_ID && activeSchema && Array.isArray(activeSchema) && activeSchema.length) {
      try {
        // Ensure tab headers
        const headers = await ensureSheetTabWithHeaders(SHEET_ID, sheetTabName, activeSchema);

        // Build row values aligned to header order:
        const metaValues = [ new Date().toISOString(), openingId, openingTitle, src, resumeLink || '' ];

        // For each schema item (in order) map to answer. Schema item expected to have s.id and s.label.
        const questionValues = activeSchema.map(s => {
          // lookup priority: answers[s.id] -> answers[s.label] -> answers[s.id.toString()] etc.
          let val = undefined;
          if (s.id && answers[s.id] !== undefined) val = answers[s.id];
          else if (s.label && answers[s.label] !== undefined) val = answers[s.label];
          else {
            // sometimes frontends send field names as the UUID (or other form): try exact keys known
            if (s.id && answers[String(s.id)]) val = answers[String(s.id)];
            else if (s.label && answers[String(s.label)]) val = answers[String(s.label)];
          }
          if (Array.isArray(val)) return val.join(', ');
          return (val === undefined || val === null) ? '' : String(val);
        });

        const valuesArray = [...metaValues, ...questionValues];

        // Append the mapped row to the sheet tab (this uses A1 anchor to ensure column A)
        await appendRowToSheetTab(SHEET_ID, sheetTabName, valuesArray);
        console.log('Appended mapped row to sheet tab', sheetTabName);
      } catch (err) {
        console.error('Failed to append mapped row to sheet/subsheet:', err && (err.stack || err.message));
        // fallback generic append to Sheet1
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
      // No schema: append generic row to Sheet1 starting at column A
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
