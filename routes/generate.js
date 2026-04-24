const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const SYSTEM_PROMPT = `You are an expert exam answer writer. Generate realistic human-style exam answers calibrated to the mark value.

For 2-mark questions: 1-2 line definition + one real example.
For 5-mark questions: Definition + 3-4 bullet point uses + brief example.
For 7-mark questions: Full definition + 5+ uses + detailed example or table for comparisons.
For 10-mark questions: Comprehensive answer with multiple examples, tables, code if needed.

Use markdown formatting. Bold key terms. Use tables for comparisons. Use code blocks for code questions.`;

async function callGemini(userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  console.log('Calling Gemini with key:', apiKey ? apiKey.substring(0, 10) + '...' : 'NOT SET');

  const fullPrompt = SYSTEM_PROMPT + '\n\n' + userPrompt;

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: fullPrompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2000
      }
    })
  });

  const data = await response.json();
  console.log('Gemini response status:', response.status);
  console.log('Gemini response:', JSON.stringify(data).substring(0, 200));

  if (!response.ok) {
    throw new Error(data.error?.message || 'Gemini API error');
  }

  return data.candidates[0].content.parts[0].text;
}

// POST /api/generate/single
router.post('/single', authMiddleware, async (req, res) => {
  const { question, mark, subject } = req.body;

  if (!question || !mark)
    return res.status(400).json({ error: 'Question and mark value are required' });

  if (![2, 5, 7, 10].includes(Number(mark)))
    return res.status(400).json({ error: 'Mark must be 2, 5, 7, or 10' });

  try {
    const userPrompt = subject
      ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}`
      : `Question (${mark} marks): ${question}`;

    const answer = await callGemini(userPrompt);

    await pool.query(
      'INSERT INTO history (user_id, question, answer, mark, subject) VALUES ($1, $2, $3, $4, $5)',
      [req.userId, question.trim(), answer, Number(mark), subject || '']
    );

    res.json({ answer, question, mark: Number(mark), subject: subject || '' });

  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to generate answer.' });
  }
});

// POST /api/generate/batch
router.post('/batch', authMiddleware, async (req, res) => {
  const { questions } = req.body;

  if (!Array.isArray(questions) || questions.length === 0)
    return res.status(400).json({ error: 'Questions array is required' });

  if (questions.length > 5)
    return res.status(400).json({ error: 'Maximum 5 questions per batch' });

  const results = [];
  const errors = [];

  for (const q of questions) {
    const { question, mark, subject } = q;
    if (!question || !mark) {
      errors.push({ question, error: 'Missing question or mark' });
      continue;
    }
    try {
      const userPrompt = subject
        ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}`
        : `Question (${mark} marks): ${question}`;

      const answer = await callGemini(userPrompt);

      await pool.query(
        'INSERT INTO history (user_id, question, answer, mark, subject) VALUES ($1, $2, $3, $4, $5)',
        [req.userId, question.trim(), answer, Number(mark), subject || '']
      );

      results.push({ question, answer, mark: Number(mark), subject: subject || '' });

    } catch (err) {
      console.error('Batch error:', err.message);
      errors.push({ question, error: err.message });
    }
  }

  res.json({ results, errors });
});

module.exports = router;
