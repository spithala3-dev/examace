const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const SYSTEM_PROMPT = `You are an expert exam answer writer. Generate structured exam answers with CLEAR SECTIONS.

CRITICAL FORMAT RULES — ALWAYS follow this exact structure:

## DEFINITION
[Write the definition here — 1-2 lines for 2 marks, 2-3 lines for 5 marks, 3-4 lines for 7-10 marks]

## KEY POINTS
[Bullet points of main concepts — skip for 2 mark questions]
- Point 1
- Point 2

## USES / APPLICATIONS
[Real-world uses — skip for 2 mark questions]
- Use 1
- Use 2

## EXAMPLE
[One concrete real-world example explained clearly]

## COMPARISON TABLE
[ONLY if the question asks to compare/differentiate — use markdown table]
| Feature | X | Y |
|---------|---|---|

## CODE
[ONLY if question asks for code — give working code with output]

## DIAGRAM
[ONLY if a diagram would help — write: DIAGRAM: <description of what to draw>]

MARK-BASED LENGTH:
- 2 marks: DEFINITION + EXAMPLE only (short, 4-6 lines total)
- 5 marks: DEFINITION + KEY POINTS + EXAMPLE (medium)
- 7 marks: All sections relevant to question (detailed)
- 10 marks: All sections, very detailed, multiple examples

TONE: Final-year student. Direct. Real examples. Bold **key terms**.
DO NOT write one-word bullets. DO NOT be vague.`;

async function callGroq(userPrompt) {
  const apiKey = process.env.GROQ_API_KEY;
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
  if (!response.ok) throw new Error(data.error?.message || 'Groq API error');
  return data.choices[0].message.content;
}

// POST /api/generate/single
router.post('/single', authMiddleware, async (req, res) => {
  const { question, mark, subject } = req.body;
  if (!question || !mark) return res.status(400).json({ error: 'Question and mark value are required' });
  if (![2, 5, 7, 10].includes(Number(mark))) return res.status(400).json({ error: 'Mark must be 2, 5, 7, or 10' });
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

// POST /api/generate/batch
router.post('/batch', authMiddleware, async (req, res) => {
  const { questions } = req.body;
  if (!Array.isArray(questions) || questions.length === 0) return res.status(400).json({ error: 'Questions array is required' });
  if (questions.length > 5) return res.status(400).json({ error: 'Maximum 5 questions per batch' });
  const results = [], errors = [];
  for (const q of questions) {
    const { question, mark, subject } = q;
    if (!question || !mark) { errors.push({ question, error: 'Missing question or mark' }); continue; }
    try {
      const userPrompt = subject ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}` : `Question (${mark} marks): ${question}`;
      const answer = await callGroq(userPrompt);
      await pool.query('INSERT INTO history (user_id, question, answer, mark, subject) VALUES ($1, $2, $3, $4, $5)',
        [req.userId, question.trim(), answer, Number(mark), subject || '']);
      results.push({ question, answer, mark: Number(mark), subject: subject || '' });
    } catch (err) {
      errors.push({ question, error: err.message });
    }
  }
  res.json({ results, errors });
});

module.exports = router;
