// server/server.js
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import jwt from 'jsonwebtoken';
import db from './db.js';
import { getDriveClient, getSheetsClient } from './googleClient.js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const PORT = process.env.PORT || 4000;

// Multer for handling file uploads (resume)
const upload = multer({ dest: path.join('server', 'uploads') });

// ---------- Passport Google OAuth (for recruiter login) ----------
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_OAUTH_CALLBACK || `http://localhost:${PORT}/auth/google/callback`
}, (accessToken, refreshToken, profile, cb) => {
  // Create or update user entry in SQLite
  const email = profile.emails && profile.emails[0] && profile.emails[0].value;
  const id = profile.id;
  const name = profile.displayName || profile.name?.givenName || email;
  const now = new Date().toISOString();

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  const role = adminEmails.includes(email) ? 'admin' : 'recruiter';

  // upsert user
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (existing) {
    db.prepare('UPDATE users SET email=?, name=?, role=? WHERE id=?').run(email, name, role, id);
  } else {
    db.prepare('INSERT INTO users (id,email,name,role,createdAt) VALUES (?,?,?,?,?)').run(id, email, name, role, now);
  }

  // Return a minimal profile object
  cb(null, { id, email, name, role });
}));

app.use(passport.initialize());

// redirect route to Google for login
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// callback route — issue JWT and redirect back to front-end (you can change redirect)
app.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/auth/failure' }),
  (req, res) => {
    // req.user set by passport callback above
    const user = req.user;
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    // In a real app you'd redirect to your front-end and include token in query or set cookie.
    // We'll redirect to front-end path /auth/success?token=... (make sure this URI is allowed)
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontend.replace(/\/$/, '')}/auth/success?token=${token}`);
  }
);

// simple middleware to protect endpoints
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Admin-only middleware
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------- Apply endpoint (candidate-facing) ----------
// Accepts multipart/form-data. Field names: any question keys; file field: 'resume'
app.post('/api/apply', upload.single('resume'), async (req, res) => {
  try {
    const openingId = req.query.opening;
    const source = req.query.src || req.query.source || 'unknown';
    const formFields = req.body || {};
    const file = req.file; // multer info

    // Upload resume to Google Drive (if provided)
    let resumeLink = null;
    if (file) {
      const drive = await getDriveClient();
      // Move file to extension-correct temporary name
      const fileName = file.originalname || `${file.filename}`;
      const filePath = path.resolve(file.path);

      const media = { mimeType: file.mimetype || 'application/octet-stream', body: fs.createReadStream(filePath) };
      const driveRes = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [process.env.GOOGLE_DRIVE_FOLDER_ID].filter(Boolean)
        },
        media
      });
      // Make file readable by link (optional): create permission
      await drive.permissions.create({
        fileId: driveRes.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });
      const webViewLink = `https://drive.google.com/file/d/${driveRes.data.id}/view?usp=sharing`;
      resumeLink = webViewLink;

      // Delete temp file
      try { fs.unlinkSync(filePath); } catch(e){ /* ignore */ }
    }

    // Append row to Google Sheet
    const sheets = await getSheetsClient();
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const row = [
      new Date().toISOString(),
      openingId || '',
      source || '',
      resumeLink || '',
      JSON.stringify(formFields)
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:E',
      valueInputOption: 'RAW',
      requestBody: { values: [row] }
    });

    // store in local DB too (for quick admin view)
    const respId = `resp_${Date.now()}`;
    db.prepare('INSERT INTO responses (id, openingId, formId, source, answers, resumeDriveLink, createdAt) VALUES (?,?,?,?,?,?,?)')
      .run(respId, openingId || null, null, source, JSON.stringify(formFields), resumeLink, new Date().toISOString());

    res.json({ ok: true, resumeLink });
  } catch (err) {
    console.error('Apply error', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Protected APIs ----------

// Get recent responses (requires recruiter login)
app.get('/api/responses', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM responses ORDER BY createdAt DESC LIMIT 200').all();
  res.json(rows);
});

// Create / Edit / Delete openings (admin or recruiter depending on policy)
// Create
app.post('/api/openings', requireAuth, (req, res) => {
  const id = `op_${Date.now()}`;
  const { title, location, department, preferredSources = [], durationMins } = req.body;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO openings (id,title,location,department,preferredSources,createdAt) VALUES (?,?,?,?,?,?)')
    .run(id, title, location, department, JSON.stringify(preferredSources), now);
  res.json({ id });
});

// List openings
app.get('/api/openings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM openings ORDER BY createdAt DESC').all();
  // parse preferredSources JSON
  rows.forEach(r => { try { r.preferredSources = JSON.parse(r.preferredSources||'[]'); } catch(e){ r.preferredSources = []; }});
  res.json(rows);
});

// Delete opening (admin)
app.delete('/api/openings/:id', requireAuth, requireAdmin, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM openings WHERE id = ?').run(id);
  res.json({ ok: true });
});

// get user info
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json(user || req.user);
});

// Basic user management (admin)
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM users').all();
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`Backend listening at http://localhost:${PORT}`);
});
