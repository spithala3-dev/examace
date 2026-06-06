const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// Detect if question is math/calculation
function isMathQuestion(question) {
  const q = question.toLowerCase();
  const mathPatterns = [
    /solve/i, /find\s+the/i, /calculate/i, /evaluate/i, /simplify/i,
    /differentiate/i, /integrate/i, /prove/i, /derivative/i,
    /\d+\s*[\+\-\*\/\^]\s*\d+/, // arithmetic
    /x\^?\d/, /y\^?\d/, // variables
    /\\frac/, /\\sqrt/, /dx/, /dy/,
    /equation/i, /roots?\s+of/i, /factor/i,
    /matrix/i, /determinant/i, /eigenvalue/i,
    /limit/i, /lim\s/i, /infinity/i,
    /log\s/i, /ln\s/i, /sin|cos|tan/i,
    /=\s*0/, /=\s*\d/,
  ];
  return mathPatterns.some(p => p.test(question));
}

const MATH_PROMPT = `You are a mathematics expert. Solve the given math problem step by step.

FORMAT RULES — FOLLOW EXACTLY:
1. Start directly with the solution — NO headings like "GIVEN" or "CONCEPT" for simple problems
2. Each step on its OWN LINE
3. Every equation wrapped in $$ on its own line
4. NEVER put two equations on same line
5. NEVER mix English text with equations on same line
6. Show EVERY calculation step — do not skip any

FORMAT:

**Step 1:** [brief name]

$$[equation]$$

$$[next line of working]$$

$$[result]$$

**Step 2:** [brief name]

$$[equation]$$

$$[result]$$

...continue all steps...

$$\\boxed{[final answer]}$$

**Note:** [1-2 lines of explanation only if really needed — skip if obvious]

STRICT RULES:
- Use LaTeX: \\frac{a}{b}, \\sqrt{x}, \\pm, x^2, x_1
- Show substitution step always
- Show simplification step always  
- Box the final answer
- NO unnecessary headings
- NO long English paragraphs
- For quadratic: show factoring OR formula method clearly
- For calculus: show each rule applied`;

const THEORY_PROMPT = `You are an expert exam answer writer. Generate structured answers.

DETECT QUESTION TYPE:
- "What is / Define / Explain" → Definition format
- "Compare / Difference" → Table format  
- "Write a program / Code" → Code format
- "Advantages / Disadvantages" → Bullet list
- "Draw / Explain with diagram" → Include DIAGRAM

USE ONLY NEEDED SECTIONS — do not add all sections for every question:

For 2-mark questions — use ONLY:
## DEFINITION
[1-2 line answer]

## EXAMPLE
[1 sentence example]

For 5-mark questions — use:
## DEFINITION
[2-3 lines]

## KEY POINTS
- point with explanation
- point with explanation
- point with explanation

## EXAMPLE
[brief example]

For 7-mark questions — use:
## DEFINITION
[3-4 lines]

## KEY POINTS
- detailed points (5+)

## EXAMPLE
[detailed example OR step-by-step]

## DIAGRAM
DIAGRAM: [description] ← only if question involves a visual concept

For 10-mark questions — use all relevant sections with full detail.

For COMPARE questions — use ONLY:
## COMPARISON
| Feature | A | B |
|---------|---|---|
[5-7 rows]

For CODE questions — use:
## DEFINITION
[brief]

## CODE
\`\`\`language
[working code]
\`\`\`
Output:
\`\`\`
[output]
\`\`\`

RULES:
- Use ONLY sections relevant to the question
- Do NOT add USES/APPLICATIONS unless question asks for it
- Do NOT add DIAGRAM unless concept has a visual
- Bold **key terms** only
- Be direct, no filler text`;

async function callGroq(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.3,
      max_tokens: 2000
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Groq API error');
  return data.choices[0].message.content;
}

function ensureDiagram(answer, question) {
  if (answer.includes('DIAGRAM:')) return answer;
  const q = question.toLowerCase();
  const map = {
    'deadlock': 'deadlock resource allocation graph',
    'process state': 'process state diagram new ready running waiting terminated',
    'stack': 'stack data structure push pop',
    'queue': 'queue data structure enqueue dequeue',
    'linked list': 'linked list nodes and pointers',
    'binary tree': 'binary search tree',
    'osi': 'OSI model seven layers',
    'tcp/ip': 'TCP/IP model four layers',
    'paging': 'paging memory management page table',
    'bubble sort': 'bubble sort step by step',
    'photosynthesis': 'photosynthesis reactants chloroplast products',
  };
  for (const [kw, diag] of Object.entries(map)) {
    if (q.includes(kw)) {
      return answer + `\n\n## DIAGRAM\nDIAGRAM: ${diag}`;
    }
  }
  return answer;
}

router.post('/single', authMiddleware, async (req, res) => {
  const { question, mark, subject } = req.body;
  if (!question || !mark) return res.status(400).json({ error: 'Question and mark value are required' });
  if (![2, 5, 7, 10].includes(Number(mark))) return res.status(400).json({ error: 'Mark must be 2, 5, 7, or 10' });

  try {
    const isMath = isMathQuestion(question);
    const systemPrompt = isMath ? MATH_PROMPT : THEORY_PROMPT;
    const userMsg = subject
      ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}`
      : `Question (${mark} marks): ${question}`;

    let answer = await callGroq([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg }
    ]);

    if (!isMath && Number(mark) >= 5) {
      answer = ensureDiagram(answer, question);
    }

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

  const results = [], errors = [];
  for (const q of questions) {
    const { question, mark, subject } = q;
    if (!question || !mark) { errors.push({ question, error: 'Missing question or mark' }); continue; }
    try {
      const isMath = isMathQuestion(question);
      const systemPrompt = isMath ? MATH_PROMPT : THEORY_PROMPT;
      const userMsg = subject
        ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}`
        : `Question (${mark} marks): ${question}`;

      let answer = await callGroq([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ]);

      if (!isMath && Number(mark) >= 5) answer = ensureDiagram(answer, question);

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
