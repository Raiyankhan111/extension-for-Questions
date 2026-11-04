/**
 * PortalMind - Content Script
 * Robust question extractor and navigator for college portals & LMS platforms (Newton School, Canvas, Moodle, etc.).
 * Safe by design: NEVER clicks submit or bypasses portal integrity.
 */

(() => {
  // Prevent duplicate script injection
  if (window.__PORTALMIND_LOADED__) return;
  window.__PORTALMIND_LOADED__ = true;

  // State
  let cachedQuestions = [];
  let currentQuestionIndex = 0;
  let observer = null;
  let activeHighlightElement = null;

  // Custom styling for active question highlight and in-page solver widget
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
      top: -12px !important;
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
      padding: 10px 18px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    #portalmind-floating-btn:hover {
      transform: translateY(-2px) scale(1.02);
      box-shadow: 0 6px 24px rgba(99, 102, 241, 0.6);
    }

    /* Floating in-page answer drawer */
    #portalmind-floating-card {
      position: fixed;
      bottom: 76px;
      right: 24px;
      width: 380px;
      max-height: 520px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 12px 36px rgba(0,0,0,0.2);
      border: 1px solid #e2e8f0;
      z-index: 999999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: pmSlideUp 0.25s ease-out;
    }
    @keyframes pmSlideUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head?.appendChild(styleEl);

  /**
   * Cleans text content by stripping extra spaces, script/style content.
   */
  function cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
  }

  /**
   * Helper to check if button text contains dangerous submission words
   */
  function isSubmissionButton(text) {
    const dangerWords = [
      'submit', 'finish', 'end test', 'end exam', 'turn in',
      'grade', 'complete quiz', 'submit all', 'confirm finish'
    ];
    const lower = (text || '').toLowerCase();
    return dangerWords.some(w => lower.includes(w));
  }

  /**
   * Detect question type: MCQ, Coding, or Theory
   */
  function determineQuestionType(container, options) {
    const text = (container.innerText || '').toLowerCase();
    const hasCodeBlock = container.querySelector('pre, code, .monaco-editor, .ace_editor, textarea.code, [class*="editor"]');
    const codingKeywords = [
      'write a function', 'return the', 'def ', 'public class', 'function ',
      'time complexity', 'space complexity', 'input format', 'output format',
      'constraints:', 'sample input', 'sample output', 'newton school'
    ];
    const isCodingMatch = codingKeywords.some(kw => text.includes(kw));

    if (hasCodeBlock || isCodingMatch) {
      return 'coding';
    }

    if (options && options.length >= 2) {
      return 'mcq';
    }

    const hasInput = container.querySelector('textarea, input[type="text"]');
    if (hasInput || text.includes('explain') || text.includes('describe') || text.includes('what is') || text.includes('discuss')) {
      return 'theory';
    }

    return options.length > 0 ? 'mcq' : 'theory';
  }

  /**
   * Extract options from an MCQ container
   */
  function extractOptions(container) {
    const options = [];

    // Approach 1: Radio/Checkbox inputs with associated labels
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
          const keyLetter = String.fromCharCode(65 + idx);
          options.push({
            letter: keyLetter,
            text: cleaned.replace(/^[A-Da-d][\.\)\:\-]\s*/, '')
          });
        }
      });
      if (options.length >= 2) return options;
    }

    // Approach 2: Newton School, Canvas, and standard LMS option cards
    const optionElements = container.querySelectorAll(
      '[class*="option"], [class*="Option"], [class*="choice"], .answer div, .answer li, .quiz-option, .form-check, [role="radio"], [role="checkbox"], ul.options li, ol.options li'
    );
    if (optionElements.length >= 2) {
      const uniqueTexts = new Set();
      optionElements.forEach((el) => {
        const text = cleanText(el.innerText);
        if (text && text.length > 0 && text.length < 200 && !uniqueTexts.has(text)) {
          uniqueTexts.add(text);
          const keyLetter = String.fromCharCode(65 + options.length);
          options.push({
            letter: keyLetter,
            text: text.replace(/^[A-Da-d][\.\)\:\-]\s*/, '')
          });
        }
      });
      if (options.length >= 2 && options.length <= 6) return options;
    }

    // Approach 3: Regex match A), B), C), D) in plain text
    const fullText = container.innerText || '';
    const regex = /(?:^|\n)\s*([A-D])[\.\)\:\-]\s+([^\n]+)/g;
    let match;
    while ((match = regex.exec(fullText)) !== null) {
      options.push({
        letter: match[1].toUpperCase(),
        text: cleanText(match[2])
      });
    }

    return options;
  }

  /**
   * Extract question text without options text and UI noise
   */
  function extractQuestionText(container, options) {
    const clone = container.cloneNode(true);

    const removeSelectors = [
      'button', 'script', 'style', 'svg', 'input',
      '.portalmind-badge', '.badge', '.nav', '.footer',
      '.feedback', '.grading-summary', '#portalmind-floating-btn', '#portalmind-floating-card'
    ];
    removeSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Targeted LMS & Newton School problem statement selectors
    const lmsQuestionTextSelectors = [
      '[class*="problem-statement"]',
      '[class*="ProblemStatement"]',
      '[class*="question-statement"]',
      '[class*="question_description"]',
      '[class*="problem-description"]',
      '[class*="questionBody"]',
      '[class*="QuestionCard"]',
      '.qtext',                  // Moodle
      '.question_text',          // Canvas
      '.vtbegenerated',          // Blackboard
      '[data-params*="question"]'
    ];

    for (const sel of lmsQuestionTextSelectors) {
      const match = container.querySelector(sel);
      if (match && cleanText(match.innerText).length > 10) {
        return cleanText(match.innerText);
      }
    }

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
   * Scans document for all questions
   */
  function detectQuestions() {
    const list = [];
    const seenTexts = new Set();

    // Multi-platform container selectors (Newton School, Canvas, Moodle, HackerRank, etc.)
    const containerSelectors = [
      '[class*="ProblemStatement"]',
      '[class*="question-container"]',
      '[class*="problem-statement"]',
      '[class*="questionCard"]',
      '[class*="QuestionCard"]',
      '[class*="question-card"]',
      '[class*="quiz-item"]',
      '.que',
      '.display_question',
      '.question_holder',
      '.takeQuestionDiv',
      '[role="listitem"]',
      '.d2l-quiz-question',
      '[data-question-id]',
      'fieldset[class*="question"]'
    ];

    let foundContainers = [];
    for (const sel of containerSelectors) {
      const elements = Array.from(document.querySelectorAll(sel));
      if (elements.length > 0) {
        foundContainers = elements;
        break;
      }
    }

    // Fallback: search for fieldsets or cards containing questions
    if (foundContainers.length === 0) {
      const generalContainers = Array.from(document.querySelectorAll('fieldset, form .form-group, .card, article, [class*="problem"], [class*="contest"]'));
      foundContainers = generalContainers.filter(el => {
        const text = el.innerText || '';
        return text.length > 30 && (text.includes('?') || el.querySelectorAll('input[type="radio"]').length >= 2);
      });
    }

    // Single question full page fallback (Newton School active problem view)
    if (foundContainers.length === 0) {
      const main = document.querySelector('main, #content, .content, .container, [role="main"], [class*="problemView"], [class*="assessment"]');
      if (main && (main.innerText || '').length > 20) {
        foundContainers = [main];
      }
    }

    foundContainers.forEach((container, idx) => {
      const options = extractOptions(container);
      const questionText = extractQuestionText(container, options);

      if (questionText && questionText.length > 5) {
        const hash = questionText.substring(0, 100);
        if (!seenTexts.has(hash)) {
          seenTexts.add(hash);
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

  /**
   * Highlight the active question on the student's webpage
   */
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
      badge.textContent = `PortalMind: Q${index + 1}`;
      q.element.appendChild(badge);

      q.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  /**
   * Navigate Next safely on portal
   */
  function navigateNext() {
    const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
    const nextBtn = buttons.find(b => {
      const text = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
      if (isSubmissionButton(text)) return false;

      const lower = text.toLowerCase();
      return (
        lower === 'next' ||
        lower.startsWith('next ') ||
        lower.includes('next question') ||
        lower.includes('next problem') ||
        lower === 'forward' ||
        lower === '>' ||
        lower === '»'
      );
    });

    if (nextBtn) {
      nextBtn.click();
      return { success: true, message: 'Navigated to next question.' };
    }
    return { success: false, message: 'Next question button not found.' };
  }

  /**
   * Navigate Prev safely on portal
   */
  function navigatePrev() {
    const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"]'));
    const prevBtn = buttons.find(b => {
      const text = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
      if (isSubmissionButton(text)) return false;

      const lower = text.toLowerCase();
      return (
        lower === 'previous' ||
        lower === 'prev' ||
        lower.startsWith('prev ') ||
        lower.includes('prev question') ||
        lower.includes('previous problem') ||
        lower === '<' ||
        lower === '«'
      );
    });

    if (prevBtn) {
      prevBtn.click();
      return { success: true, message: 'Navigated to previous question.' };
    }
    return { success: false, message: 'Previous question button not found.' };
  }

  /**
   * Create Floating In-Page Widget for quick solving right on Newton School / College Portal
   */
  function injectFloatingWidget() {
    if (document.getElementById('portalmind-floating-btn')) return;

    const floatBtn = document.createElement('button');
    floatBtn.id = 'portalmind-floating-btn';
    floatBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
      <span>Solve Question</span>
    `;

    floatBtn.addEventListener('click', () => {
      // Trigger extension popup or quick solve notification
      chrome.runtime.sendMessage({
        action: 'SOLVE_CURRENT_ACTIVE'
      });
      // Detect and highlight
      const qs = detectQuestions();
      if (qs.length > 0) {
        highlightQuestion(0);
      }
    });

    document.body.appendChild(floatBtn);
  }

  // Observe dynamic question transitions in SPAs (like Newton School)
  function setupMutationObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      detectQuestions();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initial detection & setup
  detectQuestions();
  setupMutationObserver();
  if (document.body) {
    injectFloatingWidget();
  } else {
    window.addEventListener('DOMContentLoaded', injectFloatingWidget);
  }

  // Runtime messaging
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'DETECT_QUESTIONS': {
        const questions = detectQuestions();
        sendResponse({
          success: true,
          total: questions.length,
          questions: questions.map(q => ({
            index: q.index,
            portalNumber: q.portalNumber,
            type: q.type,
            text: q.text,
            options: q.options
          }))
        });
        break;
      }

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
            message: 'No questions detected on this webpage. You can highlight question text on Newton School to solve it.',
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

      case 'NAVIGATE_PORTAL_NEXT': {
        const res = navigateNext();
        sendResponse(res);
        break;
      }

      case 'NAVIGATE_PORTAL_PREV': {
        const res = navigatePrev();
        sendResponse(res);
        break;
      }

      case 'PING': {
        sendResponse({ success: true, url: window.location.href, title: document.title });
        break;
      }

      default:
        sendResponse({ success: false, message: 'Unknown action' });
    }
    return true;
  });
})();
