require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./db');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./db');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/generate',   require('./routes/generate'));
app.use('/api/history',    require('./routes/history'));
app.use('/api/favourites', require('./routes/favourites'));
app.use('/api/stats',      require('./routes/stats'));

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 ExamAce API running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to initialize DB:', err);
    process.exit(1);
  });

// ── BODY PARSER ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/generate',   require('./routes/generate'));
app.use('/api/history',    require('./routes/history'));
app.use('/api/favourites', require('./routes/favourites'));
app.use('/api/stats',      require('./routes/stats'));

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 ExamAce API running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to initialize DB:', err);
    process.exit(1);
  });
