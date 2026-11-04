/**
 * PortalMind - Secure Backend AI Proxy Server
 * 
 * Zero-dependency implementation: runs out-of-the-box on standard Node.js (v18+)
 * without requiring 'npm install' while also supporting standard Express environments.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Basic .env file loader (zero-dependency)
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

const PORT = parseInt(process.env.PORT || '3001', 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

/**
 * Build structured prompt
 */
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

/**
 * Handle POST /api/solve
 */
async function handleSolve(req, res, body) {
  try {
    const payload = JSON.parse(body || '{}');
    const { question, options, type = 'mcq', explanationLevel = 'detailed' } = payload;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid "question" in request body.' }));
      return;
    }

    if (!GEMINI_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Backend error: GEMINI_API_KEY is not configured in .env. Please set GEMINI_API_KEY in college-portal-ai-extension/backend/.env or enter your key in the extension Options page.'
      }));
      return;
    }

    const prompt = createPrompt(question, options, type, explanationLevel);
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiPayload = {
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
      body: JSON.stringify(geminiPayload)
    });

    if (!apiResponse.ok) {
      const errBody = await apiResponse.json().catch(() => ({}));
      const message = errBody.error?.message || `Gemini API responded with status ${apiResponse.status}`;
      res.writeHead(apiResponse.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
      return;
    }

    const data = await apiResponse.json();
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawContent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'AI returned an empty response.' }));
      return;
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

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(parsed));

  } catch (error) {
    console.error('[PortalMind Backend Error]:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message || 'Internal server error' }));
  }
}

// HTTP Server
const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      service: 'PortalMind AI Backend',
      keyConfigured: Boolean(GEMINI_API_KEY && GEMINI_API_KEY.length > 5),
      model: GEMINI_MODEL
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/solve') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        req.destroy();
      }
    });
    req.on('end', () => {
      handleSolve(req, res, body);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found. Use GET /api/health or POST /api/solve' }));
});

server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 PortalMind Backend running on http://localhost:${PORT}`);
  console.log(`📡 Endpoints:`);
  console.log(`   - GET  http://localhost:${PORT}/api/health`);
  console.log(`   - POST http://localhost:${PORT}/api/solve`);
  console.log(`🔑 Gemini Key Configured: ${Boolean(GEMINI_API_KEY)}`);
  console.log(`===================================================`);
});
