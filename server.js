require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./db');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (Postman, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

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
