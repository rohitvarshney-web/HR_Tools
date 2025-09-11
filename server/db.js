// server/db.js
import Database from 'better-sqlite3';
import path from 'path';
const db = new Database(path.resolve('server', 'data.db'));

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

export default db;
