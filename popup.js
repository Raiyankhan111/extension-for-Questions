/**
 * PortalMind - Popup Script
 * Handles UI events, communication with Content Script and Background AI Worker.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const settingsBtn = document.getElementById('settingsBtn');
  const questionCounter = document.getElementById('questionCounter');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const progressBar = document.getElementById('progressBar');
  const readQuestionBtn = document.getElementById('readQuestionBtn');
  const autoDetectToggleBtn = document.getElementById('autoDetectToggleBtn');
  const autoDetectLabel = document.getElementById('autoDetectLabel');

  const emptyState = document.getElementById('emptyState');
  const initialDetectBtn = document.getElementById('initialDetectBtn');
  const manualInputBtn = document.getElementById('manualInputBtn');
  const manualInputContainer = document.getElementById('manualInputContainer');
  const manualQuestionInput = document.getElementById('manualQuestionInput');
  const submitManualBtn = document.getElementById('submitManualBtn');
  const questionContainer = document.getElementById('questionContainer');
  const questionTypeBadge = document.getElementById('questionTypeBadge');
  const questionNumberBadge = document.getElementById('questionNumberBadge');
  const questionTextEl = document.getElementById('questionText');
  const optionsList = document.getElementById('optionsList');
  const generateActionRow = document.getElementById('generateActionRow');
  const generateBtn = document.getElementById('generateBtn');

  const loadingIndicator = document.getElementById('loadingIndicator');
  const solutionContainer = document.getElementById('solutionContainer');
  const cacheBadge = document.getElementById('cacheBadge');
  const answerContent = document.getElementById('answerContent');
  const explanationContent = document.getElementById('explanationContent');
  const codeSection = document.getElementById('codeSection');
  const codeContent = document.getElementById('codeContent');
  const copyCodeBtn = document.getElementById('copyCodeBtn');
  const tipSection = document.getElementById('tipSection');
  const tipContent = document.getElementById('tipContent');

  // Local state
  let currentTabId = null;
  let currentIndex = 0;
  let totalQuestions = 0;
  let currentQuestion = null;
  let autoDetectActive = true;
  const sessionSolutions = new Map(); // local cache for session

  // Set status helper
  function setStatus(state, label) {
    statusBadge.className = 'status-badge';
    if (state === 'busy') {
      statusBadge.classList.add('status-busy');
    } else {
      statusBadge.classList.add('status-idle');
    }
    statusText.textContent = label;
  }

  // Get active tab safely
  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  // Ensure content script is injected
  async function ensureContentScriptInjected(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { action: 'PING' });
      if (response && response.success) return true;
    } catch (e) {
      // Content script not ready; inject programmatically
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
        // Give small delay for initialization
        await new Promise(r => setTimeout(r, 100));
        return true;
      } catch (injectionError) {
        console.error('Cannot inject content script on this page:', injectionError);
        return false;
      }
    }
    return true;
  }

  // Update navigation controls & progress
  function updateNavUI() {
    if (totalQuestions <= 0) {
      questionCounter.textContent = '0 / 0';
      progressBar.style.width = '0%';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    const currentDisplayNum = currentIndex + 1;
    questionCounter.textContent = `${currentDisplayNum} / ${totalQuestions}`;
    const pct = Math.min(100, Math.round((currentDisplayNum / totalQuestions) * 100));
    progressBar.style.width = `${pct}%`;

    prevBtn.disabled = (currentIndex <= 0 && totalQuestions <= 1);
    nextBtn.disabled = (currentIndex >= totalQuestions - 1 && totalQuestions <= 1);
  }

  // Render question card
  function renderQuestion(q) {
    if (!q) return;
    currentQuestion = q;

    emptyState.style.display = 'none';
    questionContainer.style.display = 'block';
    generateActionRow.style.display = 'block';

    // Type badge
    questionTypeBadge.className = `type-badge badge-${q.type}`;
    questionTypeBadge.textContent = q.type.toUpperCase();

    // Question number
    questionNumberBadge.textContent = `Q${currentIndex + 1}`;

    // Question text
    questionTextEl.textContent = q.text;

    // Render Options if MCQ
    optionsList.innerHTML = '';
    if (q.options && q.options.length > 0) {
      optionsList.style.display = 'flex';
      q.options.forEach(opt => {
        const item = document.createElement('div');
        item.className = 'option-item';
        item.id = `opt-${opt.letter}`;
        item.innerHTML = `
          <span class="option-letter">${opt.letter}</span>
          <span class="option-text">${opt.text}</span>
        `;
        optionsList.appendChild(item);
      });
    } else {
      optionsList.style.display = 'none';
    }

    // Check if we already have an answer in session
    const cacheKey = `${q.text}##${currentIndex}`;
    if (sessionSolutions.has(cacheKey)) {
      renderSolution(sessionSolutions.get(cacheKey), true);
    } else {
      // Hide solution container until user clicks Generate
      solutionContainer.style.display = 'none';
    }

    updateNavUI();
    setStatus('idle', 'Question Ready');
  }

  // Render AI solution
  function renderSolution(solution, isCached = false) {
    loadingIndicator.style.display = 'none';
    solutionContainer.style.display = 'block';

    cacheBadge.style.display = isCached ? 'inline-block' : 'none';

    // Answer text
    answerContent.textContent = solution.answer;

    // Highlight correct option if MCQ
    if (solution.selectedOption && currentQuestion?.options) {
      const matchOpt = document.getElementById(`opt-${solution.selectedOption}`);
      if (matchOpt) {
        matchOpt.classList.add('highlight-correct');
      }
    }

    // Explanation
    explanationContent.textContent = solution.explanation || 'No explanation provided.';

    // Code
    if (solution.code) {
      codeSection.style.display = 'block';
      codeContent.querySelector('code').textContent = solution.code;
    } else {
      codeSection.style.display = 'none';
    }

    // Study Tip
    if (solution.tips) {
      tipSection.style.display = 'flex';
      tipContent.textContent = solution.tips;
    } else {
      tipSection.style.display = 'none';
    }

    setStatus('idle', 'Answered');
  }

  // Load question at index from active page
  async function loadQuestionAtIndex(index) {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return;
    currentTabId = tab.id;

    setStatus('busy', 'Scanning...');
    const injected = await ensureContentScriptInjected(tab.id);
    if (!injected) {
      setStatus('idle', 'Cannot Access Page');
      alert('PortalMind cannot run on this protected browser page. Please open a college portal or test page.');
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: 'GET_CURRENT_QUESTION', index }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        setStatus('idle', 'No Question Found');
        emptyState.style.display = 'flex';
        questionContainer.style.display = 'none';
        generateActionRow.style.display = 'none';
        solutionContainer.style.display = 'none';
        return;
      }

      currentIndex = response.currentIndex || 0;
      totalQuestions = response.total || 1;
      renderQuestion(response.question);
    });
  }

  // Generate Solution via Background Worker
  async function handleGenerateSolution() {
    if (!currentQuestion) return;

    setStatus('busy', 'Solving...');
    generateBtn.disabled = true;
    loadingIndicator.style.display = 'flex';
    solutionContainer.style.display = 'none';

    // Send to background service worker
    chrome.runtime.sendMessage({
      action: 'SOLVE_QUESTION',
      questionData: currentQuestion
    }, (response) => {
      generateBtn.disabled = false;
      loadingIndicator.style.display = 'none';

      if (chrome.runtime.lastError || !response || !response.success) {
        setStatus('idle', 'Generation Error');
        const err = response?.error || chrome.runtime.lastError?.message || 'Failed to solve question';
        alert(`AI Generation Failed: ${err}\n\nPlease check your API key in Settings (gear icon in the top right).`);
        return;
      }

      const cacheKey = `${currentQuestion.text}##${currentIndex}`;
      sessionSolutions.set(cacheKey, response.data);
      renderSolution(response.data, response.fromCache);
    });
  }

  // Event Listeners
  readQuestionBtn.addEventListener('click', () => loadQuestionAtIndex(currentIndex));
  initialDetectBtn.addEventListener('click', () => loadQuestionAtIndex(0));

  generateBtn.addEventListener('click', handleGenerateSolution);

  prevBtn.addEventListener('click', async () => {
    if (currentIndex > 0) {
      loadQuestionAtIndex(currentIndex - 1);
    } else {
      // Single-question view: trigger portal's previous button
      const tab = await getActiveTab();
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'NAVIGATE_PORTAL_PREV' }, (res) => {
          setTimeout(() => loadQuestionAtIndex(0), 500);
        });
      }
    }
  });

  nextBtn.addEventListener('click', async () => {
    if (currentIndex < totalQuestions - 1) {
      loadQuestionAtIndex(currentIndex + 1);
    } else {
      // Single-question view: trigger portal's next button
      const tab = await getActiveTab();
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'NAVIGATE_PORTAL_NEXT' }, (res) => {
          setTimeout(() => loadQuestionAtIndex(0), 500);
        });
      }
    }
  });

  autoDetectToggleBtn.addEventListener('click', () => {
    autoDetectActive = !autoDetectActive;
    if (autoDetectActive) {
      autoDetectToggleBtn.classList.add('active');
      autoDetectLabel.textContent = 'Auto: ON';
    } else {
      autoDetectToggleBtn.classList.remove('active');
      autoDetectLabel.textContent = 'Auto: OFF';
    }
  });

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  copyCodeBtn.addEventListener('click', () => {
    const code = codeContent.querySelector('code')?.textContent || '';
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        copyCodeBtn.textContent = 'Copied!';
        setTimeout(() => { copyCodeBtn.textContent = 'Copy'; }, 2000);
      });
    }
  });

  manualInputBtn?.addEventListener('click', () => {
    const isHidden = manualInputContainer.style.display === 'none';
    manualInputContainer.style.display = isHidden ? 'block' : 'none';
    if (isHidden) manualQuestionInput.focus();
  });

  submitManualBtn?.addEventListener('click', () => {
    const text = (manualQuestionInput.value || '').trim();
    if (!text) {
      alert('Please paste or type your question first.');
      return;
    }
    const qObj = {
      index: 0,
      portalNumber: 1,
      type: text.toLowerCase().includes('def ') || text.toLowerCase().includes('function') ? 'coding' : 'theory',
      text: text,
      options: []
    };
    currentIndex = 0;
    totalQuestions = 1;
    renderQuestion(qObj);
    handleGenerateSolution();
  });

  // Initial scan on popup launch
  loadQuestionAtIndex(0);
});
