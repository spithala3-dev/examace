const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();
function isMathQuestion(question) {
  const mathPatterns = [
    /solve/i,
    /find\s+the/i,
    /calculate/i,
    /evaluate/i,
    /simplify/i,
    /differentiate/i,
    /integrate/i,
    /prove/i,
    /derivative/i,

    /\d+\s*[\+\-\*\/\^]\s*\d+/,

    /x\^?\d/i,
    /y\^?\d/i,

    /\\frac/i,
    /\\sqrt/i,

    /\bdx\b/i,
    /\bdy\b/i,

    /roots?\s+of/i,
    /factor/i,

    /matrix/i,
    /determinant/i,
    /eigenvalue/i,

    /\blimit\b/i,
    /\blim\b/i,

    /\blog\b/i,
    /\bln\b/i,

    /adjacency matrix/i,
    /truth table/i,

    /=\s*0/,
    /=\s*\d/
  ];

  return mathPatterns.some(pattern =>
    pattern.test(question)
  );
}
function detectQuestionType(question){
  const q = question.toLowerCase();

  if(isMathQuestion(question))
    return 'mathematics';

  if(/compare|difference|distinguish|differentiate|vs|versus/i.test(q))
    return 'comparison';

  if(/write.*program|write.*code|implement|c program|java program/i.test(q))
    return 'programming';

  if(/algorithm/i.test(q))
    return 'algorithm';

  if(/advantages|benefits/i.test(q))
    return 'advantages';

  if(/what is|define/i.test(q))
    return 'definition';

  return 'theory';
}
function selectPrompt(type) {
  switch (type) {
    case 'definition':
      return DEFINITION_PROMPT;

    case 'comparison':
      return COMPARISON_PROMPT;

    case 'programming':
      return PROGRAMMING_PROMPT;

    case 'algorithm':
      return PROGRAMMING_PROMPT;

    case 'advantages':
      return THEORY_PROMPT;

    case 'mathematics':
      return MATH_PROMPT;

    default:
      return THEORY_PROMPT;
  }
}

const MATH_PROMPT = `You are a mathematics expert. Solve problems step by step.

FORMAT RULES:
- Each equation on its OWN LINE wrapped in $$
- NEVER put two equations on the same line
- NEVER mix text and equations on the same line
- Show EVERY step — never skip
- Use LaTeX: \\frac{a}{b}, \\sqrt{x}, \\pm, x^2, \\times

FORMAT:

**Step 1:** [name]

$$[equation or formula]$$

$$[substitution]$$

$$[result]$$

**Step 2:** [name]

$$[working]$$

$$[result]$$

$$\\boxed{[final answer]}$$

MATRIX RULES — VERY IMPORTANT:
- Write matrices as JSON arrays: [[1,0,1],[0,1,0],[1,0,1]]
- Each row in its own inner array
- This renders as a proper grid with borders
- Example adjacency matrix: [[0,1,1,0],[1,0,0,1],[1,0,0,1],[0,1,1,0]]

TRUTH TABLE RULES — VERY IMPORTANT:
- Use markdown table format with | separators
- Headers: P | Q | R | P→Q | Q→R | (P→Q)∧(Q→R) | P→R
- Values: T or F only
- Every combination of T/F for input variables
- Example:
| P | Q | P→Q |
|---|---|-----|
| T | T | T |
| T | F | F |
| F | T | T |
| F | F | T |

No unnecessary English paragraphs. Just steps and math.`;

