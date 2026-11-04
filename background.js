/**
 * PortalMind - Background Service Worker (Manifest V3)
 * Manages AI API routing, caching, and background communication.
 */

const DEFAULT_CONFIG = {
  apiMode: 'backend', // 'backend' or 'direct'
  backendUrl: 'https://backend-liart-nu-yxtysqqlih.vercel.app/api/solve',
  geminiApiKey: '',
  geminiModel: 'gemini-1.5-flash',
  explanationLevel: 'detailed', // 'concise' or 'detailed'
  autoDetect: true
};

// Initialize default settings upon installation
chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.sync.get(null);
  const updated = { ...DEFAULT_CONFIG, ...current };
  await chrome.storage.sync.set(updated);
  console.log('[PortalMind] Service worker initialized with config:', updated);
});

// Cache for answers in current session to prevent duplicate API calls
const solutionCache = new Map();

function hashQuestion(text, options = []) {
  const optsStr = options.map(o => `${o.letter}:${o.text}`).join('|');
  return `${(text || '').trim()}##${optsStr}`;
}

/**
 * Format prompt for AI model
 */
function buildPrompt(questionData, config) {
  const { text, options, type } = questionData;
  let optionsText = '';
  if (options && options.length > 0) {
    optionsText = options.map(opt => `  ${opt.letter}) ${opt.text}`).join('\n');
  }

  return `
You are an expert college professor and tutor. Analyze the following question from a student portal and provide the correct solution, followed by a clear, step-by-step explanation.

QUESTION TYPE: ${type.toUpperCase()}

QUESTION:
${text}

${optionsText ? `OPTIONS:\n${optionsText}` : ''}

INSTRUCTIONS:
1. Return your response in STRICT valid JSON format with this exact structure:
{
  "answer": "Selected option letter and text for MCQ (e.g. 'B) O(log n)') OR direct concise final answer for Theory/Coding",
  "selectedOption": "A/B/C/D if MCQ, otherwise null",
  "explanation": "Clear, simple step-by-step breakdown explaining why this is correct and why other options are wrong (if MCQ).",
  "code": "Beginner-friendly code snippet if this is a coding question, otherwise null",
  "tips": "A 1-sentence exam tip or mnemonic to remember this concept."
}
2. Tone: Helpful, encouraging, educational, simple English.
3. If coding question: Provide clean, commented code with time and space complexity.
4. Output ONLY valid raw JSON without markdown backticks.
`;
}

/**
 * Calls the Secure Backend Server
 */
async function callBackendApi(questionData, config) {
  const response = await fetch(config.backendUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      question: questionData.text,
      options: questionData.options,
      type: questionData.type,
      explanationLevel: config.explanationLevel
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Backend server responded with status ${response.status}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Direct Google Gemini API integration (fallback or standalone client mode)
 */
async function callGeminiDirectApi(questionData, config) {
  if (!config.geminiApiKey) {
    throw new Error('Gemini API key is not configured. Please open extension options and enter your key, or run the local backend server.');
  }

  const model = config.geminiModel || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`;

  const prompt = buildPrompt(questionData, config);

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      topK: 40,
      topP: 0.95,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const message = err.error?.message || `Gemini API error (Status ${response.status})`;
    throw new Error(message);
  }

  const result = await response.json();
  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('AI returned an empty response.');
  }

  // Parse JSON response
  try {
    const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return {
      answer: rawText.substring(0, 150),
      selectedOption: null,
      explanation: rawText,
      code: null,
      tips: 'Always double-check logic with official lecture notes.'
    };
  }
}

/**
 * Handle AI generation routing
 */
async function solveQuestion(questionData) {
  const hash = hashQuestion(questionData.text, questionData.options);

  // Return cached answer if available
  if (solutionCache.has(hash)) {
    return {
      success: true,
      data: solutionCache.get(hash),
      fromCache: true
    };
  }

  const config = await chrome.storage.sync.get(DEFAULT_CONFIG);

  let solution;
  if (config.apiMode === 'direct') {
    solution = await callGeminiDirectApi(questionData, config);
  } else {
    try {
      solution = await callBackendApi(questionData, config);
    } catch (backendErr) {
      // If backend fails but direct Gemini API key is configured, fallback to direct
      if (config.geminiApiKey) {
        console.warn('[PortalMind] Backend failed, attempting fallback to direct Gemini API...', backendErr);
        solution = await callGeminiDirectApi(questionData, config);
      } else {
        throw backendErr;
      }
    }
  }

  // Normalize solution fields
  const normalized = {
    answer: solution.answer || 'Answer not determined',
    selectedOption: solution.selectedOption || null,
    explanation: solution.explanation || 'No explanation provided.',
    code: solution.code || null,
    tips: solution.tips || 'Review portal guidelines for confirmation.'
  };

  solutionCache.set(hash, normalized);

  return {
    success: true,
    data: normalized,
    fromCache: false
  };
}

// Runtime message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SOLVE_QUESTION') {
    solveQuestion(request.questionData)
      .then(res => sendResponse(res))
      .catch(err => {
        sendResponse({
          success: false,
          error: err.message || 'Failed to generate solution'
        });
      });
    return true; // Keep channel open
  }

  if (request.action === 'TEST_CONNECTION') {
    (async () => {
      try {
        const dummyQuestion = {
          text: 'What is 2 + 2?',
          options: [
            { letter: 'A', text: '3' },
            { letter: 'B', text: '4' },
            { letter: 'C', text: '5' }
          ],
          type: 'mcq'
        };
        const res = await solveQuestion(dummyQuestion);
        sendResponse({ success: true, answer: res.data.answer });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === 'CLEAR_CACHE') {
    solutionCache.clear();
    sendResponse({ success: true });
    return true;
  }
});
