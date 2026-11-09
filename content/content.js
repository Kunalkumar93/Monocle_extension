// Monocle In-Page Content Script
(function () {
  // Prevent duplicate injection
  if (window.__monocleInitialized || window.__omniAiInitialized) return;
  window.__monocleInitialized = true;
  window.__omniAiInitialized = true;
  console.log('[Monocle] In-Page Reading Companion active');

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

  // Initialize or ensure Isolated Shadow DOM is ready
  function ensureHost() {
    if (hostElement && pillElement && popoverElement && shadowRoot && hostElement.isConnected) {
      return true;
    }

    let host = document.getElementById('monocle-companion-root') || document.getElementById('omni-ai-companion-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'monocle-companion-root';
      host.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; border: none !important; margin: 0 !important; padding: 0 !important;';
      const parent = document.body || document.documentElement;
      if (!parent) return false;
      parent.appendChild(host);
    }
    hostElement = host;

    if (!hostElement.shadowRoot) {
      try {
        shadowRoot = hostElement.attachShadow({ mode: 'open' });
        injectStyles();
        createElements();
        return true;
      } catch (err) {
        console.warn('[Monocle] shadowRoot attach error:', err);
        return false;
      }
    } else {
      shadowRoot = hostElement.shadowRoot;
      pillElement = shadowRoot.querySelector('.omni-floating-pill');
      popoverElement = shadowRoot.querySelector('.omni-popover');
      if (!pillElement || !popoverElement) {
        injectStyles();
        createElements();
      }
      return true;
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
        position: fixed;
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
        position: fixed;
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

  // Create UI Elements inside Shadow DOM using 100% native DOM APIs (zero Trusted Types or CSP issues)
  function createElements() {
    // 1. Floating Pill
    pillElement = document.createElement('div');
    pillElement.className = 'omni-floating-pill';

    const brandDiv = document.createElement('div');
    brandDiv.className = 'omni-pill-brand';
    brandDiv.title = 'Monocle Companion';
    const brandIcon = document.createElement('div');
    brandIcon.className = 'omni-pill-icon';
    brandIcon.textContent = '🧐';
    const brandTitle = document.createElement('span');
    brandTitle.className = 'omni-pill-title';
    brandTitle.textContent = 'Monocle';
    brandDiv.appendChild(brandIcon);
    brandDiv.appendChild(brandTitle);
    pillElement.appendChild(brandDiv);

    function createPillBtn(id, className, icon, label, title) {
      const btn = document.createElement('button');
      btn.id = id;
      btn.className = className;
      btn.title = title;
      const iconSpan = document.createElement('span');
      iconSpan.className = 'omni-btn-icon';
      iconSpan.textContent = icon;
      btn.appendChild(iconSpan);
      btn.appendChild(document.createTextNode(' ' + label));
      return btn;
    }

    pillElement.appendChild(createPillBtn('omni-quick-explain-btn', 'omni-btn omni-btn-primary', '⚡', 'Explain', 'Get fast explanation'));
    pillElement.appendChild(createPillBtn('omni-translate-btn', 'omni-btn omni-btn-translate', '🌐', 'Translate', 'Translate & explain vocabulary'));
    pillElement.appendChild(createPillBtn('omni-open-panel-btn', 'omni-btn', '💬', 'Side Panel', 'Open in docked Side Panel'));
    pillElement.appendChild(createPillBtn('omni-summarize-btn', 'omni-btn', '📋', 'Summary', 'Summarize in bullets'));

    shadowRoot.appendChild(pillElement);

    // 2. Popover Card
    popoverElement = document.createElement('div');
    popoverElement.className = 'omni-popover';

    const header = document.createElement('div');
    header.className = 'omni-popover-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'omni-popover-header-left';
    headerLeft.style.cssText = 'display: flex; align-items: center; gap: 6px;';
    const hIcon = document.createElement('span');
    hIcon.style.fontSize = '15px';
    hIcon.textContent = '🧐';
    const hTitle = document.createElement('span');
    hTitle.id = 'omni-popover-title';
    hTitle.textContent = 'Monocle Quick Insight';
    headerLeft.appendChild(hIcon);
    headerLeft.appendChild(hTitle);

    const headerActions = document.createElement('div');
    headerActions.className = 'omni-popover-actions';

    const langSelect = document.createElement('select');
    langSelect.className = 'omni-lang-badge';
    langSelect.id = 'omni-popover-lang-select';
    langSelect.title = 'Target Language';
    const languages = [
      ['English', 'EN'],
      ['Spanish', 'ES'],
      ['French', 'FR'],
      ['German', 'DE'],
      ['Chinese (Simplified)', 'ZH'],
      ['Japanese', 'JA'],
      ['Korean', 'KO'],
      ['Hindi', 'HI'],
      ['Portuguese', 'PT'],
      ['Italian', 'IT'],
      ['Russian', 'RU'],
      ['Arabic', 'AR']
    ];
    languages.forEach(([val, label]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      langSelect.appendChild(opt);
    });

    function createIconBtn(id, icon, title) {
      const btn = document.createElement('button');
      btn.className = 'omni-icon-btn';
      btn.id = id;
      btn.title = title;
      btn.textContent = icon;
      return btn;
    }

    headerActions.appendChild(langSelect);
    headerActions.appendChild(createIconBtn('omni-popover-copy-btn', '📋', 'Copy answer'));
    headerActions.appendChild(createIconBtn('omni-popover-expand-btn', '↗', 'Expand into Side Panel'));
    headerActions.appendChild(createIconBtn('omni-popover-close-btn', '✕', 'Close (Esc)'));

    header.appendChild(headerLeft);
    header.appendChild(headerActions);
    popoverElement.appendChild(header);

    const body = document.createElement('div');
    body.className = 'omni-popover-body';
    body.id = 'omni-popover-content';
    const spinnerP = document.createElement('p');
    const spinnerSpan = document.createElement('span');
    spinnerSpan.className = 'omni-spinner';
    spinnerP.appendChild(spinnerSpan);
    spinnerP.appendChild(document.createTextNode('Analyzing selected text...'));
    body.appendChild(spinnerP);
    popoverElement.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'omni-popover-footer';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'omni-quick-input';
    input.id = 'omni-followup-input';
    input.placeholder = 'Ask follow-up question (Enter)...';
    const askBtn = document.createElement('button');
    askBtn.className = 'omni-btn omni-btn-primary';
    askBtn.id = 'omni-followup-send-btn';
    askBtn.textContent = 'Ask';
    footer.appendChild(input);
    footer.appendChild(askBtn);
    popoverElement.appendChild(footer);

    const toast = document.createElement('div');
    toast.className = 'omni-toast';
    toast.id = 'omni-toast';
    toast.textContent = 'Copied to clipboard!';
    popoverElement.appendChild(toast);

    shadowRoot.appendChild(popoverElement);

    bindEvents();
  }

  // Bind Listeners
  function bindEvents() {
    // Pill Brand Click (Open Side Panel)
    const brandEl = shadowRoot.querySelector('.omni-pill-brand');
    if (brandEl) {
      brandEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openInSidePanel(currentSelectedText);
        hidePill();
      });
    }
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
    if (!ensureHost()) return;
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

    // Position popover near selection using viewport coordinates
    const selection = window.getSelection();
    let rect = null;
    if (selection && selection.rangeCount > 0) {
      rect = selection.getRangeAt(0).getBoundingClientRect();
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        rect = activeEl.getBoundingClientRect();
      }
    }

    const popoverWidth = 380;
    const popoverHeight = 320;
    let top = 100;
    let left = Math.max(10, Math.round((window.innerWidth - popoverWidth) / 2));

    if (rect && (rect.width > 0 || rect.height > 0 || rect.top > 0 || rect.left > 0)) {
      top = rect.bottom + 10;
      left = rect.left;

      // Flip above if too close to bottom
      if (top + popoverHeight > window.innerHeight && rect.top > popoverHeight + 20) {
        top = rect.top - popoverHeight - 10;
      }

      // Prevent overflow horizontally
      const maxLeft = window.innerWidth - popoverWidth - 16;
      if (left > maxLeft) left = Math.max(10, maxLeft);
      if (left < 10) left = 10;

      // Ensure inside viewport vertically
      if (top < 10) top = 10;
      if (top + popoverHeight > window.innerHeight - 10) {
        top = Math.max(10, window.innerHeight - popoverHeight - 10);
      }
    }

    popoverElement.style.top = `${Math.round(top)}px`;
    popoverElement.style.left = `${Math.round(left)}px`;

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
      ensureHost();
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';

      if (text.length >= 2 && !isSelectionInInput(selection)) {
        currentSelectedText = text;
        showPillNearSelection(selection);
        syncSelectionToSidePanel(text);
      } else {
        hidePill();
      }
    }, 15);
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

  // Check if selection is inside pure input fields (exclude search/password inputs from popup clutter)
  function isSelectionInInput(selection) {
    if (!selection || !selection.anchorNode) return false;
    const parent = selection.anchorNode.nodeType === 1
      ? selection.anchorNode
      : (selection.anchorNode.parentElement || selection.anchorNode.parentNode);
    if (!parent) return false;
    if (parent.tagName === 'INPUT' || parent.tagName === 'TEXTAREA') return true;
    if (parent.closest && parent.closest('input, textarea')) return true;
    return false;
  }

  // Position floating pill near selection using viewport coordinates
  function showPillNearSelection(selection) {
    if (!ensureHost()) return;
    if (!pillElement) return;

    let rect = null;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      rect = range.getBoundingClientRect();
      if ((!rect || (rect.width === 0 && rect.height === 0)) && range.getClientRects) {
        const clientRects = range.getClientRects();
        if (clientRects.length > 0) rect = clientRects[0];
      }
    }

    // Fallback if selection is inside an input/textarea or has 0 dimensions
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) {
        rect = activeEl.getBoundingClientRect();
      }
    }

    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    const pillWidth = pillElement.offsetWidth || 440;
    const pillHeight = pillElement.offsetHeight || 38;

    // Viewport-relative coordinates (no window.scrollY/X because pill is position: fixed)
    let left = rect.left + (rect.width / 2) - (pillWidth / 2);
    let top = rect.top - pillHeight - 10;

    // Flip below selection if too close to viewport top
    if (top < 10) {
      top = rect.bottom + 10;
    }

    // Keep within horizontal viewport bounds with 10px margin
    const maxLeft = window.innerWidth - pillWidth - 10;
    if (left > maxLeft) left = Math.max(10, maxLeft);
    if (left < 10) left = 10;

    // Keep within vertical viewport bounds
    if (top + pillHeight > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - pillHeight - 10);
    }

    pillElement.style.top = `${Math.round(top)}px`;
    pillElement.style.left = `${Math.round(left)}px`;
    pillElement.classList.add('visible');
  }

  // Register selection and action listeners
  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('selectionchange', handleSelectionChange);

  // Trigger pill on copy event (Ctrl+C, Cmd+C, or context-menu copy)
  document.addEventListener('copy', () => {
    if (!isContextValid()) return;
    setTimeout(() => {
      if (!isContextValid()) return;
      ensureHost();
      let text = '';
      const selection = window.getSelection();
      if (selection) {
        text = selection.toString().trim();
      }
      if (!text) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          const s = active.selectionStart;
          const e = active.selectionEnd;
          if (s !== null && e !== null && e > s) {
            text = active.value.substring(s, e).trim();
          }
        }
      }
      if (text.length >= 2) {
        currentSelectedText = text;
        showPillNearSelection(selection);
        syncSelectionToSidePanel(text);
      }
    }, 25);
  });

  // Trigger pill on keyboard text selection (Shift + Arrows, Ctrl+A)
  document.addEventListener('keyup', (e) => {
    if (!isContextValid()) return;
    if (e.shiftKey || ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A'))) {
      setTimeout(() => {
        if (!isContextValid()) return;
        ensureHost();
        const selection = window.getSelection();
        const text = selection ? selection.toString().trim() : '';
        if (text.length >= 2 && !isSelectionInInput(selection)) {
          currentSelectedText = text;
          showPillNearSelection(selection);
          syncSelectionToSidePanel(text);
        }
      }, 40);
    }
  });

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
    if (!ensureHost()) return;
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
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureHost);
  } else {
    ensureHost();
  }
})();