const THEORY_PROMPT = `You are an expert exam answer writer.

USE ONLY SECTIONS NEEDED for the question type:

For 2-mark:
## DEFINITION
[1-2 lines]
## EXAMPLE
[1 sentence]

For 5-mark:
## DEFINITION
[2-3 lines]
## KEY POINTS
- point with explanation
- point with explanation
- point with explanation
## EXAMPLE
[brief example]

For 7-mark:
## DEFINITION
[3-4 lines]
## KEY POINTS
- 5+ detailed points
## EXAMPLE
[detailed example]
## DIAGRAM
DIAGRAM: [description] ← only if visual concept

For 10-mark: All sections, very detailed.

For COMPARE questions — ONLY:
## COMPARISON
| Feature | A | B |
|---------|---|---|
[6-8 rows with examples]

For CODE questions:
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

STRICT RULES:
- Do NOT add USES unless question asks
- Do NOT add DIAGRAM unless concept is visual
- Bold **key terms** only
- No filler sentences`;
const DEFINITION_PROMPT = `
You are an engineering exam answer writer.

Answer according to marks.

## DEFINITION
Clear and correct definition.

## KEY POINTS
- Important point 1
- Important point 2
- Important point 3

## EXAMPLE
Simple engineering example.
`;

const COMPARISON_PROMPT = `
You are an engineering exam answer writer.

IMPORTANT:
Answer ONLY using a comparison table.

Format:

## COMPARISON

| Feature | Item A | Item B |
|----------|----------|----------|

Provide enough rows according to marks.

No unnecessary paragraphs.
`;

const PROGRAMMING_PROMPT = `
You are an engineering programming expert.

Format:

## DEFINITION

## ALGORITHM

Step 1
Step 2
Step 3

## PROGRAM

\`\`\`
code
\`\`\`

## OUTPUT

\`\`\`
output
\`\`\`

## TIME COMPLEXITY

## SPACE COMPLEXITY
`;
async function callGroq(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
    'paging': 'paging memory management page table',
    'bubble sort': 'bubble sort step by step',
    'photosynthesis': 'photosynthesis reactants chloroplast products',
  };
  for (const [kw, diag] of Object.entries(map)) {
    if (q.includes(kw)) return answer + `\n\n## DIAGRAM\nDIAGRAM: ${diag}`;
  }
  return answer;
}

router.post('/single', authMiddleware, async (req, res) => {
  const { question, mark, subject } = req.body;
  if (!question || !mark) return res.status(400).json({ error: 'Question and mark required' });
  if (![2, 5, 7, 10].includes(Number(mark))) return res.status(400).json({ error: 'Mark must be 2,5,7,10' });
  try {
    const questionType = detectQuestionType(question);

const systemPrompt =
  selectPrompt(questionType);

const isMath =
  questionType === 'mathematics';
    const userMsg = subject
      ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}`
      : `Question (${mark} marks): ${question}`;
    let answer = await callGroq([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg }
    ]);
    if (!isMath && Number(mark) >= 5) answer = ensureDiagram(answer, question);
    await pool.query(
      'INSERT INTO history (user_id, question, answer, mark, subject) VALUES ($1,$2,$3,$4,$5)',
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
  if (!Array.isArray(questions) || !questions.length)
    return res.status(400).json({ error: 'Questions array required' });
  if (questions.length > 5)
    return res.status(400).json({ error: 'Max 5 questions' });
  const results = [], errors = [];
  for (const q of questions) {
    const { question, mark, subject } = q;
    if (!question || !mark) { errors.push({ question, error: 'Missing fields' }); continue; }
    try {
    const questionType = detectQuestionType(question);

const systemPrompt =
  selectPrompt(questionType);

const isMath =
  questionType === 'mathematics';
      const userMsg = subject
        ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}`
        : `Question (${mark} marks): ${question}`;
      let answer = await callGroq([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ]);
      if (!isMath && Number(mark) >= 5) answer = ensureDiagram(answer, question);
      await pool.query('INSERT INTO history (user_id, question, answer, mark, subject) VALUES ($1,$2,$3,$4,$5)',
        [req.userId, question.trim(), answer, Number(mark), subject || '']);
      results.push({ question, answer, mark: Number(mark), subject: subject || '' });
    } catch (err) { errors.push({ question, error: err.message }); }
  }
  res.json({ results, errors });
});

module.exports = router;
