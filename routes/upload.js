const express = require('express');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// POST /api/upload/extract
router.post('/extract', authMiddleware, async (req, res) => {
  const { fileData, fileType, fileName, isImage, isPDF } = req.body;

  if (!fileData) return res.status(400).json({ error: 'No file data provided' });

  try {
    const apiKey = process.env.GROQ_API_KEY;
    let questions = [];

    if (isImage) {
      // ── IMAGE: Use Groq vision to read actual content ──
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.2-90b-vision-preview',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${fileType};base64,${fileData}`
                  }
                },
                {
                  type: 'text',
                  text: `Look at this exam question paper image carefully.
Extract ALL questions exactly as written in the image.
Return ONLY a valid JSON array, no other text:
[
  {"number": 1, "question": "exact question text here", "suggestedMark": 5},
  {"number": 2, "question": "exact question text here", "suggestedMark": 2}
]

Rules:
- Copy questions EXACTLY as they appear in the image
- suggestedMark must be one of: 2, 5, 7, 10
- Guess mark from hints like "(2 marks)", "short answer", "explain in detail"
- If no mark hint, default to 5
- Include ALL questions you can see
- Return ONLY the JSON array`
                }
              ]
            }
          ],
          max_tokens: 2000,
          temperature: 0.1
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Vision API error:', JSON.stringify(data));
        // Fallback: if vision fails, tell user
        throw new Error('Could not read image. Please try a clearer photo.');
      }

      const text = data.choices[0].message.content.trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No questions found in image');
      questions = JSON.parse(jsonMatch[0]);

    } else if (isPDF) {
      // ── PDF: Use pdf-parse to extract text, then Groq to find questions ──
      // Since we can't run pdf-parse on base64 directly without saving,
      // we decode and process the PDF text content
      
      // Convert base64 to buffer and extract text using a simple approach
      const pdfBuffer = Buffer.from(fileData, 'base64');
      
      // Try to extract readable text from PDF buffer
      let pdfText = '';
      try {
        // Simple text extraction - look for readable strings in PDF
        const pdfStr = pdfBuffer.toString('latin1');
        // Extract text between BT and ET markers (PDF text objects)
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

      // If we got text from PDF, use it; otherwise use filename
      const contextText = pdfText.length > 50 
        ? `PDF content extracted:\n${pdfText}`
        : `PDF filename: ${fileName}\n(Could not extract text - please upload an image of the question paper instead)`;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'user',
              content: `Extract ALL exam questions from this PDF content.
${contextText}

Return ONLY a valid JSON array:
[
  {"number": 1, "question": "exact question text", "suggestedMark": 5},
  {"number": 2, "question": "exact question text", "suggestedMark": 2}
]

Rules:
- Extract questions EXACTLY as they appear
- suggestedMark: 2, 5, 7, or 10 only
- If text extraction failed, return empty array []
- Return ONLY the JSON array, nothing else`
            }
          ],
          max_tokens: 2000,
          temperature: 0.1
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'AI error');

      const text = data.choices[0].message.content.trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questions = JSON.parse(jsonMatch[0]);
      }

      // If PDF text extraction failed and no questions found
      if (!questions.length && pdfText.length < 50) {
        return res.status(400).json({ 
          error: 'PDF text could not be read. Please take a photo/screenshot of the question paper and upload as an image (JPG or PNG) instead.',
          hint: 'image_preferred'
        });
      }
    }

    // Filter out empty questions
    questions = questions.filter(q => q.question && q.question.trim().length > 5);

    res.json({ questions, total: questions.length });

  } catch (err) {
    console.error('Upload extract error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to extract questions' });
  }
});

module.exports = router;
