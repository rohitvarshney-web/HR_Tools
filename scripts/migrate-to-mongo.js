// scripts/migrate-to-mongo.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'hrtool';
const DATA_DIR = path.resolve(__dirname, '..', 'server_data');
const OPENINGS_FILE = path.join(DATA_DIR, 'openings.json');
const FORMS_FILE = path.join(DATA_DIR, 'forms.json');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

if (!MONGO_URI) {
  console.error('MONGO_URI is not set in env. Set it and re-run.');
  process.exit(1);
}

async function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed reading', filePath, err && err.message);
    return [];
  }
}

async function main() {
  const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    await client.connect();
    const db = client.db(MONGO_DB_NAME);
    console.log('Connected to Mongo for migration:', MONGO_DB_NAME);

    const openings = await readJson(OPENINGS_FILE);
    const forms = await readJson(FORMS_FILE);
    const legacy = await readJson(DATA_FILE); // maybe object { openings:[], responses:[], users:[] }
    const responses = legacy && Array.isArray(legacy.responses) ? legacy.responses : [];

    const opensCol = db.collection('openings');
    const formsCol = db.collection('forms');
    const respCol = db.collection('responses');

    // Upsert openings
    console.log('Migrating openings:', openings.length);
    for (const o of openings) {
      // ensure id present
      if (!o.id) o.id = `op_${Date.now()}_${Math.floor(Math.random()*1000)}`;
      await opensCol.updateOne({ id: o.id }, { $set: o }, { upsert: true });
    }

    // Upsert forms
    console.log('Migrating forms:', forms.length);
    for (const f of forms) {
      if (!f.id) f.id = `form_${Date.now()}_${Math.floor(Math.random()*1000)}`;
      await formsCol.updateOne({ id: f.id }, { $set: f }, { upsert: true });
    }

    // Upsert responses
    console.log('Migrating responses:', responses.length);
    for (const r of responses) {
      if (!r.id) r.id = `resp_${Date.now()}_${Math.floor(Math.random()*1000)}`;
      await respCol.updateOne({ id: r.id }, { $set: r }, { upsert: true });
    }

    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration failed', err && err.stack);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
