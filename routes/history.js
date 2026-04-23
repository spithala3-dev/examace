const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/history
router.get('/', authMiddleware, async (req, res) => {
  const { mark, subject, limit = 100, offset = 0 } = req.query;

  let query = 'SELECT id, question, answer, mark, subject, created_at FROM history WHERE user_id = $1';
  const params = [req.userId];

  if (mark) {
    params.push(Number(mark));
    query += ` AND mark = $${params.length}`;
  }
  if (subject) {
    params.push(subject);
    query += ` AND subject = $${params.length}`;
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(Number(limit), Number(offset));

  try {
    const result = await pool.query(query, params);
    const countResult = await pool.query(
      'SELECT COUNT(*) FROM history WHERE user_id = $1',
      [req.userId]
    );
    res.json({ history: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// DELETE /api/history/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM history WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Entry not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// DELETE /api/history (clear all)
router.delete('/', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM history WHERE user_id = $1', [req.userId]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

module.exports = router;
