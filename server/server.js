// server/server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const db = require('./db');
const { getDriveClient, getSheetsClient } = require('./googleClient');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

// Multer uploads folder
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir });

// Passport Google OAuth (recruiter login)
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_OAUTH_CALLBACK || `http://localhost:${PORT}/auth/google/callback`
}, (accessToken, refreshToken, profile, cb) => {
  try {
    const email = (profile.emails && profile.emails[0] && profile.emails[0].value) || null;
    const id = profile.id;
    const name = profile.displayName || (profile.name && profile.name.givenName) || email || 'Unknown';
    const now = new Date().toISOString();
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
    const role = adminEmails.includes(email) ? 'admin' : 'recruiter';

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (existing) {
      db.prepare('UPDATE users SET email = ?, name = ?, role = ? WHERE id = ?').run(email, name, role, id);
    } else {
      db.prepare('INSERT INTO users (id,email,name,role,createdAt) VALUES (?,?,?,?,?)').run(id, email, name, role, now);
    }

    cb(null, { id, email, name, role });
  } catch (err) {
    cb(err);
  }
}));

app.use(passport.initialize());

// Initiate Google OAuth
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Callback — issue token and redirect to frontend
app.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/auth/failure' }),
  (req, res) => {
    const user = req.user;
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    const frontend = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    return res.redirect(`${frontend}/auth/success?token=${token}`);
  }
);

app.get('/auth/failure', (req, res) => res.status(401).send('Authentication failed'));

// Auth middleware
function requireAuth(req, res, next) {
  const authHeader = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!authHeader) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(authHeader, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------- Candidate Apply endpoint ----------
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  try {
    const openingId = req.query.opening || '';
    const source = req.query.src || req.query.source || 'unknown';
    const formFields = req.body || {};
    const file = req.file;

    let resumeLink = '';
    if (file) {
      const drive = await getDriveClient();
      const filePath = path.resolve(file.path);
      const fileName = file.originalname || file.filename;

      const driveRes = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: process.env.GOOGLE_DRIVE_FOLDER_ID ? [process.env.GOOGLE_DRIVE_FOLDER_ID] : undefined
        },
        media: {
          mimeType: file.mimetype || 'application/octet-stream',
          body: fs.createReadStream(filePath)
        }
      });

      // make public link (optional)
      try {
        await drive.permissions.create({
          fileId: driveRes.data.id,
          requestBody: { role: 'reader', type: 'anyone' }
        });
      } catch (permErr) {
        console.warn('permission error', permErr.message || permErr);
      }
      resumeLink = `https://drive.google.com/file/d/${driveRes.data.id}/view?usp=sharing`;

      // delete temp
      try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
    }

    // append to sheet
    if (process.env.GOOGLE_SHEET_ID) {
      const sheets = await getSheetsClient();
      const sheetId = process.env.GOOGLE_SHEET_ID;
      const row = [
        new Date().toISOString(),
        openingId,
        source,
        resumeLink,
        JSON.stringify(formFields)
      ];
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Sheet1!A:E',
        valueInputOption: 'RAW',
        requestBody: {
          values: [row]
        }
      });
    }

    // store locally
    const respId = `resp_${Date.now()}`;
    db.prepare('INSERT INTO responses (id, openingId, formId, source, answers, resumeDriveLink, createdAt) VALUES (?,?,?,?,?,?,?)')
      .run(respId, openingId || null, null, source, JSON.stringify(formFields), resumeLink, new Date().toISOString());

    res.json({ ok: true, resumeLink });
  } catch (err) {
    console.error('apply error', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ---------- Protected APIs ----------
app.get('/api/responses', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM responses ORDER BY createdAt DESC LIMIT 500').all();
  res.json(rows);
});

app.post('/api/openings', requireAuth, (req, res) => {
  const id = `op_${Date.now()}`;
  const { title, location, department, preferredSources = [], durationMins } = req.body;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO openings (id,title,location,department,preferredSources,createdAt) VALUES (?,?,?,?,?,?)')
    .run(id, title, location, department, JSON.stringify(preferredSources), now);
  res.json({ id });
});

app.get('/api/openings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM openings ORDER BY createdAt DESC').all();
  rows.forEach(r => { try { r.preferredSources = JSON.parse(r.preferredSources || '[]'); } catch (e) { r.preferredSources = []; }});
  res.json(rows);
});

app.delete('/api/openings/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM openings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json(user || req.user);
});

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM users').all();
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`Backend listening on ${PORT}`);
});
