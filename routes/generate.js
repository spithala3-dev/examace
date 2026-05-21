const express = require('express');
const { pool } = require('../db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const SYSTEM_PROMPT = `You are an expert exam answer writer. Format answers with clear sections.

FOR THEORY QUESTIONS use these sections:

## DEFINITION
[definition here]

## KEY POINTS
- point 1
- point 2

## USES / APPLICATIONS
- use 1
- use 2

## EXAMPLE
[example here]

## COMPARISON TABLE
[only for compare questions]

## CODE
[only for code questions]

## DIAGRAM
DIAGRAM: [write exact diagram type here]

DIAGRAM RULES - you MUST include a DIAGRAM section for these topics:
- deadlock → DIAGRAM: deadlock resource allocation graph with processes and resources
- process states → DIAGRAM: process state diagram with new ready running waiting terminated
- stack → DIAGRAM: stack data structure with push pop operations
- queue → DIAGRAM: queue data structure with enqueue dequeue
- linked list → DIAGRAM: linked list with nodes and pointers
- binary tree → DIAGRAM: binary search tree with nodes
- OSI model → DIAGRAM: OSI model seven layers
- TCP/IP → DIAGRAM: TCP/IP model four layers
- paging → DIAGRAM: paging memory management with page table
- sorting → DIAGRAM: bubble sort step by step array
- circuit → DIAGRAM: circuit diagram with components
- rectifier → DIAGRAM: full wave rectifier circuit with diodes

FOR MATH QUESTIONS use:

## GIVEN
$$[equation]$$

## SOLUTION

**Step 1: [name]**

$$[equation on its own line]$$

$$[next calculation]$$

**Step 2: [name]**

$$[equation]$$

## RESULT
$$\\boxed{[answer]}$$

## EXPLANATION
- Step 1: [simple English]
- Step 2: [simple English]

MARK LENGTH: 2=short, 5=medium, 7=detailed, 10=very detailed`;

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

// Detect if topic needs a diagram and append if AI missed it
function ensureDiagram(answer, question) {
  if (answer.includes('DIAGRAM:')) return answer;
  const q = question.toLowerCase();
  const diagrams = {
    'deadlock': 'deadlock resource allocation graph with processes and resources',
    'process state': 'process state diagram with new ready running waiting terminated',
    'stack': 'stack data structure with push pop operations',
    'queue': 'queue data structure with enqueue dequeue',
    'linked list': 'linked list with nodes and pointers',
    'binary tree': 'binary search tree with nodes',
    'bst': 'binary search tree with nodes',
    'osi model': 'OSI model seven layers',
    'osi': 'OSI model seven layers',
    'tcp': 'TCP/IP model four layers',
    'paging': 'paging memory management with page table',
    'segmentation': 'memory segmentation diagram',
    'bubble sort': 'bubble sort step by step array',
    'sorting': 'bubble sort step by step array',
    'rectifier': 'full wave rectifier circuit with diodes transformer and load resistor',
    'circuit': 'circuit diagram with components',
    'virtual memory': 'virtual memory paging with page table',
  };
  for (const [keyword, diag] of Object.entries(diagrams)) {
    if (q.includes(keyword)) {
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
    // Auto-add diagram if AI missed it
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
