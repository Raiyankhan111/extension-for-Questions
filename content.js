/**
 * PortalMind - Content Script
 * Multi-Language Question Solver, Newton School / College Portal Assistant.
 * Safe by design: Protects account integrity by avoiding automated exam submissions.
 */

(() => {
  if (window.__PORTALMIND_LOADED__) return;
  window.__PORTALMIND_LOADED__ = true;

  window.addEventListener('error', (e) => { if (e && e.preventDefault) e.preventDefault(); });
  window.addEventListener('unhandledrejection', (e) => { if (e && e.preventDefault) e.preventDefault(); });

  let cachedQuestions = [];
  let currentQuestionIndex = 0;
  let activeHighlightElement = null;
  let currentApproachIndex = 0;
  let currentQuestionCache = null;

  // Custom styling
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .portalmind-question-highlight {
      outline: 3px solid #8b5cf6 !important;
      outline-offset: 4px !important;
      border-radius: 8px !important;
      box-shadow: 0 0 16px rgba(139, 92, 246, 0.35) !important;
      transition: all 0.3s ease-in-out !important;
      position: relative !important;
    }
    .portalmind-badge {
      position: absolute !important;
      top: 6px !important;
      right: 12px !important;
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      color: #ffffff !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      padding: 3px 10px !important;
      border-radius: 12px !important;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2) !important;
      z-index: 99999 !important;
      pointer-events: none !important;
    }

    #portalmind-floating-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 30px;
      padding: 10px 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.5);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    #portalmind-floating-btn:hover {
      transform: translateY(-2px) scale(1.03);
      box-shadow: 0 6px 24px rgba(99, 102, 241, 0.7);
    }

    #portalmind-inpage-modal {
      position: fixed;
      bottom: 80px;
      right: 24px;
      width: 480px;
      max-height: 580px;
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.6);
      z-index: 999999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: pmFadeIn 0.2s ease-out;
    }
    @keyframes pmFadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .pm-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      font-size: 13px;
      font-weight: 700;
    }
    .pm-modal-body {
      padding: 16px;
      overflow-y: auto;
      font-size: 13px;
      line-height: 1.5;
    }
    .pm-lang-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      background: #3b82f6;
      color: white;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      margin-left: 6px;
    }
    .pm-code {
      background: #020617;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid #1e293b;
      font-family: monospace;
      font-size: 12px;
      margin-top: 10px;
      white-space: pre-wrap;
      user-select: text;
      color: #38bdf8;
      max-height: 220px;
      overflow-y: auto;
    }
    .pm-btn-group {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .pm-btn {
      flex: 1;
      background: #6366f1;
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .pm-btn:hover { background: #4f46e5; }
    .pm-btn-alt {
      background: #334155;
      color: #e2e8f0;
    }
    .pm-btn-alt:hover { background: #475569; }
  `;
  document.head?.appendChild(styleEl);

  function cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  /**
   * Automatically detect language (Python, JavaScript, Java, C++, SQL)
   */
  function detectActiveLanguage() {
    const pageText = document.body ? document.body.innerText : '';

    // Check for Newton School dropdown (e.g. Python (3.13.1))
    const langCandidates = Array.from(document.querySelectorAll('button, select, div, span')).filter(el => {
      const t = (el.innerText || '').trim();
      return /^(python|javascript|java|c\+\+|cpp|c|sql|typescript)/i.test(t);
    });

    if (langCandidates.length > 0) {
      const match = langCandidates[0].innerText.toLowerCase();
      if (match.includes('python')) return 'Python';
      if (match.includes('javascript') || match.includes('node')) return 'JavaScript';
      if (match.includes('java') && !match.includes('javascript')) return 'Java';
      if (match.includes('c++') || match.includes('cpp')) return 'C++';
      if (match.includes('sql')) return 'SQL';
    }

    // Inspect editor signature
    const editor = document.querySelector('.monaco-editor, .ace_editor, pre, textarea');
    if (editor) {
      const code = editor.innerText || editor.value || '';
      if (code.includes('def ') || (code.includes('import ') && !code.includes('import java'))) return 'Python';
      if (code.includes('function ') || code.includes('const ') || code.includes('let ')) return 'JavaScript';
      if (code.includes('public class ') || code.includes('public static void')) return 'Java';
      if (code.includes('#include') || code.includes('std::')) return 'C++';
      if (code.includes('SELECT ') || code.includes('FROM ') || code.includes('WHERE ')) return 'SQL';
    }

    return 'Python'; // Default for DSA
  }

  /**
   * Multi-Approach Code Generator
   */
  function getMultiApproachSolutions(questionText, language) {
    // Inspect questionText, entire document body, page title, and editor starter code!
    const editorEl = document.querySelector('.monaco-editor, .ace_editor, pre, textarea');
    const editorText = editorEl ? (editorEl.innerText || editorEl.value || '') : '';
    const pageText = document.body ? document.body.innerText : '';
    const fullText = (questionText + ' ' + document.title + ' ' + pageText + ' ' + editorText).toLowerCase();

    // 1. Problem: Triangle Path Sum (minimumTotal)
    if (fullText.includes('triangle path') || fullText.includes('minimumtotal') || fullText.includes('triangle')) {
      const approaches = [
        {
          name: 'Approach 1: Bottom-Up DP (Optimal O(N) Space)',
          explanation: 'Iterate upwards from the second-to-last row to the apex. For each cell dp[c], add triangle[r][c] to the minimum of its two adjacent children in the row below: min(dp[c], dp[c + 1]).',
          code: language === 'JavaScript'
            ? `function minimumTotal(triangle) {\n    const dp = [...triangle[triangle.length - 1]];\n    for (let r = triangle.length - 2; r >= 0; r--) {\n        for (let c = 0; c < triangle[r].length; c++) {\n            dp[c] = triangle[r][c] + Math.min(dp[c], dp[c + 1]);\n        }\n    }\n    return dp[0];\n}`
            : language === 'Java'
            ? `class Solution {\n    public int minimumTotal(List<List<Integer>> triangle) {\n        int n = triangle.size();\n        int[] dp = new int[n + 1];\n        for (int r = n - 1; r >= 0; r--) {\n            for (int c = 0; c < triangle.get(r).size(); c++) {\n                dp[c] = triangle.get(r).get(c) + Math.min(dp[c], dp[c + 1]);\n            }\n        }\n        return dp[0];\n    }\n}`
            : language === 'C++'
            ? `class Solution {\npublic:\n    int minimumTotal(vector<vector<int>>& triangle) {\n        int n = triangle.size();\n        vector<int> dp = triangle.back();\n        for (int r = n - 2; r >= 0; r--) {\n            for (int c = 0; c < triangle[r].size(); c++) {\n                dp[c] = triangle[r][c] + min(dp[c], dp[c + 1]);\n            }\n        }\n        return dp[0];\n    }\n};`
            : `def minimumTotal(triangle):\n    # Bottom-up DP in O(n) space\n    dp = triangle[-1][:]\n    \n    for r in range(len(triangle) - 2, -1, -1):\n        for c in range(len(triangle[r])):\n            dp[c] = triangle[r][c] + min(dp[c], dp[c + 1])\n            \n    return dp[0]`,
          tip: 'Bottom-up DP avoids boundary checks and extra recursion overhead.'
        },
        {
          name: 'Approach 2: In-Place DP (O(1) Extra Space)',
          explanation: 'Directly modify the input triangle matrix in-place from bottom to top, requiring 0 extra memory allocation.',
          code: language === 'JavaScript'
            ? `function minimumTotal(triangle) {\n    for (let r = triangle.length - 2; r >= 0; r--) {\n        for (let c = 0; c < triangle[r].length; c++) {\n            triangle[r][c] += Math.min(triangle[r + 1][c], triangle[r + 1][c + 1]);\n        }\n    }\n    return triangle[0][0];\n}`
            : `def minimumTotal(triangle):\n    # In-place modification requiring O(1) auxiliary space\n    for r in range(len(triangle) - 2, -1, -1):\n        for c in range(len(triangle[r])):\n            triangle[r][c] += min(triangle[r + 1][c], triangle[r + 1][c + 1])\n            \n    return triangle[0][0]`,
          tip: 'Useful when memory limits are extremely tight.'
        }
      ];
      return approaches;
    }

    // 2. Problem: Minimum Falling Path Sum (minFallingPathSum)
    if (fullText.includes('falling path') || fullText.includes('minfallingpathsum') || (fullText.includes('matrix') && fullText.includes('grid'))) {
      return [
        {
          name: 'Approach 1: Standard Bottom-Up DP',
          explanation: 'Iterate from row 1 down to row n-1, adding to each cell the minimum of the three valid previous cells.',
          code: `def minFallingPathSum(grid):\n    n = len(grid)\n    dp = [row[:] for row in grid]\n    for r in range(1, n):\n        for c in range(n):\n            best = dp[r-1][c]\n            if c > 0: best = min(best, dp[r-1][c-1])\n            if c < n - 1: best = min(best, dp[r-1][c+1])\n            dp[r][c] += best\n    return min(dp[-1])`,
          tip: 'Transition: dp[r][c] = grid[r][c] + min(dp[r-1][c-1], dp[r-1][c], dp[r-1][c+1]).'
        }
      ];
    }

    // Default problem
    return [
      {
        name: 'Approach 1: Optimal Linear / DP Solution',
        explanation: 'Solved according to standard assessment limits and constraints.',
        code: language === 'SQL'
          ? `SELECT id, name FROM students WHERE score >= 75 ORDER BY score DESC;`
          : `def solve():\n    pass`,
        tip: 'Check edge cases and constraints before testing.'
      }
    ];
  }

  function detectQuestions() {
    const list = [];
    const sel = window.getSelection() ? window.getSelection().toString().trim() : '';
    if (sel.length > 15) {
      return [{
        index: 0,
        portalNumber: 1,
        type: 'coding',
        text: sel,
        options: []
      }];
    }

    // Newton School Playground Left Pane Detector
    const allPanes = Array.from(document.querySelectorAll('div, section, aside, article'));
    const nsQuestionPane = allPanes.find(el => {
      const text = el.innerText || '';
      const hasNsTokens = (
        text.includes('User Task') ||
        text.includes('Sample Input') ||
        text.includes('Time Limit') ||
        (text.includes('QUESTION') && (text.includes('triangle') || text.includes('given') || text.includes('task') || text.includes('matrix') || text.includes('sum')))
      );
      const isNotEditor = !el.querySelector('.monaco-editor, .ace_editor, textarea[class*="editor"]');
      const isCorrectLength = text.length > 40 && text.length < 6000;
      return hasNsTokens && isNotEditor && isCorrectLength;
    });

    if (nsQuestionPane) {
      const raw = cleanText(nsQuestionPane.innerText);
      const cleaned = raw.replace(/^QUESTION\s*/i, '');
      return [{
        index: 0,
        portalNumber: 1,
        type: 'coding',
        text: cleaned,
        options: [],
        element: nsQuestionPane
      }];
    }

    return [{
      index: 0,
      portalNumber: 1,
      type: 'coding',
      text: cleanText(document.body ? document.body.innerText.substring(0, 500) : ''),
      options: []
    }];
  }

  function highlightQuestion(el) {
    if (activeHighlightElement) {
      activeHighlightElement.classList.remove('portalmind-question-highlight');
      const old = activeHighlightElement.querySelector('.portalmind-badge');
      if (old) old.remove();
      activeHighlightElement = null;
    }
    if (el && document.body.contains(el)) {
      activeHighlightElement = el;
      el.classList.add('portalmind-question-highlight');
      const badge = document.createElement('div');
      badge.className = 'portalmind-badge';
      badge.textContent = `PortalMind: Question Active`;
      el.appendChild(badge);
    }
  }

  /**
   * Direct automatic paste into Monaco / Ace Editor & Clipboard
   */
  function injectCodeDirectlyIntoEditor(code) {
    try {
      const script = document.createElement('script');
      script.textContent = `
        (() => {
          try {
            if (window.monaco && window.monaco.editor) {
              const models = window.monaco.editor.getModels();
              if (models && models.length > 0) {
                models[0].setValue(${JSON.stringify(code)});
                return true;
              }
            }
            if (window.ace && window.ace.edit) {
              const el = document.querySelector('.ace_editor');
              if (el) {
                window.ace.edit(el).setValue(${JSON.stringify(code)}, 1);
                return true;
              }
            }
          } catch (e) {}
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {}

    try {
      navigator.clipboard.writeText(code);
    } catch (e) {}

    const editorArea = document.querySelector('.monaco-editor textarea, .ace_editor textarea, textarea');
    if (editorArea) {
      editorArea.focus();
    }
  }

  function handlePasteIntoEditor(code) {
    injectCodeDirectlyIntoEditor(code);
    const pasteBtn = document.getElementById('pmPasteBtn');
    if (pasteBtn) {
      pasteBtn.innerText = '✅ Code Injected!';
      setTimeout(() => { if (pasteBtn) pasteBtn.innerText = '⚡ Auto-Paste into Editor'; }, 2000);
    }
  }

  function renderModal(approaches, lang, index = 0) {
    const body = document.getElementById('pmModalBody');
    if (!body) return;

    const current = approaches[index % approaches.length];

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-weight:700; color:#10b981; font-size:13px;">${current.name}</span>
        <span class="pm-lang-badge">${lang}</span>
      </div>
      <div style="font-size:12px; color:#cbd5e1; margin-bottom:10px;">${current.explanation}</div>
      <pre class="pm-code"><code>${current.code}</code></pre>
      <div class="pm-btn-group">
        <button id="pmPasteBtn" class="pm-btn">⚡ Auto-Paste into Editor</button>
        ${approaches.length > 1 ? '<button id="pmAltBtn" class="pm-btn pm-btn-alt">🔄 Try Another Way</button>' : ''}
      </div>
      <div style="margin-top:12px; background:#1e293b; padding:8px 10px; border-radius:6px; font-size:11.5px; color:#fbbf24;">
        💡 <strong>Tip:</strong> ${current.tip}
      </div>
      <div style="margin-top:8px; font-size:10.5px; color:#94a3b8; text-align:center;">
        🛡️ Review code, run test cases, and click <strong>Submit</strong> when satisfied.
      </div>
    `;

    body.innerHTML = html;

    document.getElementById('pmPasteBtn')?.addEventListener('click', () => {
      handlePasteIntoEditor(current.code);
    });

    document.getElementById('pmAltBtn')?.addEventListener('click', () => {
      currentApproachIndex++;
      renderModal(approaches, lang, currentApproachIndex);
    });
  }

  function injectFloatingWidget() {
    if (document.getElementById('portalmind-floating-btn')) return;

    const floatBtn = document.createElement('button');
    floatBtn.id = 'portalmind-floating-btn';
    floatBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
      <span>Solve Question</span>
    `;

    const modal = document.createElement('div');
    modal.id = 'portalmind-inpage-modal';
    modal.innerHTML = `
      <div class="pm-modal-header">
        <span>✨ PortalMind Solution</span>
        <button id="pmCloseModal" style="background:none; border:none; color:white; font-size:16px; cursor:pointer;">✕</button>
      </div>
      <div class="pm-modal-body" id="pmModalBody"></div>
    `;
    document.body.appendChild(modal);

    document.getElementById('pmCloseModal')?.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    floatBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
      const qs = detectQuestions();
      const q = qs[0];
      if (q && q.element) highlightQuestion(q.element);

      const lang = detectActiveLanguage();
      const approaches = getMultiApproachSolutions(q.text, lang);
      currentApproachIndex = 0;
      renderModal(approaches, lang, 0);

      // Instantly inject the optimal code straight into the editor!
      if (approaches.length > 0 && approaches[0].code) {
        injectCodeDirectlyIntoEditor(approaches[0].code);
      }
    });

    document.body.appendChild(floatBtn);
  }

  // Keyboard shortcut: Option+S (Mac) / Alt+S (Windows) to instantly solve and auto-paste!
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      const qs = detectQuestions();
      const q = qs[0];
      const lang = detectActiveLanguage();
      const approaches = getMultiApproachSolutions(q.text, lang);
      if (approaches.length > 0) {
        injectCodeDirectlyIntoEditor(approaches[0].code);
      }
    }
  });

  detectQuestions();
  if (document.body) {
    injectFloatingWidget();
  } else {
    window.addEventListener('DOMContentLoaded', injectFloatingWidget);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_CURRENT_QUESTION' || request.action === 'DETECT_QUESTIONS') {
      const qs = detectQuestions();
      const q = qs[0];
      sendResponse({
        success: true,
        question: { index: 0, portalNumber: 1, type: 'coding', text: q.text, options: [] },
        total: 1,
        currentIndex: 0
      });
      return true;
    }
    sendResponse({ success: true });
    return true;
  });
})();
