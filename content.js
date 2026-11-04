/**
 * PortalMind - Content Script
 * Robust question extractor and navigator for college portals & LMS platforms.
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

  // Custom styling for active question highlight on page
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
    const hasCodeBlock = container.querySelector('pre, code, .monaco-editor, .ace_editor, textarea.code');
    const codingKeywords = ['write a function', 'return the', 'def ', 'public class', 'function ', 'time complexity', 'space complexity', 'input format', 'output format', 'constraints:'];
    const isCodingMatch = codingKeywords.some(kw => text.includes(kw));

    if (hasCodeBlock || isCodingMatch) {
      return 'coding';
    }

    if (options && options.length >= 2) {
      return 'mcq';
    }

    // Check if open answer textarea / text input exists
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
          const keyLetter = String.fromCharCode(65 + idx); // A, B, C, D...
          options.push({
            letter: keyLetter,
            text: cleaned.replace(/^[A-Da-d][\.\)\:\-]\s*/, '') // remove existing leading A. if present
          });
        }
      });
      if (options.length >= 2) return options;
    }

    // Approach 2: List items (ul/ol) or specific portal classes (.answer, .option, .choice, etc.)
    const optionElements = container.querySelectorAll(
      '.answer div, .answer li, .option, .choice, .quiz-option, .form-check, [role="radio"], [role="checkbox"], ul.options li, ol.options li'
    );
    if (optionElements.length >= 2) {
      optionElements.forEach((el, idx) => {
        const text = cleanText(el.innerText);
        if (text && text.length > 0) {
          const keyLetter = String.fromCharCode(65 + idx);
          options.push({
            letter: keyLetter,
            text: text.replace(/^[A-Da-d][\.\)\:\-]\s*/, '')
          });
        }
      });
      if (options.length >= 2) return options;
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
    // Clone container to avoid modifying DOM
    const clone = container.cloneNode(true);

    // Remove buttons, inputs, scripts, SVGs, styles
    const removeSelectors = [
      'button', 'script', 'style', 'svg', 'input',
      '.portalmind-badge', '.badge', '.nav', '.footer',
      '.feedback', '.grading-summary'
    ];
    removeSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Check for specific question body selectors in popular LMS
    const lmsQuestionTextSelectors = [
      '.qtext',                  // Moodle
      '.question_text',          // Canvas
      '.vtbegenerated',          // Blackboard
      '[data-params*="question"]', // Google forms
      '.problem-description',    // Coding portals
      '.question-prompt',
      '.prompt',
      '.question-statement'
    ];

    for (const sel of lmsQuestionTextSelectors) {
      const match = container.querySelector(sel);
      if (match && cleanText(match.innerText).length > 10) {
        return cleanText(match.innerText);
      }
    }

    let text = cleanText(clone.innerText);

    // Remove extracted option texts from the main question text to keep it concise
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

    // Multi-platform container selectors
    const containerSelectors = [
      '.que',                              // Moodle
      '.display_question',                 // Canvas
      '.question_holder',                  // Canvas alternate
      '.takeQuestionDiv',                  // Blackboard
      '[role="listitem"]',                 // Google Forms
      '.d2l-quiz-question',                // D2L
      '.quiz-item',
      '.question-card',
      '.question-container',
      '.problem-statement',               // HackerRank/Codeforces
      '[data-question-id]',
      'fieldset[class*="question"]',
      'div[class*="question-box"]'
    ];

    let foundContainers = [];
    for (const sel of containerSelectors) {
      const elements = Array.from(document.querySelectorAll(sel));
      if (elements.length > 0) {
        foundContainers = elements;
        break;
      }
    }

    // Fallback: If no recognized structure found, search for fieldsets, form groups, or active article/main
    if (foundContainers.length === 0) {
      const generalContainers = Array.from(document.querySelectorAll('fieldset, form .form-group, .card, article'));
      foundContainers = generalContainers.filter(el => {
        const text = el.innerText || '';
        return text.length > 30 && (text.includes('?') || el.querySelectorAll('input[type="radio"]').length >= 2);
      });
    }

    // Ultimate Fallback: Single question view (entire main body or active wrapper)
    if (foundContainers.length === 0) {
      const main = document.querySelector('main, #content, .content, .container, [role="main"]');
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
    // Remove previous highlight
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
   * Attempt to find and safely click portal's "Next" button
   */
  function navigateNext() {
    const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'));
    const nextBtn = buttons.find(b => {
      const text = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
      const isDangerous = isSubmissionButton(text);
      if (isDangerous) return false;

      const lower = text.toLowerCase();
      return (
        lower === 'next' ||
        lower.startsWith('next ') ||
        lower.includes('next question') ||
        lower === 'forward' ||
        lower === '>' ||
        lower === '»'
      );
    });

    if (nextBtn) {
      nextBtn.click();
      return { success: true, message: 'Navigated to next question.' };
    }
    return { success: false, message: 'Portal Next button not found or it is an exam submit button.' };
  }

  /**
   * Attempt to find and safely click portal's "Previous" button
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
        lower.includes('previous question') ||
        lower === '<' ||
        lower === '«'
      );
    });

    if (prevBtn) {
      prevBtn.click();
      return { success: true, message: 'Navigated to previous question.' };
    }
    return { success: false, message: 'Portal Previous button not found.' };
  }

  /**
   * Fallback: Extract selected text on page if student selected a question manually
   */
  function getSelectedTextQuestion() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const raw = selection.toString().trim();
    if (raw.length < 10) return null;

    // Check if selection contains options
    const options = [];
    const regex = /(?:^|\n)\s*([A-D])[\.\)\:\-]\s+([^\n]+)/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      options.push({
        letter: match[1].toUpperCase(),
        text: cleanText(match[2])
      });
    }

    let qText = raw;
    options.forEach(opt => {
      qText = qText.replace(opt.text, '');
    });

    return {
      index: 0,
      portalNumber: 1,
      type: options.length >= 2 ? 'mcq' : 'theory',
      text: cleanText(qText),
      options,
      isSelection: true
    };
  }

  // Observe dynamic question transitions in Single Page Applications
  function setupMutationObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      // Re-scan when DOM changes significantly
      detectQuestions();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initial detection
  detectQuestions();
  setupMutationObserver();

  // Listen for messages from popup or background service worker
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
        // First check if user highlighted text
        const selectionQ = getSelectedTextQuestion();
        if (selectionQ) {
          sendResponse({
            success: true,
            question: selectionQ,
            total: 1,
            currentIndex: 0,
            isUserSelection: true
          });
          return true;
        }

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
            message: 'No questions detected on this webpage. You can highlight text on the page to solve it manually.',
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
    return true; // Keep message channel open for async response
  });
})();
