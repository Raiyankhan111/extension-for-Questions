function createPrompt(question, options = [], type = 'mcq', explanationLevel = 'detailed') {
  let optionsText = '';
  if (options && options.length > 0) {
    optionsText = options.map(opt => `  ${opt.letter}) ${opt.text}`).join('\n');
  }

  return `
You are an expert college professor and tutor. Analyze the following portal question and generate a verified solution.

QUESTION TYPE: ${type.toUpperCase()}

QUESTION:
${question}

${optionsText ? `OPTIONS:\n${optionsText}` : ''}

EXPLANATION DEPTH: ${explanationLevel}

INSTRUCTIONS:
1. Provide your response as STRICT JSON matching this schema:
{
  "answer": "Selected option letter + text (e.g. 'B) Stack, with O(1) push and O(1) pop') OR concise direct answer for Theory/Coding",
  "selectedOption": "A/B/C/D if MCQ, otherwise null",
  "explanation": "Clear, ${explanationLevel} breakdown explaining why this answer is correct and why other options are incorrect (if MCQ).",
  "code": "Beginner-friendly code snippet with comments if this is a coding question, otherwise null",
  "tips": "A high-yield 1-sentence tip or mnemonic to remember this concept for exams."
}
2. Tone: Instructive, clear, academic, easy to understand.
3. Return ONLY raw JSON without markdown code fences.
`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { question, options, type = 'mcq', explanationLevel = 'detailed' } = req.body || {};

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: 'Missing or invalid "question" in request body.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    if (!apiKey) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY environment variable is not configured on Vercel. Please set it in Vercel Project Settings > Environment Variables.'
      });
    }

    const prompt = createPrompt(question, options, type, explanationLevel);
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.15,
        topK: 40,
        topP: 0.95,
        responseMimeType: 'application/json'
      }
    };

    const apiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.json().catch(() => ({}));
      const message = errBody.error?.message || `Gemini API returned status ${apiResponse.status}`;
      return res.status(apiResponse.status).json({ error: message });
    }

    const data = await apiResponse.json();
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawContent) {
      return res.status(502).json({ error: 'AI returned an empty response.' });
    }

    let parsed;
    try {
      const cleaned = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      parsed = {
        answer: rawContent.substring(0, 120),
        selectedOption: null,
        explanation: rawContent,
        code: null,
        tips: 'Review university syllabus for topic confirmation.'
      };
    }

    return res.status(200).json(parsed);

  } catch (error) {
    console.error('[Vercel Solve Error]:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
