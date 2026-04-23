const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/stats
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [totals, byMark, bySubject, favCount, wordCount] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM history WHERE user_id = $1', [req.userId]),
      pool.query(
        'SELECT mark, COUNT(*) as count FROM history WHERE user_id = $1 GROUP BY mark ORDER BY mark',
        [req.userId]
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(subject, ''), 'General') as subject, COUNT(*) as count
         FROM history WHERE user_id = $1
         GROUP BY COALESCE(NULLIF(subject, ''), 'General')
         ORDER BY count DESC LIMIT 10`,
        [req.userId]
      ),
      pool.query('SELECT COUNT(*) as total FROM favourites WHERE user_id = $1', [req.userId]),
      pool.query(
        `SELECT SUM(array_length(regexp_split_to_array(trim(answer), '\\s+'), 1)) as words
         FROM history WHERE user_id = $1`,
        [req.userId]
      ),
    ]);

    const markMap = {};
    byMark.rows.forEach(r => { markMap[r.mark] = parseInt(r.count); });

    res.json({
      total: parseInt(totals.rows[0].total),
      by_mark: markMap,
      by_subject: bySubject.rows.map(r => ({ subject: r.subject, count: parseInt(r.count) })),
      favourites: parseInt(favCount.rows[0].total),
      words: parseInt(wordCount.rows[0].words) || 0,
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
