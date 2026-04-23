const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/favourites
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, question, answer, mark, subject, created_at FROM favourites WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json({ favourites: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch favourites' });
  }
});

// POST /api/favourites
router.post('/', authMiddleware, async (req, res) => {
  const { question, answer, mark, subject } = req.body;

  if (!question || !answer || !mark)
    return res.status(400).json({ error: 'Question, answer and mark are required' });

  try {
    const result = await pool.query(
      `INSERT INTO favourites (user_id, question, answer, mark, subject)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, question, mark) DO UPDATE SET answer = EXCLUDED.answer
       RETURNING id, question, answer, mark, subject, created_at`,
      [req.userId, question.trim(), answer, Number(mark), subject || '']
    );
    res.status(201).json({ favourite: result.rows[0] });
  } catch (err) {
    console.error('Favourite save error:', err);
    res.status(500).json({ error: 'Failed to save favourite' });
  }
});

// DELETE /api/favourites/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM favourites WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Favourite not found' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete favourite' });
  }
});

// DELETE /api/favourites (clear all)
router.delete('/', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM favourites WHERE user_id = $1', [req.userId]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear favourites' });
  }
});

module.exports = router;
