// Monocle Side Panel Core Controller
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
  const fileAccessBanner = document.getElementById('file-access-banner');
  const btnOpenFileSettings = document.getElementById('btn-open-file-settings');
  const btnSyncClipboard = document.getElementById('btn-sync-clipboard');
  const btnChipCustom = document.getElementById('btn-chip-custom');

  // Page Intelligence Elements
  const pageTitleDisplay = document.getElementById('page-title-display');
  const pageReadTime = document.getElementById('page-read-time');
  const btnTldrPage = document.getElementById('btn-tldr-page');
  const btnTranslatePage = document.getElementById('btn-translate-page');
  const btnDeepSummary = document.getElementById('btn-deep-summary');
  const btnChatPageMode = document.getElementById('btn-chat-page-mode');
  const btnChipTranslate = document.getElementById('btn-chip-translate');
  let currentPageData = null;

  // Chat elements
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');

  // Snip Tool Elements
  const btnSnipTool = document.getElementById('btn-snip-tool');
  const snipPreviewContainer = document.getElementById('snip-preview-container');
  const snipPreviewImg = document.getElementById('snip-preview-img');
  const btnDismissSnip = document.getElementById('btn-dismiss-snip');
  const btnExplainDiagram = document.getElementById('btn-explain-diagram');
  const btnExplainFormula = document.getElementById('btn-explain-formula');
  const btnOcrText = document.getElementById('btn-ocr-text');
  let currentCroppedBase64 = null;

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
  const selectTargetLanguage = document.getElementById('select-target-language');
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
    'currentContext',
    'lastSnipPayload',
    'targetLanguage'
  ]);

  if (storage.geminiApiKey) inputGeminiKey.value = storage.geminiApiKey;
  if (storage.geminiModel && selectGeminiModel) selectGeminiModel.value = storage.geminiModel;
  if (storage.targetLanguage && selectTargetLanguage) selectTargetLanguage.value = storage.targetLanguage;
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

  // Check if there is a fresh unhandled snip payload (< 2 minutes old)
  if (storage.lastSnipPayload && storage.lastSnipPayload.dataUrl) {
    const age = Date.now() - (storage.lastSnipPayload.timestamp || 0);
    if (age < 120000) {
      handleNewSnipPayload(storage.lastSnipPayload);
    }
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
      if (chatInput) {
        chatInput.placeholder = 'Ask custom prompt about selection (e.g. Write code for this)...';
      }
    } else {
      contextSnippet.textContent = 'No text selected yet. Highlight any text in your article!';
      contextSnippet.style.color = '#9ca3af';
      contextSnippet.style.borderLeftColor = 'rgba(255,255,255,0.2)';
      contextBar.classList.remove('has-selection');
      contextBar.style.display = 'flex';
      if (chatInput) {
        chatInput.placeholder = 'Ask anything about the article... (Enter to send, Shift+Enter for newline)';
      }
    }
  }

  // Wire Custom Prompt chip button
  if (btnChipCustom) {
    btnChipCustom.addEventListener('click', () => {
      switchEngine('fast-ai');
      if (chatInput) {
        chatInput.focus();
        chatInput.placeholder = 'Type custom prompt (e.g. "Write working Python code for this")...';
        chatInput.classList.add('input-highlight-pulse');
        setTimeout(() => chatInput.classList.remove('input-highlight-pulse'), 1500);
      }
    });
  }

  // Wire File Access Settings button
  if (btnOpenFileSettings) {
    btnOpenFileSettings.addEventListener('click', () => {
      chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    });
  }

  // Wire Sync Copied Text button (reads system clipboard)
  if (btnSyncClipboard) {
    btnSyncClipboard.addEventListener('click', async () => {
      try {
        const clipText = await navigator.clipboard.readText();
        if (clipText && clipText.trim()) {
          const trimmed = clipText.trim();
          updateContextDisplay(trimmed);
          if (currentPageData && currentPageData.isPdf) {
            currentPageData.text = trimmed;
          }
          chrome.storage.local.set({
            currentContext: {
              text: trimmed,
              title: currentPageData?.title || 'Copied Document Text',
              url: currentPageData?.url || '',
              timestamp: Date.now()
            }
          });
          showToast(`📋 Synced ${trimmed.length} characters from clipboard!`);
        } else {
          showToast('Clipboard is empty. Copy text from your document (Ctrl+C) first.');
        }
      } catch (err) {
        console.warn('Clipboard read error:', err);
        showToast('Could not read clipboard. Please paste directly into chat.');
      }
    });
  }

  // Proactive sync with current active tab
  async function syncWithActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      // 0. Check File Scheme Access for local file:/// URLs
      if (tab.url && tab.url.startsWith('file:///')) {
        chrome.extension.isAllowedFileSchemeAccess((isAllowed) => {
          if (fileAccessBanner) {
            fileAccessBanner.style.display = isAllowed ? 'none' : 'block';
          }
        });
      } else {
        if (fileAccessBanner) {
          fileAccessBanner.style.display = 'none';
        }
      }

      // Check if current tab is a PDF document
      const isPdf = tab.url && (
        tab.url.toLowerCase().endsWith('.pdf') ||
        tab.url.toLowerCase().includes('.pdf?') ||
        tab.url.toLowerCase().includes('.pdf#') ||
        (tab.title && tab.title.toLowerCase().endsWith('.pdf'))
      );

      if (isPdf) {
        let docName = 'Downloaded PDF Document';
        try {
          const u = new URL(tab.url);
          const parts = u.pathname.split('/').filter(Boolean);
          if (parts.length > 0) {
            docName = decodeURIComponent(parts[parts.length - 1]);
          }
        } catch (e) {
          if (tab.title) docName = tab.title;
        }

        currentPageData = {
          title: docName,
          url: tab.url,
          wordCount: 0,
          readingTime: 1,
          isPdf: true,
          text: currentContextText || ''
        };

        const shortTitle = docName.length > 25 ? docName.slice(0, 24) + '...' : docName;
        pageTitleDisplay.textContent = `📕 ${shortTitle}`;
        pageTitleDisplay.title = `${docName} (Chrome Native PDF Viewer)`;
        pageReadTime.textContent = '📕 PDF Document';
        pageReadTime.style.display = 'inline-block';
        return;
      }

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
    if ((!currentPageData || !currentPageData.text) && currentContextText) {
      if (!currentPageData) {
        currentPageData = { title: 'Selected Excerpt', text: currentContextText };
      } else {
        currentPageData.text = currentContextText;
      }
    }
    if (!currentPageData || !currentPageData.text) {
      if (currentPageData?.isPdf) {
        showToast('Tip: In PDF, highlight text & right-click to Explain, or press Ctrl+C and click "Sync Copied"!');
        return;
      }
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

  // Multilingual Page Summary & Key Takeaways
  if (btnTranslatePage) {
    btnTranslatePage.addEventListener('click', async () => {
      if (!currentPageData || !currentPageData.text) {
        await syncWithActiveTab();
      }
      if ((!currentPageData || !currentPageData.text) && currentContextText) {
        if (!currentPageData) {
          currentPageData = { title: 'Selected Excerpt', text: currentContextText };
        } else {
          currentPageData.text = currentContextText;
        }
      }
      if (!currentPageData || !currentPageData.text) {
        if (currentPageData?.isPdf) {
          showToast('Tip: In PDF, highlight text & right-click to Translate, or press Ctrl+C and click "Sync Copied"!');
          return;
        }
        showToast('Could not extract page text from this tab.');
        return;
      }

      const targetLang = selectTargetLanguage ? selectTargetLanguage.value : 'English';
      const prompt = `Please provide an Executive Summary and Key Takeaways of this article ("${currentPageData.title}") translated into ${targetLang}.\n\nStructure your response cleanly as:\n### 🌐 30-Second TL;DR (${targetLang})\n2 to 3 concise, high-impact sentences capturing the core thesis.\n\n### 🎯 Key Takeaways (${targetLang})\n• 3 to 4 crisp bullet points highlighting the conclusions.\n\n### 🔍 Key Terminology & Nuance Notes\n• 2 to 3 notable technical concepts or terms explained in ${targetLang}.\n\nArticle Text:\n"""\n${currentPageData.text}\n"""`;

      if (activeEngine === 'fast-ai') {
        sendMessage(prompt, true, `🌐 Executive Summary in ${targetLang} of: "${currentPageData.title}"`);
      } else {
        navigator.clipboard.writeText(prompt).then(() => {
          showToast(`Page translation prompt copied! Press Ctrl+V in ${ENGINE_NAMES[activeEngine]}.`);
        });
      }
    });
  }

  // Deep Outline & Key Points
  btnDeepSummary.addEventListener('click', async () => {
    if (!currentPageData || !currentPageData.text) {
      await syncWithActiveTab();
    }
    if ((!currentPageData || !currentPageData.text) && currentContextText) {
      if (!currentPageData) {
        currentPageData = { title: 'Selected Excerpt', text: currentContextText };
      } else {
        currentPageData.text = currentContextText;
      }
    }
    if (!currentPageData || !currentPageData.text) {
      if (currentPageData?.isPdf) {
        showToast('Tip: In PDF, highlight text & right-click to Outline, or press Ctrl+C and click "Sync Copied"!');
        return;
      }
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
    if ((!currentPageData || !currentPageData.text) && currentContextText) {
      if (!currentPageData) {
        currentPageData = { title: 'Selected Excerpt', text: currentContextText, wordCount: currentContextText.split(/\s+/).length };
      } else {
        currentPageData.text = currentContextText;
      }
    }
    if (!currentPageData || !currentPageData.text) {
      if (currentPageData?.isPdf) {
        showToast('Tip: Copy text from your PDF (Ctrl+C) and click "Sync Copied" to chat with it!');
        return;
      }
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

  // 1-Click Multilingual Translation Chip
  if (btnChipTranslate) {
    btnChipTranslate.addEventListener('click', () => {
      if (!currentContextText) {
        showToast('Please select text on the page first!');
        return;
      }
      const targetLang = selectTargetLanguage ? selectTargetLanguage.value : 'English';
      if (activeEngine === 'fast-ai') {
        sendMessage('', false, `🌐 Translate to ${targetLang}`, false, null, true);
      } else {
        const prompt = `Please translate the following text into ${targetLang} with vocabulary notes:\n\n"${currentContextText}"`;
        navigator.clipboard.writeText(prompt).then(() => {
          showToast(`Translation prompt copied! Press Ctrl+V in ${ENGINE_NAMES[activeEngine]}.`);
        });
      }
    });
  }

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

  // 4. Visual Snip Cropping & Handlers
  function cropScreenshot(dataUrl, area) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = (area.viewportWidth && img.naturalWidth)
            ? (img.naturalWidth / area.viewportWidth)
            : (area.dpr || window.devicePixelRatio || 1);

          const cropX = Math.max(0, Math.round(area.x * scale));
          const cropY = Math.max(0, Math.round(area.y * scale));
          const cropW = Math.min(img.naturalWidth - cropX, Math.round(area.width * scale));
          const cropH = Math.min(img.naturalHeight - cropY, Math.round(area.height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, cropW);
          canvas.height = Math.max(1, cropH);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = (e) => reject(e);
      img.src = dataUrl;
    });
  }

  async function handleNewSnipPayload(payload) {
    if (!payload || !payload.dataUrl || !payload.area) return;
    try {
      const croppedUrl = await cropScreenshot(payload.dataUrl, payload.area);
      currentCroppedBase64 = croppedUrl;
      if (snipPreviewImg) snipPreviewImg.src = croppedUrl;
      if (snipPreviewContainer) snipPreviewContainer.style.display = 'flex';
      switchEngine('fast-ai');
      showToast('📸 Visual area captured! Pick an action below or ask a question.');
    } catch (e) {
      console.error('Failed to crop snip screenshot:', e);
    }
  }

  function dismissCurrentSnip() {
    currentCroppedBase64 = null;
    if (snipPreviewImg) snipPreviewImg.src = '';
    if (snipPreviewContainer) snipPreviewContainer.style.display = 'none';
    chrome.storage.local.remove('lastSnipPayload');
  }

  if (btnSnipTool) {
    btnSnipTool.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'START_SNIP_REQUEST' });
      showToast('Crosshair active: Click & drag to snip diagram or formula.');
    });
  }

  if (btnDismissSnip) {
    btnDismissSnip.addEventListener('click', dismissCurrentSnip);
  }

  async function sendVisionRequest(prompt, label) {
    if (!currentCroppedBase64) {
      showToast('No active snip image.');
      return;
    }

    const imageToSend = currentCroppedBase64;
    dismissCurrentSnip();

    // Display user message with thumbnail
    const userHtml = `
      <div class="user-snip-preview">
        <img src="${imageToSend}" class="msg-thumbnail" alt="Snipped area" />
        <div><strong>${label}</strong></div>
      </div>
    `;

    sendMessage(prompt, false, userHtml, true, imageToSend);
  }

  if (btnExplainDiagram) {
    btnExplainDiagram.addEventListener('click', () => {
      sendVisionRequest(
        'Analyze this diagram, flowchart, or architecture chart in depth. Break down its components, data flow, arrows/relationships, labels, and core conceptual takeaways in structured markdown:',
        '📊 Explain Diagram'
      );
    });
  }

  if (btnExplainFormula) {
    btnExplainFormula.addEventListener('click', () => {
      sendVisionRequest(
        'Analyze this mathematical or scientific formula/equation. Transcribe it into standard LaTeX notation, explain what every variable and symbol represents, and explain the underlying theorem, concept, and real-world intuition:',
        '🧮 Explain Formula & Math'
      );
    });
  }

  if (btnOcrText) {
    btnOcrText.addEventListener('click', () => {
      sendVisionRequest(
        'Transcribe all text, numbers, equations, or code shown in this visual image verbatim. Then provide a concise explanation of what it represents:',
        '📝 Transcribe Text & Code'
      );
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 5. Native Fast AI Chat Logic
  function handleChatSubmit() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';

    if (currentCroppedBase64) {
      sendVisionRequest(text, text);
    } else if (currentContextText) {
      // Custom prompt with selected content in first go!
      const userHtml = `
        <div class="user-prompt-text">${escapeHtml(text)}</div>
        <div class="user-context-quote" title="Referenced Selection">
          <span class="context-quote-badge">📌 Selected Context</span>
          <div class="context-quote-body">"${escapeHtml(currentContextText.slice(0, 180))}${currentContextText.length > 180 ? '...' : ''}"</div>
        </div>
      `;
      sendMessage(text, false, userHtml);
    } else {
      sendMessage(text);
    }
  }

  chatSendBtn.addEventListener('click', handleChatSubmit);

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });

  function appendMessage(sender, content, isHtml = false) {
    const msgEl = document.createElement('div');
    msgEl.className = `message ${sender}-message`;

    const avatar = sender === 'user' ? '👤' : '🧐';
    msgEl.innerHTML = `
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-content">${isHtml ? content : renderMarkdown(content)}</div>
    `;

    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgEl;
  }

  // Real-Time SSE Token Streaming Message Dispatcher
  async function sendMessage(promptText, isPageSummary = false, displaySnippet = null, isVision = false, base64Image = null, isTranslation = false) {
    appendMessage('user', displaySnippet || (isPageSummary ? '⚡ Please generate an Executive 30-Second TL;DR of this page.' : promptText));

    const botMsg = appendMessage('bot', '<span class="omni-spinner"></span>Reading and analyzing...', true);
    const botContent = botMsg.querySelector('.msg-content');

    const targetLang = selectTargetLanguage ? selectTargetLanguage.value : 'English';

    try {
      const port = chrome.runtime.connect({ name: 'monocle-stream' });
      let accumulated = '';
      let receivedFirstChunk = false;

      port.onMessage.addListener((msg) => {
        if (msg.type === 'CHUNK') {
          if (!receivedFirstChunk) {
            receivedFirstChunk = true;
            botContent.innerHTML = '';
          }
          accumulated += msg.text;
          botContent.innerHTML = renderMarkdown(accumulated) + '<span class="omni-cursor"></span>';
          chatMessages.scrollTop = chatMessages.scrollHeight;
        } else if (msg.type === 'DONE') {
          botContent.innerHTML = renderMarkdown(accumulated);
          chatMessages.scrollTop = chatMessages.scrollHeight;
          try { port.disconnect(); } catch (e) {}
        } else if (msg.type === 'ERROR') {
          botContent.innerHTML = `
            <p style="color: #f87171;">⚠️ ${msg.error || 'Failed to fetch response'}</p>
            <p style="font-size: 11.5px; margin-top: 4px; color: #9ca3af;">
              Check your free API key in <strong>⚙️ Settings</strong>.
            </p>
          `;
          chatMessages.scrollTop = chatMessages.scrollHeight;
          try { port.disconnect(); } catch (e) {}
        }
      });

      port.onDisconnect.addListener(() => {
        if (!receivedFirstChunk && chrome.runtime.lastError) {
          botContent.innerHTML = `<p style="color: #f87171;">⚠️ Connection interrupted: ${chrome.runtime.lastError.message}</p>`;
        }
      });

      port.postMessage({
        type: 'START_STREAM',
        prompt: promptText,
        text: currentContextText,
        isVision,
        base64Image,
        isTranslation,
        targetLanguage: targetLang
      });
    } catch (e) {
      botContent.innerHTML = `<p style="color: #f87171;">⚠️ Error connecting stream: ${e.message}</p>`;
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
          <div class="msg-avatar">🧐</div>
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

      if (chrome.runtime.lastError) {
        geminiKeyStatus.style.color = '#f87171';
        geminiKeyStatus.textContent = `⚠️ ${chrome.runtime.lastError.message}`;
        return;
      }

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
    const targetLanguage = selectTargetLanguage ? selectTargetLanguage.value : 'English';
    const customEndpoint = inputCustomUrl.value.trim();
    const defaultEngine = selectDefaultEngine.value;

    if (customEndpoint) {
      APP_URLS.custom = customEndpoint;
    }

    await chrome.storage.local.set({
      geminiApiKey,
      geminiModel,
      targetLanguage,
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
    if (message.type === 'TRIGGER_EXPLAIN_IN_PANEL' && message.text) {
      updateContextDisplay(message.text);
      switchEngine('fast-ai');
      const prompt = `Please provide a crystal-clear, structured explanation of the following excerpt.\n\nStructure your answer as:\n### 💡 Plain-English Summary\n1 to 2 clear, accessible sentences anyone can understand.\n\n### 🔍 Key Concepts & Takeaways\n• 2 to 3 bullet points breaking down what it means and how it works.\n\nExcerpt:\n"""\n${message.text}\n"""`;
      sendMessage(prompt, false, `⚡ Quick Explanation of selected excerpt`);
    }
    if (message.type === 'TRIGGER_TRANSLATE_IN_PANEL' && message.text) {
      updateContextDisplay(message.text);
      switchEngine('fast-ai');
      const targetLang = selectTargetLanguage ? selectTargetLanguage.value : 'English';
      const prompt = `Please provide a high-precision translation of the following excerpt into ${targetLang}.\n\nStructure your response cleanly as:\n### 🌐 Translation (${targetLang})\n[Provide the fluent, natural translation here]\n\n### 🔍 Key Vocabulary & Nuance Notes\n• 2 to 3 notable terms or nuances explained in ${targetLang}.\n\nExcerpt:\n"""\n${message.text}\n"""`;
      sendMessage(prompt, false, `🌐 Translation to ${targetLang}`, false, null, true);
    }
    if (message.type === 'FOCUS_CUSTOM_PROMPT') {
      if (message.text) updateContextDisplay(message.text);
      switchEngine('fast-ai');
      if (chatInput) {
        chatInput.focus();
        chatInput.placeholder = 'Type custom prompt for selection (e.g. "Write working Python code")...';
        chatInput.classList.add('input-highlight-pulse');
        setTimeout(() => chatInput.classList.remove('input-highlight-pulse'), 1500);
      }
    }
    if (message.type === 'SNIP_READY_FOR_CROP' && message.payload) {
      handleNewSnipPayload(message.payload);
    }
  });

  // Code Copy Button Handler (Delegated for CSP safety)
  chatMessages.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.monocle-code-copy-btn');
    if (copyBtn) {
      e.stopPropagation();
      const encoded = copyBtn.getAttribute('data-code');
      const code = encoded ? decodeURIComponent(encoded) : (copyBtn.closest('.monocle-code-block')?.querySelector('code')?.innerText || '');
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.textContent = '✓ Copied!';
        copyBtn.style.color = '#34d399';
        setTimeout(() => {
          copyBtn.textContent = '📋 Copy';
          copyBtn.style.color = '';
        }, 2000);
      });
    }
  });

  // 9. Listen for local storage updates in real time
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.currentContext) {
      updateContextDisplay(changes.currentContext.newValue?.text || '');
    }
    if (area === 'local' && changes.lastSnipPayload) {
      if (changes.lastSnipPayload.newValue) {
        handleNewSnipPayload(changes.lastSnipPayload.newValue);
      }
    }
  });

  // Resilient Markdown & Code Block Formatter (Full formatting like official Gemini app)
  function renderMarkdown(md) {
    if (!md) return '';

    // 1. Extract fenced code blocks (handling open streaming blocks too)
    const codeBlocks = [];
    let text = md.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)(?:```|$)/g, (match, lang, code) => {
      const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push({
        lang: (lang || 'code').trim().toLowerCase(),
        code: code
      });
      return placeholder;
    });

    // 2. Escape prose text
    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 3. Headings, bold, italics, inline code, and lists
    text = text
      .replace(/^#### (.*$)/gim, '<h5 style="margin: 6px 0 3px 0; color: #cbd5e1; font-weight: 600;">$1</h5>')
      .replace(/^### (.*$)/gim, '<h4 style="margin: 8px 0 4px 0; color: #a5b4fc; font-weight: 700;">$1</h4>')
      .replace(/^## (.*$)/gim, '<h3 style="margin: 10px 0 6px 0; color: #c7d2fe; font-weight: 700;">$1</h3>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      .replace(/`([^`]+)`/gim, '<code class="monocle-inline-code">$1</code>')
      .replace(/^\s*[-•*]\s+(.*$)/gim, '<li>$1</li>');

    if (text.includes('<li>')) {
      text = text.replace(/((?:<li>.*<\/li>\s*)+)/gim, '<ul style="margin: 6px 0; padding-left: 20px;">$1</ul>');
    }

    text = text.replace(/\n\n/g, '<p style="margin: 6px 0;"></p>');
    text = text.replace(/\n/g, '<br>');

    // 4. Reinsert code blocks
    codeBlocks.forEach((cb, idx) => {
      const escapedCode = cb.code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const blockHtml = `
        <div class="monocle-code-block">
          <div class="monocle-code-header">
            <span class="monocle-code-lang">${cb.lang || 'code'}</span>
            <button class="monocle-code-copy-btn" data-code="${encodeURIComponent(cb.code)}" type="button">📋 Copy</button>
          </div>
          <pre class="monocle-code-pre"><code class="language-${cb.lang || 'text'}">${escapedCode}</code></pre>
        </div>
      `.trim();

      text = text.replace(`__CODE_BLOCK_${idx}__`, blockHtml);
    });

    return text;
  }
});
