const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
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
    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
