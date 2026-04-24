const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// Parse the connection string manually to handle special cases
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  // These settings are required for Supabase Transaction Pooler
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test connection before declaring success
async function initDB() {
  let client;
  let retries = 5;
  
  while (retries > 0) {
    try {
      client = await pool.connect();
      console.log('✅ Connected to database');
      
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id          SERIAL PRIMARY KEY,
          email       TEXT UNIQUE NOT NULL,
          password    TEXT NOT NULL,
          name        TEXT NOT NULL,
          created_at  TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS history (
          id          SERIAL PRIMARY KEY,
          user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
          question    TEXT NOT NULL,
          answer      TEXT NOT NULL,
          mark        INTEGER NOT NULL,
          subject     TEXT DEFAULT '',
          created_at  TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS favourites (
          id          SERIAL PRIMARY KEY,
          user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
          question    TEXT NOT NULL,
          answer      TEXT NOT NULL,
          mark        INTEGER NOT NULL,
          subject     TEXT DEFAULT '',
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(user_id, question, mark)
        );

        CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);
        CREATE INDEX IF NOT EXISTS idx_favourites_user ON favourites(user_id);
      `);

      console.log('✅ Database initialized successfully');
      return;

    } catch (err) {
      retries--;
      console.error(`❌ DB connection attempt failed. Retries left: ${retries}`);
      console.error('Error:', err.message);
      if (retries === 0) throw err;
      await new Promise(r => setTimeout(r, 3000));
    } finally {
      if (client) client.release();
    }
  }
}

module.exports = { pool, initDB };
