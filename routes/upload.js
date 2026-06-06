const express = require('express');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Vision models to try in order
const VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-vision-preview',
];

async function callVision(apiKey, base64Image, mimeType) {
  for (const model of VISION_MODELS) {
    try {
      console.log(`Trying vision model: ${model}`);
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Image}` }
              },
              {
                type: 'text',
                text: `You are reading an exam question paper image.
Extract ALL questions exactly as written.
Return ONLY a JSON array, no other text:
[
  {"number": 1, "question": "exact question text", "suggestedMark": 5},
  {"number": 2, "question": "exact question text", "suggestedMark": 2}
]
suggestedMark must be 2, 5, 7, or 10. Default to 5 if unsure.
Copy questions EXACTLY as they appear.`
              }
            ]
          }],
          max_tokens: 2000,
          temperature: 0.1
        })
      });

      const data = await response.json();
      if (response.ok && data.choices?.[0]?.message?.content) {
        console.log(`✅ Vision model ${model} worked`);
        return data.choices[0].message.content;
      }
      console.log(`❌ Model ${model} failed:`, JSON.stringify(data).slice(0, 200));
    } catch (err) {
      console.log(`❌ Model ${model} error:`, err.message);
    }
  }
  throw new Error('All vision models failed');
}

// POST /api/upload/extract
router.post('/extract', authMiddleware, async (req, res) => {
  const { fileData, fileType, fileName, isImage, isPDF } = req.body;
  if (!fileData) return res.status(400).json({ error: 'No file data provided' });

  const apiKey = process.env.GROQ_API_KEY;

  try {
    let questions = [];

    if (isImage) {
      // Use vision model to read image
      const text = await callVision(apiKey, fileData, fileType);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No questions found in image');
      questions = JSON.parse(jsonMatch[0]);

    } else if (isPDF) {
      // Extract text from PDF buffer
      const pdfBuffer = Buffer.from(fileData, 'base64');
      let pdfText = '';
      try {
        const pdfStr = pdfBuffer.toString('latin1');
        const textMatches = pdfStr.match(/BT([\s\S]*?)ET/g) || [];
        const extracted = [];
        textMatches.forEach(block => {
          const tjMatches = block.match(/\((.*?)\)\s*Tj/g) || [];
          tjMatches.forEach(m => {
            const t = m.replace(/^\(/, '').replace(/\)\s*Tj$/, '').trim();
            if (t.length > 2) extracted.push(t);
          });
        });
        pdfText = extracted.join(' ').substring(0, 3000);
      } catch(e) {
        pdfText = '';
      }

      if (pdfText.length < 50) {
        return res.status(400).json({
          error: 'PDF could not be read. Please take a screenshot or photo of your question paper and upload as JPG or PNG.',
          hint: 'image_preferred'
        });
      }

      // Use text model to extract questions from PDF text
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{
            role: 'user',
            content: `Extract ALL exam questions from this text. Return ONLY a JSON array:
[{"number": 1, "question": "exact question", "suggestedMark": 5}]
suggestedMark must be 2, 5, 7, or 10.

Text:
${pdfText}`
          }],
          max_tokens: 2000,
          temperature: 0.1
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'AI error');
      const text = data.choices[0].message.content.trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) questions = JSON.parse(jsonMatch[0]);
    }

    questions = questions.filter(q => q.question && q.question.trim().length > 5);
    res.json({ questions, total: questions.length });

  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to extract questions' });
  }
});

module.exports = router;
