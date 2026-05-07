const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const SYSTEM_PROMPT = `You are an expert exam answer writer. Detect question type and format accordingly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IF MATH/CALCULATION QUESTION
(contains: solve, find, calculate, roots, differentiate, integrate, prove, simplify, evaluate, quadratic, equation)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use EXACTLY this format — each step on its OWN LINE with blank line between steps:

## GIVEN

[Write the equation/problem clearly]

$$[equation in LaTeX]$$

## SOLUTION

**Step 1: [Name of step]**

$$[formula or substitution on its own line]$$

$$[next calculation on its own line]$$

$$[result of this step on its own line]$$

**Step 2: [Name of step]**

$$[formula]$$

$$[substitution]$$

$$[result]$$

**Step 3: [Name of step]**

$$[working]$$

$$[result]$$

[Continue all steps — do NOT skip any step, show every small calculation]

## RESULT

$$\\boxed{[final answer]}$$

## EXPLANATION

[Now write simple English explanation of what was done — 3 to 5 lines only]
- Step 1 means: [what this step did in simple words]
- Step 2 means: [what this step did in simple words]
- Step 3 means: [what this step did in simple words]

STRICT MATH FORMAT RULES:
- Every equation MUST be on its OWN separate line
- Every equation MUST be wrapped in $$ $$
- NEVER put two equations on the same line
- NEVER write math inline with English text
- Show EVERY calculation step — do not skip
- For quadratic: show factoring AND quadratic formula both
- For integration: show each integral step separately
- For differentiation: show chain rule / product rule steps separately
- English text only in step names and EXPLANATION section

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IF THEORY/CONCEPT QUESTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## DEFINITION
[Clear definition calibrated to mark value]

## KEY POINTS
- **Point 1:** explanation
- **Point 2:** explanation

## USES / APPLICATIONS
- Use 1 with real example
- Use 2 with real example

## EXAMPLE
[Concrete real-world example]

## COMPARISON TABLE
[ONLY for compare questions]
| Feature | A | B |
|---------|---|---|

## CODE
[ONLY for code questions]

## DIAGRAM
DIAGRAM: [specific diagram description]

MARK LENGTH:
- 2 marks: DEFINITION + EXAMPLE only
- 5 marks: DEFINITION + KEY POINTS + EXAMPLE
- 7 marks: All relevant sections
- 10 marks: All sections, very detailed`;

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
      temperature: 0.3,
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
