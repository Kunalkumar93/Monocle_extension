// OmniAI Side Panel Core Controller
document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const engineTabs = document.querySelectorAll('.tab-btn');
  const viewFastAi = document.getElementById('view-fast-ai');
  const viewWebApp = document.getElementById('view-web-app');
  const webIframe = document.getElementById('web-iframe');
  const webAppStatus = document.getElementById('web-app-status');
  const currentEngineBadge = document.getElementById('current-engine-badge');

  // Context bar elements
  const contextBar = document.getElementById('context-bar');
  const contextSnippet = document.getElementById('context-snippet');
  const btnDismissContext = document.getElementById('btn-dismiss-context');
  const btnCopyContext = document.getElementById('btn-copy-context');
  const chipButtons = document.querySelectorAll('.chip-btn[data-prompt]');
  const btnPasteToWeb = document.getElementById('btn-paste-to-web');

  // Page Intelligence Elements
  const pageTitleDisplay = document.getElementById('page-title-display');
  const pageReadTime = document.getElementById('page-read-time');
  const btnTldrPage = document.getElementById('btn-tldr-page');
  const btnDeepSummary = document.getElementById('btn-deep-summary');
  const btnChatPageMode = document.getElementById('btn-chat-page-mode');
  let currentPageData = null;

  // Chat elements
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');

  // Header action elements
  const btnPopout = document.getElementById('btn-popout');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnSettings = document.getElementById('btn-settings');
  const btnOpenExternal = document.getElementById('btn-open-external');

  // Settings modal elements
  const settingsModal = document.getElementById('settings-modal');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const inputGeminiKey = document.getElementById('input-gemini-key');
  const inputCustomUrl = document.getElementById('input-custom-url');
  const selectDefaultEngine = document.getElementById('select-default-engine');
  const selectGeminiModel = document.getElementById('select-gemini-model');
  const btnToggleKey = document.getElementById('btn-toggle-key-visibility');
  const btnTestKey = document.getElementById('btn-test-key');
  const geminiKeyStatus = document.getElementById('gemini-key-status');
  const sideToast = document.getElementById('side-toast');

  // App URLs configuration
  const APP_URLS = {
    'chatgpt': 'https://chatgpt.com',
    'claude': 'https://claude.ai',
    'gemini': 'https://gemini.google.com/app',
    'perplexity': 'https://www.perplexity.ai',
    'custom': 'http://localhost:3000'
  };

  const ENGINE_NAMES = {
    'fast-ai': 'Fast Free AI',
    'chatgpt': 'ChatGPT (Web)',
    'claude': 'Claude (Web)',
    'gemini': 'Gemini (Web)',
    'perplexity': 'Perplexity (Web)',
    'custom': 'Custom App'
  };

  let activeEngine = 'fast-ai';
  let currentContextText = '';

  // 1. Load User Settings & Initial State
  const storage = await chrome.storage.local.get([
    'geminiApiKey',
    'geminiModel',
    'geminiWebUrl',
    'customEndpoint',
    'defaultEngine',
    'lastEngine',
    'currentContext'
  ]);

  if (storage.geminiApiKey) inputGeminiKey.value = storage.geminiApiKey;
  if (storage.geminiModel && selectGeminiModel) selectGeminiModel.value = storage.geminiModel;
  if (storage.geminiWebUrl) APP_URLS.gemini = storage.geminiWebUrl;
  if (storage.customEndpoint) {
    inputCustomUrl.value = storage.customEndpoint;
    APP_URLS.custom = storage.customEndpoint;
  }
  if (storage.defaultEngine) selectDefaultEngine.value = storage.defaultEngine;

  // Set initial engine
  const initialEngine = storage.lastEngine || storage.defaultEngine || 'fast-ai';
  switchEngine(initialEngine);

  // Check if context text is available
  if (storage.currentContext && storage.currentContext.text) {
    updateContextDisplay(storage.currentContext.text);
  }

  // 2. Tab Switching Logic
  engineTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const engine = tab.getAttribute('data-engine');
      switchEngine(engine);
    });
  });

  function switchEngine(engine) {
    activeEngine = engine;
    chrome.storage.local.set({ lastEngine: engine });

    // Update Tab UI
    engineTabs.forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-engine') === engine);
    });

    // Update Badge
    currentEngineBadge.textContent = ENGINE_NAMES[engine] || 'AI';

    if (engine === 'fast-ai') {
      viewFastAi.classList.add('active');
      viewWebApp.classList.remove('active');
    } else {
      viewFastAi.classList.remove('active');
      viewWebApp.classList.add('active');

      const url = APP_URLS[engine] || APP_URLS.custom;
      webAppStatus.textContent = `Active: ${ENGINE_NAMES[engine]}`;
      btnOpenExternal.href = url;

      if (webIframe.src !== url) {
        webIframe.src = url;
      }
    }
  }

  // 3. Context Bar Handling
  function updateContextDisplay(text) {
    currentContextText = text ? text.trim() : '';
    if (currentContextText) {
      contextSnippet.textContent = `"${currentContextText.slice(0, 180)}${currentContextText.length > 180 ? '...' : ''}"`;
      contextSnippet.style.color = '#e0e7ff';
      contextSnippet.style.borderLeftColor = '#6366f1';
      contextBar.classList.add('has-selection');
      contextBar.style.display = 'flex';
    } else {
      contextSnippet.textContent = 'No text selected yet. Highlight any text in your article!';
      contextSnippet.style.color = '#9ca3af';
      contextSnippet.style.borderLeftColor = 'rgba(255,255,255,0.2)';
      contextBar.classList.remove('has-selection');
      contextBar.style.display = 'flex';
    }
  }

  // Proactive sync with current active tab
  async function syncWithActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      // 1. Sync highlighted selection
      chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' }, (res) => {
        if (!chrome.runtime.lastError && res && res.text) {
          updateContextDisplay(res.text);
          return;
        }

        // Direct script fallback if content script hasn't reported
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.getSelection() ? window.getSelection().toString().trim() : ''
          }).then((results) => {
            if (results && results[0] && results[0].result) {
              updateContextDisplay(results[0].result);
            }
          }).catch(() => {});
        }
      });

      // 2. Sync full page intelligence
      chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' }, (res) => {
        if (!chrome.runtime.lastError && res && res.success && res.data) {
          currentPageData = res.data;
          updatePageIntelUI(res.data);
          return;
        }

        // Fallback for page content extraction
        if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const article = document.querySelector('article') || document.querySelector('main') || document.body;
              const text = (article.innerText || '').replace(/\s+/g, ' ').trim();
              const words = text ? text.split(/\s+/).filter(Boolean) : [];
              return {
                title: document.title || 'Current Webpage',
                url: window.location.href,
                wordCount: words.length,
                readingTime: Math.max(1, Math.ceil(words.length / 220)),
                text: text.slice(0, 60000)
              };
            }
          }).then((results) => {
            if (results && results[0] && results[0].result) {
              currentPageData = results[0].result;
              updatePageIntelUI(currentPageData);
            }
          }).catch(() => {});
        }
      });
    } catch (e) {
      console.warn('Sync with active tab notice:', e);
    }
  }

  function updatePageIntelUI(data) {
    if (!data) return;
    const shortTitle = data.title.length > 25 ? data.title.slice(0, 24) + '...' : data.title;
    pageTitleDisplay.textContent = `📄 ${shortTitle}`;
    pageTitleDisplay.title = data.title;
    pageReadTime.textContent = `📖 ~${data.readingTime} min (${data.wordCount} words)`;
    pageReadTime.style.display = 'inline-block';
  }

  // Trigger immediate tab sync on sidepanel open and focus
  syncWithActiveTab();
  window.addEventListener('focus', syncWithActiveTab);
  chrome.tabs.onActivated.addListener(syncWithActiveTab);

  // 30-Second Page TL;DR
  btnTldrPage.addEventListener('click', async () => {
    if (!currentPageData || !currentPageData.text) {
      await syncWithActiveTab();
    }
    if (!currentPageData || !currentPageData.text) {
      showToast('Could not extract page text from this tab.');
      return;
    }

    const prompt = `Please provide a 30-Second Executive Summary of this article ("${currentPageData.title}").\n\nStructure your response as:\n### ⚡ 30-Second TL;DR\n2 to 3 concise, high-impact sentences capturing the core thesis.\n\n### 🎯 Key Takeaways\n• 3 to 4 crisp bullet points highlighting the most crucial conclusions.\n\nArticle Text:\n"""\n${currentPageData.text}\n"""`;

    if (activeEngine === 'fast-ai') {
      sendMessage(prompt, true, `⚡ Executive 30s TL;DR of: "${currentPageData.title}"`);
    } else {
      navigator.clipboard.writeText(prompt).then(() => {
        showToast('30s TL;DR prompt copied! Press Ctrl+V in the chat.');
      });
    }
  });

  // Deep Outline & Key Points
  btnDeepSummary.addEventListener('click', async () => {
    if (!currentPageData || !currentPageData.text) {
      await syncWithActiveTab();
    }
    if (!currentPageData || !currentPageData.text) {
      showToast('Could not extract page text from this tab.');
      return;
    }

    const prompt = `Please provide a structured, in-depth outline of this article ("${currentPageData.title}") with sections, key arguments, and takeaways:\n\nArticle Text:\n"""\n${currentPageData.text}\n"""`;

    if (activeEngine === 'fast-ai') {
      sendMessage(prompt, true, `📑 Outline & Key Points of: "${currentPageData.title}"`);
    } else {
      navigator.clipboard.writeText(prompt).then(() => {
        showToast('Outline prompt copied! Press Ctrl+V in the chat.');
      });
    }
  });

  // Chat with Entire Webpage Mode
  btnChatPageMode.addEventListener('click', async () => {
    if (!currentPageData || !currentPageData.text) {
      await syncWithActiveTab();
    }
    if (!currentPageData || !currentPageData.text) {
      showToast('Could not extract page text from this tab.');
      return;
    }

    currentContextText = currentPageData.text;
    updateContextDisplay(`[Whole Webpage Context] ${currentPageData.title} (~${currentPageData.wordCount} words)`);
    chatInput.placeholder = `Ask anything about this entire page...`;
    chatInput.focus();
    showToast('💬 Whole Page Chat mode activated!');
  });

  btnDismissContext.addEventListener('click', () => {
    updateContextDisplay('');
    chrome.storage.local.remove('currentContext');
  });

  btnCopyContext.addEventListener('click', () => {
    if (!currentContextText) return;
    navigator.clipboard.writeText(currentContextText).then(() => {
      showToast('Context copied to clipboard!');
    });
  });

  btnPasteToWeb.addEventListener('click', () => {
    if (!currentContextText) return;
    navigator.clipboard.writeText(currentContextText).then(() => {
      showToast('Copied! Press Ctrl+V in the chat box.');
    });
  });

  // Prompt Chips Click
  chipButtons.forEach((chip) => {
    chip.addEventListener('click', () => {
      const promptPrefix = chip.getAttribute('data-prompt');
      const formatted = `${promptPrefix}\n\n"${currentContextText}"`;

      if (activeEngine === 'fast-ai') {
        sendMessage(formatted);
      } else {
        navigator.clipboard.writeText(formatted).then(() => {
          showToast('Prompt copied! Press Ctrl+V in the chat window.');
        });
      }
    });
  });

  // 4. Native Fast AI Chat Logic
  chatSendBtn.addEventListener('click', () => {
    const text = chatInput.value.trim();
    if (text) {
      chatInput.value = '';
      sendMessage(text);
    }
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (text) {
        chatInput.value = '';
        sendMessage(text);
      }
    }
  });

  function appendMessage(sender, content, isHtml = false) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${sender}-message`;

    const avatar = sender === 'user' ? '👤' : '✨';
    msgEl.innerHTML = `
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-content">${isHtml ? content : renderMarkdown(content)}</div>
    `;

    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgEl;
  }

  async function sendMessage(promptText, isPageSummary = false, displaySnippet = null) {
    appendMessage('user', displaySnippet || (isPageSummary ? '⚡ Please generate an Executive 30-Second TL;DR of this page.' : promptText));

    // Placeholder bot message
    const botMsg = appendMessage('bot', '<span class="omni-spinner"></span>Reading and analyzing...', true);

    try {
      chrome.runtime.sendMessage(
        {
          type: 'FETCH_GEMINI_EXPLANATION',
          prompt: promptText,
          text: currentContextText
        },
        (res) => {
          if (res && res.success) {
            botMsg.querySelector('.msg-content').innerHTML = renderMarkdown(res.text);
          } else {
            botMsg.querySelector('.msg-content').innerHTML = `
              <p style="color: #f87171;">⚠️ ${(res && res.error) || 'Failed to fetch response'}</p>
              <p style="font-size: 11.5px; margin-top: 4px; color: #9ca3af;">
                Check your free API key in <strong>⚙️ Settings</strong>.
              </p>
            `;
          }
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      );
    } catch (e) {
      botMsg.querySelector('.msg-content').innerHTML = `<p style="color: #f87171;">⚠️ Error: ${e.message}</p>`;
    }
  }

  // 5. Header Actions
  btnPopout.addEventListener('click', () => {
    const url = APP_URLS[activeEngine] || 'https://google.com';
    chrome.tabs.create({ url });
  });

  btnRefresh.addEventListener('click', () => {
    if (activeEngine === 'fast-ai') {
      chatMessages.innerHTML = `
        <div class="message system-message">
          <div class="msg-avatar">✨</div>
          <div class="msg-content">
            <strong>Chat reset!</strong>
            <p>Highlight text in any tab to ask questions or summarize.</p>
          </div>
        </div>
      `;
    } else {
      webIframe.src = webIframe.src;
    }
  });

  // 6. Settings Modal
  btnSettings.addEventListener('click', () => {
    settingsModal.classList.add('active');
  });

  btnCloseSettings.addEventListener('click', () => {
    settingsModal.classList.remove('active');
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.remove('active');
    }
  });

  btnToggleKey.addEventListener('click', () => {
    inputGeminiKey.type = inputGeminiKey.type === 'password' ? 'text' : 'password';
  });

  // Test Gemini Key & Auto-Discover Models
  btnTestKey.addEventListener('click', () => {
    const key = inputGeminiKey.value.trim();
    if (!key) {
      geminiKeyStatus.style.display = 'block';
      geminiKeyStatus.style.color = '#f87171';
      geminiKeyStatus.textContent = '⚠️ Please enter an API key first.';
      return;
    }

    btnTestKey.disabled = true;
    btnTestKey.textContent = '...';
    geminiKeyStatus.style.display = 'block';
    geminiKeyStatus.style.color = '#a5b4fc';
    geminiKeyStatus.textContent = 'Connecting to Google AI Studio...';

    chrome.runtime.sendMessage({ type: 'TEST_GEMINI_KEY', key }, (res) => {
      btnTestKey.disabled = false;
      btnTestKey.textContent = '🔍 Test';

      if (res && res.success && res.models && res.models.length > 0) {
        geminiKeyStatus.style.color = '#34d399';
        geminiKeyStatus.textContent = `✅ Connected! Found ${res.models.length} active models on ${res.version}.`;

        // Repopulate select dropdown with user's verified models
        const currentVal = selectGeminiModel.value;
        selectGeminiModel.innerHTML = '<option value="auto">✨ Auto-detect Best Available (Recommended)</option>';

        res.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          if (m === currentVal) opt.selected = true;
          selectGeminiModel.appendChild(opt);
        });
      } else {
        geminiKeyStatus.style.color = '#f87171';
        geminiKeyStatus.textContent = `⚠️ ${(res && res.error) || 'Could not verify API key.'}`;
      }
    });
  });

  btnSaveSettings.addEventListener('click', async () => {
    const geminiApiKey = inputGeminiKey.value.trim();
    const geminiModel = selectGeminiModel ? selectGeminiModel.value : 'auto';
    const customEndpoint = inputCustomUrl.value.trim();
    const defaultEngine = selectDefaultEngine.value;

    if (customEndpoint) {
      APP_URLS.custom = customEndpoint;
    }

    await chrome.storage.local.set({
      geminiApiKey,
      geminiModel,
      customEndpoint,
      defaultEngine
    });

    settingsModal.classList.remove('active');
    showToast('Settings saved successfully!');
  });

  // 7. Toast helper
  function showToast(text) {
    sideToast.textContent = text;
    sideToast.classList.add('show');
    setTimeout(() => sideToast.classList.remove('show'), 2400);
  }

  // 8. Listen for new context broadcasts from background/content
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CONTEXT_UPDATED' && message.data) {
      updateContextDisplay(message.data.text);
    }
    if (message.type === 'SELECTION_CHANGED' && message.text) {
      updateContextDisplay(message.text);
    }
    if (message.type === 'TRIGGER_PAGE_TLDR') {
      setTimeout(() => {
        if (btnTldrPage) btnTldrPage.click();
      }, 350);
    }
  });

  // 9. Listen for local storage updates in real time
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.currentContext) {
      updateContextDisplay(changes.currentContext.newValue?.text || '');
    }
  });

  // Simple Markdown Formatter
  function renderMarkdown(md) {
    if (!md) return '';
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^### (.*$)/gim, '<h4 style="margin: 6px 0; color: #a5b4fc;">$1</h4>')
      .replace(/^## (.*$)/gim, '<h3 style="margin: 8px 0; color: #c7d2fe;">$1</h3>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      .replace(/`([^`]+)`/gim, '<code>$1</code>')
      .replace(/^\s*[-•*]\s+(.*$)/gim, '<li>$1</li>');

    if (html.includes('<li>')) {
      html = html.replace(/((?:<li>.*<\/li>\s*)+)/gim, '<ul>$1</ul>');
    }
    return html.replace(/\n\n/g, '<p></p>');
  }
});
