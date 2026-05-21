const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const SYSTEM_PROMPT = `You are an expert exam answer writer. Format answers with clear sections.

FOR THEORY QUESTIONS:

## DEFINITION
[definition calibrated to mark value]

## KEY POINTS
- **Point 1:** explanation
- **Point 2:** explanation

## USES / APPLICATIONS
- Use 1 with real example
- Use 2 with real example

## EXAMPLE
[concrete real-world example]

## COMPARISON TABLE
[ONLY for compare questions - use markdown table]

## CODE
[ONLY for code questions - working code with output]

## DIAGRAM
DIAGRAM: [describe exact diagram needed]

FOR MATH QUESTIONS:

## GIVEN
$$[equation in LaTeX]$$

## SOLUTION

**Step 1: [name]**

$$[formula]$$

$$[substitution]$$

$$[result]$$

**Step 2: [name]**

$$[working]$$

## RESULT
$$\\boxed{[final answer]}$$

## EXPLANATION
- Step 1: [simple English what was done]
- Step 2: [simple English what was done]

MARK LENGTH: 2=short, 5=medium, 7=detailed, 10=very detailed
ALWAYS include DIAGRAM section for: deadlock, process states, stack, queue, linked list, binary tree, OSI model, TCP/IP, paging, sorting, photosynthesis, ER diagram`;

async function callGroq(userPrompt) {
  const apiKey = process.env.GROQ_API_KEY;
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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

function ensureDiagram(answer, question) {
  if (answer.includes('DIAGRAM:')) return answer;
  const q = question.toLowerCase();
  const map = {
    'deadlock': 'deadlock resource allocation graph with processes and resources',
    'process state': 'process state diagram with new ready running waiting terminated',
    'stack': 'stack data structure with push pop operations',
    'queue': 'queue data structure with enqueue dequeue',
    'linked list': 'linked list with nodes and pointers',
    'binary tree': 'binary search tree with nodes',
    'bst': 'binary search tree with nodes',
    'osi': 'OSI model seven layers with protocols',
    'tcp': 'TCP/IP model four layers',
    'paging': 'paging memory management with page table',
    'virtual memory': 'paging virtual memory with page table',
    'bubble sort': 'bubble sort step by step array passes',
    'sorting': 'bubble sort step by step array passes',
    'photosynthesis': 'photosynthesis equation with reactants chloroplast and products',
    'er diagram': 'entity relationship diagram with entities and relationships',
    'entity relationship': 'entity relationship diagram with entities and relationships',
    'rectifier': 'full wave rectifier circuit with diodes transformer and load',
    'circuit': 'circuit diagram with components',
    'flowchart': 'flowchart algorithm with start process decision end',
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
    const userPrompt = subject
      ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}`
      : `Question (${mark} marks): ${question}`;
    let answer = await callGroq(userPrompt);
    if (Number(mark) >= 5) answer = ensureDiagram(answer, question);
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
      const userPrompt = subject
        ? `Subject: ${subject}\nQuestion (${mark} marks): ${question}`
        : `Question (${mark} marks): ${question}`;
      let answer = await callGroq(userPrompt);
      if (Number(mark) >= 5) answer = ensureDiagram(answer, question);
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
