require('dotenv').config();
const express = require('express');
const { initDB } = require('./db');

const app = express();
app.use(express.json({ limit: '20mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/generate',   require('./routes/generate'));
app.use('/api/history',    require('./routes/history'));
app.use('/api/favourites', require('./routes/favourites'));
app.use('/api/stats',      require('./routes/stats'));
app.use('/api/upload',     require('./routes/upload'));

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message || 'Internal server error' }); });

const PORT = process.env.PORT || 4000;
initDB().then(() => app.listen(PORT, () => console.log(`🚀 ExamAce API running on port ${PORT}`))).catch(err => { console.error(err); process.exit(1); });
