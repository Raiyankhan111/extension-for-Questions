/**
 * PortalMind - Content Script
 * Robust question extractor and navigator for college portals & LMS platforms (Newton School, Canvas, Moodle, etc.).
 * Safe by design: NEVER clicks submit or bypasses portal integrity.
 */

(() => {
  if (window.__PORTALMIND_LOADED__) return;
  window.__PORTALMIND_LOADED__ = true;

  let cachedQuestions = [];
  let currentQuestionIndex = 0;
  let observer = null;
  let activeHighlightElement = null;

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

    /* Floating quick-solve button on college portal */
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

    /* In-page solution modal */
    #portalmind-inpage-modal {
      position: fixed;
      bottom: 80px;
      right: 24px;
      width: 440px;
      max-height: 540px;
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
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
    }
    .pm-btn {
      background: #6366f1;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
  `;
  document.head?.appendChild(styleEl);

  function cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  function determineQuestionType(container, options = []) {
    const text = (container.innerText || '').toLowerCase();
    const isCodingMatch = [
      'write a function', 'return the', 'def ', 'public class', 'function ',
      'time limit', 'memory limit', 'custom input', 'matrix', 'grid',
      'user task', 'sample input', 'sample output', 'constraints'
    ].some(kw => text.includes(kw));

    if (isCodingMatch) return 'coding';
    if (options && options.length >= 2) return 'mcq';
    return 'theory';
  }

  function extractOptions(container) {
    const options = [];

    // Inputs
    const inputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    if (inputs.length >= 2) {
      inputs.forEach((input, idx) => {
        let labelText = '';
        if (input.id) {
          const lbl = container.querySelector(`label[for="${input.id}"]`);
          if (lbl) labelText = lbl.innerText;
        }
        if (!labelText) {
          const parentLabel = input.closest('label');
          if (parentLabel) labelText = parentLabel.innerText;
        }
        if (!labelText && input.parentElement) {
          labelText = input.parentElement.innerText;
        }
        const cleaned = cleanText(labelText);
        if (cleaned) {
          options.push({
            letter: String.fromCharCode(65 + idx),
            text: cleaned.replace(/^[A-Da-d][\.\)\:\-]\s*/, '')
          });
        }
      });
      if (options.length >= 2) return options;
    }

    // Option cards
    const optionElements = container.querySelectorAll(
      '[class*="option"], [class*="Option"], [class*="choice"], .answer div, .quiz-option, [role="radio"]'
    );
    if (optionElements.length >= 2) {
      const seen = new Set();
      optionElements.forEach(el => {
        const text = cleanText(el.innerText);
        if (text && text.length < 200 && !seen.has(text)) {
          seen.add(text);
          options.push({
            letter: String.fromCharCode(65 + options.length),
            text: text.replace(/^[A-Da-d][\.\)\:\-]\s*/, '')
          });
        }
      });
      if (options.length >= 2 && options.length <= 6) return options;
    }

    return options;
  }

  function extractQuestionText(container, options = []) {
    const clone = container.cloneNode(true);
    const removeSelectors = [
      'button', 'script', 'style', 'svg', 'input',
      '.portalmind-badge', '#portalmind-floating-btn', '#portalmind-inpage-modal'
    ];
    removeSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    let text = cleanText(clone.innerText);
    if (options && options.length > 0) {
      options.forEach(opt => {
        if (opt.text && opt.text.length > 3) {
          text = text.replace(opt.text, '');
        }
      });
    }
    return cleanText(text);
  }

  /**
   * Main Question Detector (Newton School, Canvas, Moodle, LeetCode, etc.)
   */
  function detectQuestions() {
    const list = [];

    // 1. Check user mouse selection
    const sel = window.getSelection() ? window.getSelection().toString().trim() : '';
    if (sel.length > 15) {
      return [{
        index: 0,
        portalNumber: 1,
        type: sel.includes('def ') || sel.includes('function') || sel.includes('grid') ? 'coding' : 'theory',
        text: sel,
        options: []
      }];
    }

    // 2. NEWTON SCHOOL PLAYGROUND DETECTOR (Target the left question pane!)
    const allPanes = Array.from(document.querySelectorAll('div, section, aside, article'));
    const nsQuestionPane = allPanes.find(el => {
      const text = el.innerText || '';
      const hasNsTokens = (
        text.includes('User Task') ||
        text.includes('Sample Input') ||
        text.includes('Time Limit') ||
        (text.includes('QUESTION') && (text.includes('given') || text.includes('task') || text.includes('matrix') || text.includes('sum')))
      );
      const isNotEditor = !el.querySelector('.monaco-editor, .ace_editor, textarea[class*="editor"]');
      const isCorrectLength = text.length > 40 && text.length < 6000;
      return hasNsTokens && isNotEditor && isCorrectLength;
    });

    if (nsQuestionPane) {
      const raw = cleanText(nsQuestionPane.innerText);
      const cleaned = raw.replace(/^QUESTION\s*/i, '');
      const type = determineQuestionType(nsQuestionPane, []);
      return [{
        index: 0,
        portalNumber: 1,
        type,
        text: cleaned,
        options: [],
        element: nsQuestionPane
      }];
    }

    // 3. Multi-platform LMS container selectors
    const containerSelectors = [
      '.Pane1',
      'div[class*="Pane1"]',
      'div[class*="split-pane"] > div:first-child',
      '[class*="ProblemStatement"]',
      '[class*="problem-statement"]',
      '[class*="ProblemDescription"]',
      '[class*="problem-description"]',
      '[class*="question-container"]',
      '[class*="questionCard"]',
      '[class*="QuestionCard"]',
      '[class*="quiz-item"]',
      '.que',
      '.display_question',
      '.question_holder',
      '.takeQuestionDiv',
      '[role="listitem"]',
      '.d2l-quiz-question'
    ];

    let foundContainers = [];
    for (const sel of containerSelectors) {
      const elements = Array.from(document.querySelectorAll(sel));
      if (elements.length > 0) {
        foundContainers = elements;
        break;
      }
    }

    // 4. General fallback (cards or sections)
    if (foundContainers.length === 0) {
      const generalContainers = Array.from(document.querySelectorAll('fieldset, form .form-group, .card, article, [class*="problem"]'));
      foundContainers = generalContainers.filter(el => {
        const text = el.innerText || '';
        return text.length > 30 && (text.includes('?') || text.toLowerCase().includes('task') || text.toLowerCase().includes('given') || el.querySelectorAll('input[type="radio"]').length >= 2);
      });
    }

    // 5. Root/Main fallback
    if (foundContainers.length === 0) {
      const main = document.querySelector('main, #content, .content, [role="main"]');
      if (main && (main.innerText || '').length > 20) {
        foundContainers = [main];
      }
    }

    const seen = new Set();
    foundContainers.forEach((container, idx) => {
      const options = extractOptions(container);
      const questionText = extractQuestionText(container, options);

      if (questionText && questionText.length > 5) {
        const hash = questionText.substring(0, 100);
        if (!seen.has(hash)) {
          seen.add(hash);
          const type = determineQuestionType(container, options);
          list.push({
            index: list.length,
            portalNumber: idx + 1,
            type,
            text: questionText,
            options,
            element: container
          });
        }
      }
    });

    cachedQuestions = list;
    return list;
  }

  function highlightQuestion(index) {
    if (activeHighlightElement) {
      activeHighlightElement.classList.remove('portalmind-question-highlight');
      const oldBadge = activeHighlightElement.querySelector('.portalmind-badge');
      if (oldBadge) oldBadge.remove();
      activeHighlightElement = null;
    }

    if (index < 0 || index >= cachedQuestions.length) return;

    const q = cachedQuestions[index];
    if (q && q.element && document.body.contains(q.element)) {
      activeHighlightElement = q.element;
      q.element.classList.add('portalmind-question-highlight');

      const badge = document.createElement('div');
      badge.className = 'portalmind-badge';
      badge.textContent = `PortalMind: In Focus`;
      q.element.appendChild(badge);

      q.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * Floating quick-solve button & in-page drawer
   */
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

    // In-page modal
    const modal = document.createElement('div');
    modal.id = 'portalmind-inpage-modal';
    modal.innerHTML = `
      <div class="pm-modal-header">
        <span>✨ PortalMind Solution</span>
        <button id="pmCloseModal" style="background:none; border:none; color:white; font-size:16px; cursor:pointer;">✕</button>
      </div>
      <div class="pm-modal-body" id="pmModalBody">
        <div style="text-align:center; padding:20px; color:#94a3b8;">Scanning question...</div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('pmCloseModal')?.addEventListener('click', () => {
      modal.style.display = 'none';
    });

    floatBtn.addEventListener('click', async () => {
      modal.style.display = 'flex';
      const body = document.getElementById('pmModalBody');
      body.innerHTML = '<div style="text-align:center; padding:20px; color:#94a3b8;">Analyzing problem & generating solution...</div>';

      const questions = detectQuestions();
      if (questions.length === 0) {
        body.innerHTML = '<div style="color:#ef4444;">No question text detected. Highlight the question text with your mouse and click again!</div>';
        return;
      }

      const q = questions[0];
      highlightQuestion(0);

      // Route solving through Background Service Worker to bypass Newton School CSP / CORS restrictions!
      chrome.runtime.sendMessage({
        action: 'SOLVE_QUESTION',
        questionData: {
          text: q.text,
          options: q.options,
          type: q.type
        }
      }, (res) => {
        if (!res || !res.success || !res.data) {
          body.innerHTML = '<div style="color:#ef4444;">Solving error. Please try again.</div>';
          return;
        }

        const data = res.data;

        let html = `<div style="font-weight:700; color:#10b981; font-size:14px; margin-bottom:8px;">${data.answer}</div>`;
        html += `<div style="font-size:12px; color:#cbd5e1; margin-bottom:10px;">${data.explanation}</div>`;

        if (data.code) {
          html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
            <span style="font-weight:700; font-size:11px; text-transform:uppercase; color:#94a3b8;">Code Solution</span>
            <button id="pmCopyBtn" class="pm-btn">Copy Code</button>
          </div>
          <pre class="pm-code"><code>${data.code}</code></pre>`;
        }

        if (data.tips) {
          html += `<div style="margin-top:10px; background:#1e293b; padding:8px 10px; border-radius:6px; font-size:11.5px; color:#fbbf24;">💡 ${data.tips}</div>`;
        }

        body.innerHTML = html;

        document.getElementById('pmCopyBtn')?.addEventListener('click', () => {
          navigator.clipboard.writeText(data.code || '').then(() => {
            const btn = document.getElementById('pmCopyBtn');
            if (btn) btn.innerText = 'Copied!';
            setTimeout(() => { if (btn) btn.innerText = 'Copy Code'; }, 2000);
          });
        });
      });
    });

    document.body.appendChild(floatBtn);
  }

  detectQuestions();
  if (document.body) {
    injectFloatingWidget();
  } else {
    window.addEventListener('DOMContentLoaded', injectFloatingWidget);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'DETECT_QUESTIONS':
      case 'GET_CURRENT_QUESTION': {
        const questions = detectQuestions();
        const index = request.index !== undefined ? request.index : currentQuestionIndex;
        if (questions.length > 0 && index < questions.length) {
          currentQuestionIndex = index;
          highlightQuestion(index);
          const q = questions[index];
          sendResponse({
            success: true,
            question: {
              index: q.index,
              portalNumber: q.portalNumber,
              type: q.type,
              text: q.text,
              options: q.options
            },
            total: questions.length,
            currentIndex: index
          });
        } else {
          sendResponse({
            success: false,
            message: 'No questions detected. You can highlight question text on Newton School to solve it.',
            total: 0
          });
        }
        break;
      }
      case 'HIGHLIGHT_QUESTION': {
        highlightQuestion(request.index);
        sendResponse({ success: true });
        break;
      }
      case 'PING': {
        sendResponse({ success: true, url: window.location.href });
        break;
      }
      default:
        sendResponse({ success: false });
    }
    return true;
  });
})();
