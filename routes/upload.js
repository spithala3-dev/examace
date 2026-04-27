const express = require('express');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// POST /api/upload/extract
// Accepts base64 encoded file, extracts questions using Groq
router.post('/extract', authMiddleware, async (req, res) => {
  const { fileData, fileType, fileName } = req.body;

  if (!fileData) return res.status(400).json({ error: 'No file data provided' });

  try {
    const apiKey = process.env.GROQ_API_KEY;

    // Build prompt to extract questions
    const prompt = `You are analyzing an exam question paper. 
Extract ALL questions from this text. 
Return ONLY a valid JSON array like this:
[
  {"number": 1, "question": "What is deadlock?", "suggestedMark": 2},
  {"number": 2, "question": "Compare TCP and UDP", "suggestedMark": 5}
]

Rules:
- suggestedMark must be one of: 2, 5, 7, 10
- Guess the mark from context clues like "(2 marks)", "short answer", "explain in detail" etc
- If no mark hint found, default to 5
- Include ALL questions you find
- Return ONLY the JSON array, no other text

File name: ${fileName}
File content/text:
${fileData}`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'AI error');

    let text = data.choices[0].message.content.trim();

    // Clean up response - extract JSON
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Could not parse questions from file');

    const questions = JSON.parse(jsonMatch[0]);
    res.json({ questions, total: questions.length });

  } catch (err) {
    console.error('Upload extract error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to extract questions' });
  }
});

module.exports = router;
