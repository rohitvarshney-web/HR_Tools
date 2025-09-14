// migrate-add-is_deleted.js
require('dotenv').config();
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || 'hrtool';

if (!MONGO_URI) {
  console.error('MONGO_URI not set in env - aborting migration.');
  process.exit(1);
}

async function run() {
  const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    await client.connect();
    console.log('Connected to Mongo for migration...');
    const db = client.db(DB_NAME);

    const collections = ['openings', 'forms', 'responses'];
    for (const col of collections) {
      const res = await db.collection(col).updateMany(
        { is_deleted: { $exists: false } },
        { $set: { is_deleted: false } }
      );
      console.log(`Collection ${col}: matched=${res.matchedCount || res.matched || 0}, modified=${res.modifiedCount || res.nModified || 0}`);
    }

    console.log('Migration complete.');
  } catch (err) {
    console.error('Migration error', err && err.stack);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

run().catch(err => {
  console.error('Unhandled migration error', err && err.stack);
  process.exit(1);
});
