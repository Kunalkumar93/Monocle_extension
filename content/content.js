// Monocle In-Page Content Script
(function () {
  // Prevent duplicate injection
  if (window.__monocleInitialized || window.__omniAiInitialized) return;
  window.__monocleInitialized = true;
  window.__omniAiInitialized = true;

  // Ignore tiny/hidden iframes (e.g. ads, tracking pixels, 0x0 frames)
  if (window.top !== window.self && (window.innerWidth < 150 || window.innerHeight < 150)) {
    return;
  }

  let currentSelectedText = '';
  let shadowRoot = null;
  let pillElement = null;
  let popoverElement = null;
  let hostElement = null;
  let selectionDebounceTimer = null;
  let currentTargetLanguage = 'English';
  let activeStreamPort = null;
  let currentIsTranslation = false;
  let currentPromptPrefix = '';

  // Trusted Types policy for YouTube & strict CSP compatibility
  let trustedPolicy = null;
  function getTrustedPolicy() {
    if (trustedPolicy !== null) return trustedPolicy;
    try {
      if (typeof window !== 'undefined' && window.trustedTypes && window.trustedTypes.createPolicy) {
        trustedPolicy = window.trustedTypes.createPolicy('monoclePolicy', {
          createHTML: (string) => string
        });
      }
    } catch (e) {
      try {
        trustedPolicy = window.trustedTypes.defaultPolicy || { createHTML: (s) => s };
      } catch (e2) {
        trustedPolicy = { createHTML: (s) => s };
      }
    }
    return trustedPolicy;
  }

  function setElementHTML(element, htmlString) {
    if (!element) return;
    try {
      const policy = getTrustedPolicy();
      if (policy && typeof policy.createHTML === 'function') {
        element.innerHTML = policy.createHTML(htmlString);
        return;
      }
    } catch (e) {}

    try {
      element.innerHTML = htmlString;
    } catch (err) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        element.replaceChildren(...doc.body.childNodes);
      } catch (e3) {
        element.textContent = htmlString;
      }
    }
  }

  // Load user language preference
  try {
    if (chrome?.storage?.local) {
      chrome.storage.local.get(['targetLanguage'], (data) => {
        if (data && data.targetLanguage) {
          currentTargetLanguage = data.targetLanguage;
        }
      });
    }
  } catch (e) {}

  // Safe Extension Context Checker (detects if extension was reloaded in chrome://extensions)
  function isContextValid() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  // Safe Message Dispatcher (guards against "Extension context invalidated")
  function safeSendMessage(payload, callback) {
    if (!isContextValid()) {
      cleanupOrphanedScript();
      return false;
    }
    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          // Extension context or connection closed; suppress uncaught errors
          return;
        }
        if (callback) callback(response);
      });
      return true;
    } catch (err) {
      cleanupOrphanedScript();
      return false;
    }
  }

  // Cleanup orphaned event listeners when extension is reloaded
  function cleanupOrphanedScript() {
    document.removeEventListener('mouseup', handleMouseUp);
    document.removeEventListener('selectionchange', handleSelectionChange);
    hidePill();
    hidePopover();
  }

  // Initialize Isolated Shadow DOM
  function initHost() {
    hostElement = document.getElementById('monocle-companion-root') || document.getElementById('omni-ai-companion-root');
    if (!hostElement) {
      hostElement = document.createElement('div');
      hostElement.id = 'monocle-companion-root';
      document.documentElement.appendChild(hostElement);
    }
    if (!hostElement.shadowRoot) {
      shadowRoot = hostElement.attachShadow({ mode: 'open' });
      injectStyles();
      createElements();
    } else {
      shadowRoot = hostElement.shadowRoot;
    }
  }

  // Inject CSS directly into Shadow DOM (100% inline, zero network requests, immune to page CSP/CORS)
  function injectStyles() {
    if (!shadowRoot) return;

    const coreStyle = document.createElement('style');
    coreStyle.textContent = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        z-index: 2147483647;
      }
      .omni-floating-pill {
        position: absolute;
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(18, 20, 29, 0.94);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(99, 102, 241, 0.2);
        border-radius: 9999px;
        padding: 5px 8px;
        z-index: 2147483647;
        opacity: 0;
        transform: translateY(6px) scale(0.96);
        pointer-events: none;
        transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        color: #f3f4f6;
        user-select: none;
      }
      .omni-floating-pill.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }
      .omni-pill-brand {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 0 6px 0 2px;
        border-right: 1px solid rgba(255, 255, 255, 0.12);
        cursor: pointer;
      }
      .omni-pill-icon {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: linear-gradient(135deg, #6366f1, #a855f7, #06b6d4);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        box-shadow: 0 0 10px rgba(99, 102, 241, 0.6);
      }
      .omni-pill-title {
        font-size: 12px;
        font-weight: 700;
        background: linear-gradient(135deg, #e0e7ff, #c084fc);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }
      .omni-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #e5e7eb;
        padding: 5px 10px;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
      }
      .omni-btn:hover {
        background: rgba(99, 102, 241, 0.25);
        border-color: rgba(99, 102, 241, 0.5);
        color: #ffffff;
        transform: translateY(-1px);
      }
      .omni-btn-primary {
        background: linear-gradient(135deg, #4f46e5, #7c3aed);
        border: 1px solid rgba(168, 85, 247, 0.4);
        color: #ffffff;
      }
      .omni-btn-primary:hover {
        background: linear-gradient(135deg, #4338ca, #6d28d9);
        box-shadow: 0 0 12px rgba(99, 102, 241, 0.5);
      }
      .omni-btn-translate {
        background: linear-gradient(135deg, #0284c7, #6366f1);
        border: 1px solid rgba(56, 189, 248, 0.4);
        color: #ffffff;
      }
      .omni-btn-translate:hover {
        background: linear-gradient(135deg, #0369a1, #4f46e5);
        box-shadow: 0 0 12px rgba(14, 165, 233, 0.5);
      }
      .omni-lang-badge {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #c7d2fe;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        outline: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .omni-lang-badge:hover {
        background: rgba(255, 255, 255, 0.15);
        border-color: #818cf8;
      }
      .omni-lang-badge option {
        background: #131620;
        color: #f3f4f6;
      }
      .omni-cursor {
        display: inline-block;
        width: 6px;
        height: 14px;
        background-color: #818cf8;
        margin-left: 3px;
        vertical-align: middle;
        border-radius: 1px;
        animation: omni-blink 0.8s infinite;
      }
      @keyframes omni-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }
      .omni-btn-icon {
        font-size: 13px;
        line-height: 1;
      }
      .omni-popover {
        position: absolute;
        width: 380px;
        max-width: 90vw;
        background: rgba(15, 17, 26, 0.97);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(99, 102, 241, 0.3);
        box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        overflow: hidden;
        z-index: 2147483647;
        opacity: 0;
        transform: translateY(8px) scale(0.97);
        pointer-events: none;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        color: #e5e7eb;
      }
      .omni-popover.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }
      .omni-popover-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.04);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .omni-popover-header-left {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #f3f4f6;
      }
      .omni-popover-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .omni-icon-btn {
        background: transparent;
        border: none;
        color: #9ca3af;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        transition: all 0.15s ease;
      }
      .omni-icon-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
      }
      .omni-popover-body {
        padding: 14px;
        max-height: 260px;
        overflow-y: auto;
        font-size: 13.5px;
        line-height: 1.6;
        color: #d1d5db;
      }
      .omni-popover-body::-webkit-scrollbar {
        width: 5px;
      }
      .omni-popover-body::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
        border-radius: 4px;
      }
      .omni-popover-body p {
        margin: 0 0 10px 0;
      }
      .omni-popover-body ul {
        margin: 0 0 10px 0;
        padding-left: 20px;
      }
      .omni-popover-body li {
        margin-bottom: 5px;
      }
      .omni-popover-body strong {
        color: #f9fafb;
      }
      .omni-popover-footer {
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.02);
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .omni-quick-input {
        flex: 1;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 12px;
        color: #ffffff;
        outline: none;
        transition: border-color 0.15s;
      }
      .omni-quick-input:focus {
        border-color: #6366f1;
      }
      .omni-quick-input::placeholder {
        color: #6b7280;
      }
      .omni-spinner {
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-top-color: #818cf8;
        border-radius: 50%;
        animation: omni-spin 0.8s linear infinite;
        display: inline-block;
        margin-right: 6px;
        vertical-align: middle;
      }
      @keyframes omni-spin {
        to { transform: rotate(360deg); }
      }
      .omni-toast {
        position: absolute;
        bottom: 50px;
        left: 50%;
        transform: translateX(-50%);
        background: #10b981;
        color: white;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        border-radius: 6px;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
      }
      .omni-toast.show {
        opacity: 1;
      }
      .omni-snip-overlay {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        z-index: 2147483646;
        cursor: crosshair;
        background: rgba(0, 0, 0, 0.32);
        user-select: none;
        animation: omni-fade-in 0.15s ease-out;
      }
      @keyframes omni-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .omni-snip-banner {
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(18, 20, 29, 0.96);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(99, 102, 241, 0.5);
        padding: 8px 18px;
        border-radius: 9999px;
        color: #f3f4f6;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 15px rgba(99, 102, 241, 0.3);
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .omni-snip-box {
        position: fixed;
        border: 2px dashed #818cf8;
        background: rgba(99, 102, 241, 0.12);
        box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
        pointer-events: none;
        border-radius: 4px;
      }
      .omni-snip-dims {
        position: absolute;
        bottom: -22px;
        right: 0;
        background: #4f46e5;
        color: #ffffff;
        font-size: 10px;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 4px;
        letter-spacing: 0.3px;
      }
    `;
    shadowRoot.appendChild(coreStyle);
  }

  // Create UI Elements inside Shadow DOM
  function createElements() {
    // 1. Floating Pill
    pillElement = document.createElement('div');
    pillElement.className = 'omni-floating-pill';
    setElementHTML(pillElement, `
      <div class="omni-pill-brand" title="Monocle Companion">
        <div class="omni-pill-icon">🧐</div>
        <span class="omni-pill-title">Monocle</span>
      </div>
      <button class="omni-btn omni-btn-primary" id="omni-quick-explain-btn" title="Get fast explanation">
        <span class="omni-btn-icon">⚡</span> Explain
      </button>
      <button class="omni-btn omni-btn-translate" id="omni-translate-btn" title="Translate & explain vocabulary">
        <span class="omni-btn-icon">🌐</span> Translate
      </button>
      <button class="omni-btn" id="omni-open-panel-btn" title="Open in docked Side Panel">
        <span class="omni-btn-icon">💬</span> Side Panel
      </button>
      <button class="omni-btn" id="omni-summarize-btn" title="Summarize in bullets">
        <span class="omni-btn-icon">📋</span> Summary
      </button>
    `);
    shadowRoot.appendChild(pillElement);

    // 2. Popover Card
    popoverElement = document.createElement('div');
    popoverElement.className = 'omni-popover';
    setElementHTML(popoverElement, `
      <div class="omni-popover-header">
        <div class="omni-popover-header-left" style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 15px;">🧐</span>
          <span id="omni-popover-title">Monocle Quick Insight</span>
        </div>
        <div class="omni-popover-actions">
          <select class="omni-lang-badge" id="omni-popover-lang-select" title="Target Language">
            <option value="English">EN</option>
            <option value="Spanish">ES</option>
            <option value="French">FR</option>
            <option value="German">DE</option>
            <option value="Chinese (Simplified)">ZH</option>
            <option value="Japanese">JA</option>
            <option value="Korean">KO</option>
            <option value="Hindi">HI</option>
            <option value="Portuguese">PT</option>
            <option value="Italian">IT</option>
            <option value="Russian">RU</option>
            <option value="Arabic">AR</option>
          </select>
          <button class="omni-icon-btn" id="omni-popover-copy-btn" title="Copy answer">📋</button>
          <button class="omni-icon-btn" id="omni-popover-expand-btn" title="Expand into Side Panel">↗</button>
          <button class="omni-icon-btn" id="omni-popover-close-btn" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="omni-popover-body" id="omni-popover-content">
        <p><span class="omni-spinner"></span>Analyzing selected text...</p>
      </div>
      <div class="omni-popover-footer">
        <input type="text" class="omni-quick-input" id="omni-followup-input" placeholder="Ask follow-up question (Enter)..." />
        <button class="omni-btn omni-btn-primary" id="omni-followup-send-btn">Ask</button>
      </div>
      <div class="omni-toast" id="omni-toast">Copied to clipboard!</div>
    `);
    shadowRoot.appendChild(popoverElement);

    bindEvents();
  }

  // Bind Listeners
  function bindEvents() {
    // Pill Explain Button
    shadowRoot.getElementById('omni-quick-explain-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openPopover('Explain this simply and concisely:');
    });

    // Pill Translate Button
    shadowRoot.getElementById('omni-translate-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openPopover(null, true);
    });

    // Pill Summarize Button
    shadowRoot.getElementById('omni-summarize-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openPopover('Summarize the key points of this in 3 concise bullet points:');
    });

    // Pill Side Panel Button
    shadowRoot.getElementById('omni-open-panel-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openInSidePanel(currentSelectedText);
      hidePill();
    });

    // Popover Close Button
    shadowRoot.getElementById('omni-popover-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      hidePopover();
    });

    // Popover Copy Button
    shadowRoot.getElementById('omni-popover-copy-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const content = shadowRoot.getElementById('omni-popover-content').innerText;
      navigator.clipboard.writeText(content).then(() => {
        showToast('Copied to clipboard!');
      });
    });

    // Popover Language Select Change
    const langSelect = shadowRoot.getElementById('omni-popover-lang-select');
    if (langSelect) {
      if (currentTargetLanguage) langSelect.value = currentTargetLanguage;
      langSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        currentTargetLanguage = langSelect.value;
        try {
          if (chrome?.storage?.local) {
            chrome.storage.local.set({ targetLanguage: currentTargetLanguage });
          }
        } catch (err) {}
        if (currentSelectedText) {
          executeStreamingAiQuery(currentPromptPrefix, currentIsTranslation);
        }
      });
    }

    // Popover Expand into Side Panel
    shadowRoot.getElementById('omni-popover-expand-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openInSidePanel(currentSelectedText);
      hidePopover();
    });

    // Popover Follow-up Input
    const followupInput = shadowRoot.getElementById('omni-followup-input');
    const followupSendBtn = shadowRoot.getElementById('omni-followup-send-btn');

    const handleFollowup = () => {
      const q = followupInput.value.trim();
      if (!q) return;
      followupInput.value = '';
      executeStreamingAiQuery(`${q} regarding this text:`, false);
    };

    followupSendBtn.addEventListener('click', handleFollowup);
    followupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleFollowup();
      e.stopPropagation();
    });
  }

  // Open Popover and query AI (with real-time streaming)
  function openPopover(promptPrefix, isTranslation = false) {
    if (!currentSelectedText) return;
    hidePill();

    currentPromptPrefix = promptPrefix || '';
    currentIsTranslation = isTranslation;

    const titleEl = shadowRoot.getElementById('omni-popover-title');
    if (titleEl) {
      titleEl.textContent = isTranslation ? '🌐 Monocle Translation' : '🧐 Monocle Quick Insight';
    }

    const langSelect = shadowRoot.getElementById('omni-popover-lang-select');
    if (langSelect && currentTargetLanguage) {
      langSelect.value = currentTargetLanguage;
    }

    // Position popover near selection
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const popoverWidth = 380;
      const popoverHeight = 320;
      let top = rect.bottom + window.scrollY + 10;
      let left = rect.left + window.scrollX;

      // Flip above if too close to bottom
      if (rect.bottom + popoverHeight > window.innerHeight && rect.top > popoverHeight + 20) {
        top = rect.top + window.scrollY - popoverHeight - 10;
      }

      // Prevent overflow horizontally
      const maxLeft = window.innerWidth - popoverWidth - 16;
      if (left > maxLeft) left = Math.max(10, maxLeft);
      if (left < 10) left = 10;

      popoverElement.style.top = `${top}px`;
      popoverElement.style.left = `${left}px`;
    }

    popoverElement.classList.add('visible');
    executeStreamingAiQuery(promptPrefix, isTranslation);
  }

  // Execute Streaming AI Query via Long-Lived Background Port
  function executeStreamingAiQuery(promptPrefix, isTranslation = false) {
    const contentEl = shadowRoot.getElementById('omni-popover-content');
    setElementHTML(contentEl, `<p><span class="omni-spinner"></span>${isTranslation ? `Translating to ${currentTargetLanguage}...` : 'Analyzing selected text...'}</p>`);

    if (activeStreamPort) {
      try { activeStreamPort.disconnect(); } catch (e) {}
      activeStreamPort = null;
    }

    let port;
    try {
      port = chrome.runtime.connect({ name: 'monocle-stream' });
      activeStreamPort = port;
    } catch (e) {
      // Fallback if port creation failed
      safeSendMessage(
        {
          type: 'FETCH_GEMINI_EXPLANATION',
          prompt: isTranslation ? `Translate into ${currentTargetLanguage}` : promptPrefix,
          text: currentSelectedText
        },
        (response) => {
          if (response && response.success) {
            setElementHTML(contentEl, renderMarkdown(response.text));
          } else {
            setElementHTML(contentEl, `<p style="color: #f87171;">⚠️ ${(response && response.error) || 'Failed to get answer'}</p>`);
          }
        }
      );
      return;
    }

    let accumulatedText = '';
    let receivedFirstChunk = false;

    port.onMessage.addListener((msg) => {
      if (msg.type === 'CHUNK') {
        if (!receivedFirstChunk) {
          receivedFirstChunk = true;
          setElementHTML(contentEl, '');
        }
        accumulatedText += msg.text;
        setElementHTML(contentEl, renderMarkdown(accumulatedText) + '<span class="omni-cursor"></span>');
        contentEl.scrollTop = contentEl.scrollHeight;
      } else if (msg.type === 'DONE') {
        setElementHTML(contentEl, renderMarkdown(accumulatedText));
        contentEl.scrollTop = contentEl.scrollHeight;
        try { port.disconnect(); } catch (e) {}
        activeStreamPort = null;
      } else if (msg.type === 'ERROR') {
        setElementHTML(contentEl, `<p style="color: #f87171;">⚠️ ${msg.error || 'Failed to stream response'}</p>`);
        try { port.disconnect(); } catch (e) {}
        activeStreamPort = null;
      }
    });

    port.onDisconnect.addListener(() => {
      activeStreamPort = null;
      if (!receivedFirstChunk) {
        const errMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Stream disconnected. Check settings or refresh.';
        setElementHTML(contentEl, `<p style="color: #f87171;">⚠️ ${errMsg}</p>`);
      }
    });

    port.postMessage({
      type: 'START_STREAM',
      prompt: promptPrefix,
      text: currentSelectedText,
      isTranslation: isTranslation,
      targetLanguage: currentTargetLanguage
    });
  }

  // Simple Markdown Renderer
  function renderMarkdown(md) {
    if (!md) return '';
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^### (.*$)/gim, '<h4 style="margin: 6px 0 4px 0; color: #a5b4fc;">$1</h4>')
      .replace(/^## (.*$)/gim, '<h3 style="margin: 8px 0 6px 0; color: #c7d2fe;">$1</h3>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      .replace(/`([^`]+)`/gim, '<code style="background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 4px; font-size: 12px;">$1</code>')
      .replace(/^\s*[-•*]\s+(.*$)/gim, '<li>$1</li>');

    // Wrap list items in <ul>
    if (html.includes('<li>')) {
      html = html.replace(/((?:<li>.*<\/li>\s*)+)/gim, '<ul>$1</ul>');
    }
    return html.replace(/\n\n/g, '<p></p>');
  }

  // Send selected text to background worker to open side panel
  function openInSidePanel(text) {
    if (!text) return;
    safeSendMessage({
      type: 'OPEN_SIDE_PANEL_WITH_TEXT',
      text: text
    });
  }

  function showToast(msg) {
    const toast = shadowRoot.getElementById('omni-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  function hidePill() {
    if (pillElement) pillElement.classList.remove('visible');
  }

  function hidePopover() {
    if (activeStreamPort) {
      try { activeStreamPort.disconnect(); } catch (e) {}
      activeStreamPort = null;
    }
    if (popoverElement) popoverElement.classList.remove('visible');
  }

  // Sync selection to background worker & side panel in real-time
  function syncSelectionToSidePanel(text) {
    if (!text || text.length < 2) return;
    currentSelectedText = text;
    safeSendMessage({
      type: 'SELECTION_CHANGED',
      text: text,
      title: document.title,
      url: window.location.href
    });
  }

  // Named mouseup handler with context invalidation protection
  function handleMouseUp(e) {
    if (!isContextValid()) {
      cleanupOrphanedScript();
      return;
    }

    // If click originated inside our Shadow DOM, ignore completely so UI controls work
    const isInsideHost = e.composedPath
      ? (hostElement && e.composedPath().includes(hostElement))
      : (e.target === hostElement || (hostElement && hostElement.contains(e.target)));
    if (isInsideHost) return;

    setTimeout(() => {
      if (!isContextValid()) return;
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';

      if (text.length >= 2 && !isSelectionInInput(selection)) {
        currentSelectedText = text;
        showPillNearSelection(selection);
        syncSelectionToSidePanel(text);
      } else {
        hidePill();
      }
    }, 10);
  }

  // Named selectionchange handler with debounce and context invalidation protection
  function handleSelectionChange() {
    if (!isContextValid()) {
      cleanupOrphanedScript();
      return;
    }

    clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(() => {
      if (!isContextValid()) return;
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';
      if (text.length >= 2 && !isSelectionInInput(selection)) {
        currentSelectedText = text;
        syncSelectionToSidePanel(text);
      }
    }, 150);
  }

  // Register selection listeners
  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('selectionchange', handleSelectionChange);

  // Check if selection is inside form inputs
  function isSelectionInInput(selection) {
    if (!selection.anchorNode) return false;
    const parent = selection.anchorNode.parentElement;
    if (!parent) return false;
    if (parent.tagName === 'INPUT' || parent.tagName === 'TEXTAREA' || parent.isContentEditable) return true;
    if (parent.closest && parent.closest('input, textarea, [contenteditable="true"]')) return true;
    return false;
  }

  // Position floating pill near selection
  function showPillNearSelection(selection) {
    if (!pillElement || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) return;

    const pillWidth = pillElement.offsetWidth || 440;
    let top = rect.top + window.scrollY - 50;
    let left = rect.left + window.scrollX + (rect.width / 2) - (pillWidth / 2);

    // Flip below selection if too close to page top
    if (rect.top < 65) {
      top = rect.bottom + window.scrollY + 10;
    }

    // Keep within horizontal bounds
    const maxLeft = window.innerWidth - pillWidth - 16;
    if (left > maxLeft) left = Math.max(10, maxLeft);
    if (left < 10) left = 10;

    pillElement.style.top = `${top}px`;
    pillElement.style.left = `${left}px`;
    pillElement.classList.add('visible');
  }

  // Close when clicking outside or pressing Escape
  document.addEventListener('mousedown', (e) => {
    const isInsideHost = e.composedPath
      ? (hostElement && e.composedPath().includes(hostElement))
      : (e.target === hostElement || (hostElement && hostElement.contains(e.target)));
    if (!isInsideHost) {
      hidePill();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hidePill();
      hidePopover();
    }
    // Alt + A shortcut to send current selection to side panel
    if (e.altKey && (e.key === 'a' || e.key === 'A')) {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';
      if (text) {
        openInSidePanel(text);
      } else {
        openInSidePanel(document.title);
      }
    }
    // Alt + S shortcut to snip diagram or formula
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      startSnippingTool();
    }
  });

  // Snipping Tool Implementation
  let snipOverlay = null;

  function startSnippingTool() {
    if (snipOverlay) return;

    snipOverlay = document.createElement('div');
    snipOverlay.className = 'omni-snip-overlay';
    setElementHTML(snipOverlay, `
      <div class="omni-snip-banner">
        <span>📸 Drag to snip diagram, chart, or formula • Press <strong>Esc</strong> to cancel</span>
      </div>
      <div class="omni-snip-box" id="omni-snip-box" style="display: none;">
        <span class="omni-snip-dims" id="omni-snip-dims"></span>
      </div>
    `);

    shadowRoot.appendChild(snipOverlay);

    const snipBox = snipOverlay.querySelector('#omni-snip-box');
    const snipDims = snipOverlay.querySelector('#omni-snip-dims');

    let isDragging = false;
    let startX = 0;
    let startY = 0;

    const onMouseDown = (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      snipBox.style.left = `${startX}px`;
      snipBox.style.top = `${startY}px`;
      snipBox.style.width = '0px';
      snipBox.style.height = '0px';
      snipBox.style.display = 'block';
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const currentX = e.clientX;
      const currentY = e.clientY;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      snipBox.style.left = `${left}px`;
      snipBox.style.top = `${top}px`;
      snipBox.style.width = `${width}px`;
      snipBox.style.height = `${height}px`;
      snipDims.textContent = `${Math.round(width)} × ${Math.round(height)} px`;
    };

    const onMouseUp = (e) => {
      if (!isDragging) return;
      isDragging = false;

      const currentX = e.clientX;
      const currentY = e.clientY;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      cleanupSnip();

      if (width >= 20 && height >= 20) {
        safeSendMessage({
          type: 'PROCESS_SNIP_AREA',
          area: {
            x: left,
            y: top,
            width,
            height,
            dpr: window.devicePixelRatio || 1,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
          }
        });
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        cleanupSnip();
      }
    };

    function cleanupSnip() {
      if (snipOverlay) {
        snipOverlay.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('keydown', onKeyDown);
        snipOverlay.remove();
        snipOverlay = null;
      }
    }

    snipOverlay.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
  }

  // Clean Page Content Extraction for Full Page TL;DR & Chat
  function extractPageContent() {
    const articleElem = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]');
    const container = articleElem ? articleElem.cloneNode(true) : document.body.cloneNode(true);

    // Remove noise elements
    const unwanted = container.querySelectorAll('nav, header, footer, aside, script, style, noscript, svg, iframe, form, button, [aria-hidden="true"]');
    unwanted.forEach(el => el.remove());

    // Clean text
    let text = container.innerText || container.textContent || '';
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n').replace(/[ \t]+/g, ' ').trim();

    // Cap text to ~60,000 characters for optimal response speed
    if (text.length > 60000) {
      text = text.slice(0, 60000) + '\n\n[... Remaining content truncated for performance ...]';
    }

    const words = text ? text.split(/\s+/).filter(Boolean) : [];
    const wordCount = words.length;
    const readingTime = Math.max(1, Math.ceil(wordCount / 220));

    return {
      title: document.title || document.querySelector('h1')?.innerText || 'Current Page',
      url: window.location.href,
      wordCount,
      readingTime,
      text
    };
  }

  // Listen to messages from background worker and side panel
  if (isContextValid() && chrome.runtime.onMessage) {
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!isContextValid()) return;

        if (message.type === 'GET_SELECTION') {
          const selection = window.getSelection();
          const text = selection ? selection.toString().trim() : currentSelectedText;
          sendResponse({ text: text || currentSelectedText });
          return true;
        }

        if (message.type === 'GET_PAGE_CONTENT') {
          const pageData = extractPageContent();
          sendResponse({ success: true, data: pageData });
          return true;
        }

        if (message.type === 'START_SNIP') {
          startSnippingTool();
          sendResponse({ success: true });
          return true;
        }

        if (message.type === 'TRIGGER_QUICK_EXPLAIN') {
          currentSelectedText = message.text || window.getSelection()?.toString() || '';
          if (currentSelectedText) {
            openPopover('Explain this clearly and concisely:');
          }
        }

        if (message.type === 'TRIGGER_QUICK_TRANSLATE') {
          currentSelectedText = message.text || window.getSelection()?.toString() || '';
          if (currentSelectedText) {
            openPopover(null, true);
          }
        }
      });
    } catch (e) {
      // Ignore if context is tearing down
    }
  }

  // Initialize
  initHost();
})();
