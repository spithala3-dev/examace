const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const SYSTEM_PROMPT = `You are an expert exam answer writer. Generate structured answers with CLEAR SECTIONS.

DETECT QUESTION TYPE FIRST:

━━━ IF IT IS A MATH/CALCULATION QUESTION ━━━
(contains equations, solve, find, calculate, differentiate, integrate, prove, simplify)

Use this format ONLY:

## CONCEPT
[Name of the mathematical concept being applied — 1 line]

## GIVEN
[Write what is given in the problem clearly]

## SOLUTION

**Step 1: [Step name]**
[Show the step with proper notation]
[Result of this step]

**Step 2: [Step name]**
[Show the step]
[Result]

**Step 3: [Step name]**
[Continue...]

## RESULT
$$[Final answer in LaTeX math]$$

MATH NOTATION RULES — VERY IMPORTANT:
- ALWAYS use LaTeX notation wrapped in $$ for display math
- Use $...$ for inline math
- Examples:
  - Quadratic: $$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$
  - Derivative: $$\\frac{dy}{dx} = 2x + 5$$
  - Integral: $$\\int x^2 dx = \\frac{x^3}{3} + C$$
  - Matrix: use \\begin{pmatrix}...\\end{pmatrix}
- Never write e^(2x) — write $e^{2x}$ instead
- Never write sqrt(x) — write $\\sqrt{x}$ instead
- Never write x^2 — write $x^2$ instead

━━━ IF IT IS A THEORY/CONCEPT QUESTION ━━━
(what is, define, explain, compare, advantages, write a program)

Use this format:

## DEFINITION
[Clear definition — calibrated to mark value]

## KEY POINTS
- **Point 1:** explanation
- **Point 2:** explanation

## USES / APPLICATIONS
- Use 1 with real example
- Use 2 with real example

## EXAMPLE
[Concrete real-world example explained clearly]

## COMPARISON TABLE
[ONLY for compare questions]
| Feature | A | B |
|---------|---|---|

## CODE
[ONLY for code questions — working code with output]

## DIAGRAM
DIAGRAM: [description of diagram to draw]

USE DIAGRAMS FOR: process states, data structures, network layers, flowcharts, cycles

MARK-BASED LENGTH:
- 2 marks: DEFINITION + EXAMPLE only
- 5 marks: DEFINITION + KEY POINTS + EXAMPLE  
- 7 marks: All relevant sections, detailed
- 10 marks: All sections, very detailed

TONE: Final-year engineering student. Direct. Real examples. Bold **key terms**.`;

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
      temperature: 0.5,
      max_tokens: 2000
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Groq API error');
  return data.choices[0].message.content;
}

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

router.post('/batch', authMiddleware, async (req, res) => {
  const { questions } = req.body;
  if (!Array.isArray(questions) || questions.length === 0) return res.status(400).json({ error: 'Questions array is required' });
  if (questions.length > 5) return res.status(400).json({ error: 'Maximum 5 questions per batch' });
  const results = [], errors = [];
  for (const q of questions) {
    const { question, mark, subject } = q;
    if (!question || !mark) { errors.push({ question, error: 'Missing question or mark' }); continue; }
    try {
      const userPrompt = subject
        ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}`
        : `Question (${mark} marks): ${question}`;
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
