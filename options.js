/**
 * PortalMind - Options / Settings Script
 */

document.addEventListener('DOMContentLoaded', async () => {
  const modeBackend = document.getElementById('modeBackend');
  const modeDirect = document.getElementById('modeDirect');
  const backendSection = document.getElementById('backendSection');
  const geminiSection = document.getElementById('geminiSection');
  const backendUrlInput = document.getElementById('backendUrl');
  const geminiApiKeyInput = document.getElementById('geminiApiKey');
  const geminiModelSelect = document.getElementById('geminiModel');
  const explanationLevelSelect = document.getElementById('explanationLevel');
  const testBtn = document.getElementById('testBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const saveBtn = document.getElementById('saveBtn');
  const statusMsg = document.getElementById('statusMsg');

  let currentMode = 'backend';

  function setMode(mode) {
    currentMode = mode;
    if (mode === 'backend') {
      modeBackend.classList.add('active');
      modeDirect.classList.remove('active');
      backendSection.style.display = 'flex';
      geminiSection.style.display = 'none';
    } else {
      modeDirect.classList.add('active');
      modeBackend.classList.remove('active');
      backendSection.style.display = 'none';
      geminiSection.style.display = 'flex';
    }
  }

  function showStatus(text, type = 'success') {
    statusMsg.className = `status-msg ${type}`;
    statusMsg.textContent = text;
    setTimeout(() => {
      statusMsg.style.display = 'none';
    }, 4500);
  }

  // Load existing settings
  const config = await chrome.storage.sync.get({
    apiMode: 'backend',
    backendUrl: 'http://localhost:3001/api/solve',
    geminiApiKey: '',
    geminiModel: 'gemini-1.5-flash',
    explanationLevel: 'detailed'
  });

  setMode(config.apiMode);
  backendUrlInput.value = config.backendUrl;
  geminiApiKeyInput.value = config.geminiApiKey;
  geminiModelSelect.value = config.geminiModel;
  explanationLevelSelect.value = config.explanationLevel;

  // Toggle mode
  modeBackend.addEventListener('click', () => setMode('backend'));
  modeDirect.addEventListener('click', () => setMode('direct'));

  // Save Settings
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const newConfig = {
      apiMode: currentMode,
      backendUrl: backendUrlInput.value.trim() || 'http://localhost:3001/api/solve',
      geminiApiKey: geminiApiKeyInput.value.trim(),
      geminiModel: geminiModelSelect.value,
      explanationLevel: explanationLevelSelect.value
    };

    await chrome.storage.sync.set(newConfig);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Settings';
    showStatus('Settings saved successfully!', 'success');
  });

  // Test Connection
  testBtn.addEventListener('click', () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';

    // Save first to ensure background worker uses latest values
    chrome.storage.sync.set({
      apiMode: currentMode,
      backendUrl: backendUrlInput.value.trim() || 'http://localhost:3001/api/solve',
      geminiApiKey: geminiApiKeyInput.value.trim(),
      geminiModel: geminiModelSelect.value,
      explanationLevel: explanationLevelSelect.value
    }, () => {
      chrome.runtime.sendMessage({ action: 'TEST_CONNECTION' }, (response) => {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Connection';

        if (response && response.success) {
          showStatus(`Connection Successful! Verified test answer: ${response.answer}`, 'success');
        } else {
          showStatus(`Connection Failed: ${response?.error || 'Could not connect to AI service'}`, 'error');
        }
      });
    });
  });

  // Clear Session Cache
  clearCacheBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'CLEAR_CACHE' }, (response) => {
      showStatus('Question solution cache cleared.', 'success');
    });
  });
});
