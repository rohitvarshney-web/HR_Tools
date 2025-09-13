// scripts/test-mongo-conn.js
require('dotenv').config();
const { MongoClient } = require('mongodb');
const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB_NAME || undefined;
if (!uri) { console.error('ERROR: MONGO_URI not set'); process.exit(1); }
(async () => {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS:10000, connectTimeoutMS:10000, tls:true });
  try {
    console.log('[test] connecting (masked):', uri.replace(/\/\/(.*?)@/,'//<user>:<pwd>@'));
    await c.connect();
    console.log('[test] connected');
    const db = c.db(dbName);
    console.log('[test] db:', db.databaseName || '(from URI)');
    const cols = await db.listCollections().toArray();
    console.log('[test] collections:', cols.map(c=>c.name));
  } catch (err) {
    console.error('[test] connection error:', err && (err.stack || err.message));
  } finally {
    await c.close().catch(()=>{});
  }
})();
