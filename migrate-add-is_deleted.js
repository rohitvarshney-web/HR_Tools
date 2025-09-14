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
  const client = new MongoClient(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 15000,
  });

  try {
    await client.connect();
    console.log('Connected to Mongo for migration...');
    const db = client.db(DB_NAME);
    console.log('Target DB:', db.databaseName);

    const collections = ['openings', 'forms', 'responses'];

    for (const colName of collections) {
      const col = db.collection(colName);
      const total = await col.countDocuments();
      // Count docs that already have a boolean true/false
      const haveIsDeleted = await col.countDocuments({ is_deleted: { $exists: true } });
      const missingOrNull = await col.countDocuments({ $or: [{ is_deleted: { $exists: false } }, { is_deleted: null }] });

      console.log(`\nCollection: ${colName}`);
      console.log(`  Total docs: ${total}`);
      console.log(`  Docs with is_deleted present: ${haveIsDeleted}`);
      console.log(`  Docs missing or null is_deleted (to update): ${missingOrNull}`);

      if (missingOrNull === 0) {
        console.log('  Nothing to update for this collection.');
        continue;
      }

      const res = await col.updateMany(
        { $or: [{ is_deleted: { $exists: false } }, { is_deleted: null }] },
        { $set: { is_deleted: false } }
      );

      console.log(`  updateMany result: matched=${res.matchedCount ?? res.matched ?? 0}, modified=${res.modifiedCount ?? res.nModified ?? 0}`);
      const nowHave = await col.countDocuments({ is_deleted: { $exists: true } });
      console.log(`  Now docs with is_deleted present: ${nowHave}`);
    }

    console.log('\nMigration complete.');
  } catch (err) {
    console.error('Migration error', err && (err.stack || err.message));
    process.exitCode = 1;
  } finally {
    await client.close();
    console.log('Mongo client closed.');
  }
}

run().catch(err => {
  console.error('Unhandled migration error', err && (err.stack || err.message));
  process.exit(1);
});
