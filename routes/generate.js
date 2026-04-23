const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an expert exam answer writer. Your job is to generate realistic, human-style exam answers that feel like a top student wrote them — not too long, not too short, calibrated to the mark value.

RULES BY MARK VALUE:

For 2-mark questions:
* Give a clear 1-2 line definition
* One real-world example (1 sentence)
* No diagrams, no code unless asked

For 5-mark questions:
* Definition (2-3 lines)
* Key uses/applications (3-4 bullet points)
* One example explained briefly
* If the question involves a concept with a visual, add this tag: [DIAGRAM: <search query for real image>]
* For code topics: give a minimal clean code snippet with output

For 7-mark questions:
* Definition (3-4 lines)
* Uses/applications (5+ points)
* Detailed example OR step-by-step explanation
* If comparison question: make a proper markdown table with columns and rows, include 5-6 differences, add examples in the table
* If code question: give definition, simple working code, exact output, explain line by line
* If diagram is relevant: [DIAGRAM: <specific Google-friendly image search query>]

For 10-mark questions:
* Comprehensive definition (4-5 lines)
* All major uses/applications (6+ bullet points)
* Multiple detailed examples with real-world context
* If comparison: full markdown table with 7-8 differences
* If code: definition + working code + output + line-by-line explanation + use cases
* Include [DIAGRAM: <search query>] where visuals would add value
* Show depth of understanding — include edge cases, limitations, or advanced aspects

QUESTION TYPE DETECTION:
* "What is / Define / Explain" → standard definition format
* "Compare / Difference between" → always use a table
* "Write a program / Code for" → definition + code + output
* "Advantages / Disadvantages" → bullet-point list with brief explanation each

TONE: Write like a final-year student who studied well. Avoid AI-sounding phrases. Be direct, use real examples from industry, academia, or everyday life. Format using markdown. Use bold for key terms. Use \`\`\` for code blocks.

DO NOT:
* Copy text verbatim from textbooks
* Write one-word bullet points
* Use vague examples like "for example, in many cases..."
* Exceed the implied length for that mark value`;

// POST /api/generate/single
router.post('/single', authMiddleware, async (req, res) => {
  const { question, mark, subject } = req.body;

  if (!question || !mark)
    return res.status(400).json({ error: 'Question and mark value are required' });

  if (![2, 5, 7, 10].includes(Number(mark)))
    return res.status(400).json({ error: 'Mark must be 2, 5, 7, or 10' });

  if (question.trim().length < 5)
    return res.status(400).json({ error: 'Question is too short' });

  try {
    const userPrompt = subject
      ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}`
      : `Question (${mark} marks): ${question}`;

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const answer = response.content[0].text;

    // Save to history
    await pool.query(
      'INSERT INTO history (user_id, question, answer, mark, subject) VALUES ($1, $2, $3, $4, $5)',
      [req.userId, question.trim(), answer, Number(mark), subject || '']
    );

    res.json({ answer, question, mark: Number(mark), subject: subject || '' });
  } catch (err) {
    console.error('Generate error:', err);
    if (err.status === 429)
      return res.status(429).json({ error: 'Rate limit reached. Please wait a moment.' });
    res.status(500).json({ error: 'Failed to generate answer. Please try again.' });
  }
});

// POST /api/generate/batch
router.post('/batch', authMiddleware, async (req, res) => {
  const { questions } = req.body; // [{ question, mark, subject }]

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

      const response = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const answer = response.content[0].text;

      await pool.query(
        'INSERT INTO history (user_id, question, answer, mark, subject) VALUES ($1, $2, $3, $4, $5)',
        [req.userId, question.trim(), answer, Number(mark), subject || '']
      );

      results.push({ question, answer, mark: Number(mark), subject: subject || '' });
    } catch (err) {
      console.error(`Batch error for "${question}":`, err.message);
      errors.push({ question, error: 'Generation failed' });
    }
  }

  res.json({ results, errors });
});

module.exports = router;
