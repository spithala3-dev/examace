const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const SYSTEM_PROMPT = `You are an expert exam answer writer. Your job is to generate realistic, human-style exam answers that feel like a top student wrote them — not too long, not too short, calibrated to the mark value.

RULES BY MARK VALUE:

For 2-mark questions:
* Give a clear 1-2 line definition
* One real-world example (1 sentence)

For 5-mark questions:
* Definition (2-3 lines)
* Key uses/applications (3-4 bullet points)
* One example explained briefly

For 7-mark questions:
* Definition (3-4 lines)
* Uses/applications (5+ points)
* If comparison question: make a proper markdown table with 5-6 differences
* If code question: definition + working code + exact output + explain line by line

For 10-mark questions:
* Comprehensive definition (4-5 lines)
* All major uses/applications (6+ bullet points)
* Multiple detailed examples
* If comparison: full markdown table with 7-8 differences

QUESTION TYPE DETECTION:
* "What is / Define / Explain" → standard definition format
* "Compare / Difference between" → always use a table
* "Write a program / Code for" → definition + code + output
* "Advantages / Disadvantages" → bullet-point list

TONE: Write like a final-year student. Use markdown. Bold key terms. Use code blocks for code.`;

async function callGroq(userPrompt) {
  const apiKey = process.env.GROQ_API_KEY;
  console.log('Calling Groq, key:', apiKey ? apiKey.substring(0, 8) + '...' : 'NOT SET');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 2000
    })
  });

  const data = await response.json();
  console.log('Groq status:', response.status);

  if (!response.ok) {
    console.error('Groq error:', JSON.stringify(data));
    throw new Error(data.error?.message || 'Groq API error');
  }

  return data.choices[0].message.content;
}

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

    const answer = await callGroq(userPrompt);

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

      const answer = await callGroq(userPrompt);

      await pool.query(
        'INSERT INTO history (user_id, question, answer, mark, subject) VALUES ($1, $2, $3, $4, $5)',
        [req.userId, question.trim(), answer, Number(mark), subject || '']
      );

      results.push({ question, answer, mark: Number(mark), subject: subject || '' });

    } catch (err) {
      errors.push({ question, error: err.message });
    }
  }

  res.json({ results, errors });
});

module.exports = router;
