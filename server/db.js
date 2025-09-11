// server/db.js
const path = require('path');
const Database = require('better-sqlite3');
const dbPath = path.resolve(__dirname, 'data.db');
const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  role TEXT,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS openings (
  id TEXT PRIMARY KEY,
  title TEXT,
  location TEXT,
  department TEXT,
  preferredSources TEXT,
  createdAt TEXT
);

CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  openingId TEXT,
  formId TEXT,
  source TEXT,
  answers TEXT,
  resumeDriveLink TEXT,
  createdAt TEXT
);
`);

module.exports = db;
