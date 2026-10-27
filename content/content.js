// OmniAI In-Page Content Script
(function () {
  // Prevent duplicate injection
  if (window.__omniAiInitialized) return;
  window.__omniAiInitialized = true;

  let currentSelectedText = '';
  let shadowRoot = null;
  let pillElement = null;
  let popoverElement = null;

  // Initialize Isolated Shadow DOM
  function initHost() {
    let host = document.getElementById('omni-ai-companion-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'omni-ai-companion-root';
      document.documentElement.appendChild(host);
    }
    if (!host.shadowRoot) {
      shadowRoot = host.attachShadow({ mode: 'open' });
      injectStyles();
      createElements();
    } else {
      shadowRoot = host.shadowRoot;
    }
  }

  // Inject CSS into Shadow DOM
  function injectStyles() {
    const cssUrl = chrome.runtime.getURL('content/content.css');
    fetch(cssUrl)
      .then(res => res.text())
      .then(css => {
        const style = document.createElement('style');
        style.textContent = css;
        shadowRoot.appendChild(style);
      })
      .catch(err => console.error('Failed to load OmniAI styles:', err));
  }

  // Create UI Elements inside Shadow DOM
  function createElements() {
    // 1. Floating Pill
    pillElement = document.createElement('div');
    pillElement.className = 'omni-floating-pill';
    pillElement.innerHTML = `
      <div class="omni-pill-brand" title="OmniAI Companion">
        <div class="omni-pill-icon">✨</div>
        <span class="omni-pill-title">OmniAI</span>
      </div>
      <button class="omni-btn omni-btn-primary" id="omni-quick-explain-btn" title="Get fast explanation">
        <span class="omni-btn-icon">⚡</span> Explain
      </button>
      <button class="omni-btn" id="omni-open-panel-btn" title="Open in docked Side Panel">
        <span class="omni-btn-icon">💬</span> Side Panel
      </button>
      <button class="omni-btn" id="omni-summarize-btn" title="Summarize in bullets">
        <span class="omni-btn-icon">📋</span> Summary
      </button>
    `;
    shadowRoot.appendChild(pillElement);

    // 2. Popover Card
    popoverElement = document.createElement('div');
    popoverElement.className = 'omni-popover';
    popoverElement.innerHTML = `
      <div class="omni-popover-header">
        <div class="omni-popover-header-left">
          <span style="font-size: 15px;">✨</span>
          <span>OmniAI Quick Insight</span>
        </div>
        <div class="omni-popover-actions">
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
    `;
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
      executeAiQuery(`${q} regarding this text:`);
    };

    followupSendBtn.addEventListener('click', handleFollowup);
    followupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleFollowup();
      e.stopPropagation();
    });
  }

  // Open Popover and query AI
  function openPopover(promptPrefix) {
    if (!currentSelectedText) return;
    hidePill();

    // Position popover near selection
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      let top = rect.bottom + window.scrollY + 10;
      let left = rect.left + window.scrollX;

      // Prevent overflow
      const maxLeft = window.innerWidth - 400;
      if (left > maxLeft) left = Math.max(10, maxLeft);
      if (left < 10) left = 10;

      popoverElement.style.top = `${top}px`;
      popoverElement.style.left = `${left}px`;
    }

    popoverElement.classList.add('visible');
    executeAiQuery(promptPrefix);
  }

  // Execute AI Query via Background Worker
  function executeAiQuery(promptPrefix) {
    const contentEl = shadowRoot.getElementById('omni-popover-content');
    contentEl.innerHTML = `<p><span class="omni-spinner"></span>Thinking...</p>`;

    chrome.runtime.sendMessage(
      {
        type: 'FETCH_GEMINI_EXPLANATION',
        prompt: promptPrefix,
        text: currentSelectedText
      },
      (response) => {
        if (chrome.runtime.lastError) {
          contentEl.innerHTML = `<p style="color: #f87171;">⚠️ Connection error: ${chrome.runtime.lastError.message}</p>`;
          return;
        }

        if (response && response.success) {
          contentEl.innerHTML = renderMarkdown(response.text);
        } else {
          contentEl.innerHTML = `<p style="color: #f87171;">⚠️ ${(response && response.error) || 'Failed to get answer'}</p>`;
        }
      }
    );
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
    chrome.runtime.sendMessage({
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
    if (popoverElement) popoverElement.classList.remove('visible');
  }

  // Sync selection to background worker & side panel in real-time
  function syncSelectionToSidePanel(text) {
    if (!text || text.length < 2) return;
    currentSelectedText = text;
    chrome.runtime.sendMessage({
      type: 'SELECTION_CHANGED',
      text: text,
      title: document.title,
      url: window.location.href
    }).catch(() => {});
  }

  // Selection change listener (Mouse)
  document.addEventListener('mouseup', (e) => {
    // If click inside our Shadow DOM, ignore
    if (e.target && e.target.id === 'omni-ai-companion-root') return;

    setTimeout(() => {
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
  });

  // Debounced listener for selection changes (Keyboard / Double-click)
  let selectionDebounceTimer = null;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionDebounceTimer);
    selectionDebounceTimer = setTimeout(() => {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';
      if (text.length >= 2 && !isSelectionInInput(selection)) {
        currentSelectedText = text;
        syncSelectionToSidePanel(text);
      }
    }, 150);
  });

  // Check if selection is inside form inputs
  function isSelectionInInput(selection) {
    if (!selection.anchorNode) return false;
    const parent = selection.anchorNode.parentElement;
    return parent && (parent.tagName === 'INPUT' || parent.tagName === 'TEXTAREA' || parent.isContentEditable);
  }

  // Position floating pill near selection
  function showPillNearSelection(selection) {
    if (!pillElement || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) return;

    let top = rect.top + window.scrollY - 48;
    let left = rect.left + window.scrollX + (rect.width / 2) - 100;

    // Flip below selection if too close to page top
    if (rect.top < 60) {
      top = rect.bottom + window.scrollY + 10;
    }

    // Keep within horizontal bounds
    if (left < 10) left = 10;
    if (left > window.innerWidth - 280) left = window.innerWidth - 280;

    pillElement.style.top = `${top}px`;
    pillElement.style.left = `${left}px`;
    pillElement.classList.add('visible');
  }

  // Close when clicking outside or pressing Escape
  document.addEventListener('mousedown', (e) => {
    const host = document.getElementById('omni-ai-companion-root');
    if (host && !host.contains(e.target)) {
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
    snipOverlay.innerHTML = `
      <div class="omni-snip-banner">
        <span>📸 Drag to snip diagram, chart, or formula • Press <strong>Esc</strong> to cancel</span>
      </div>
      <div class="omni-snip-box" id="omni-snip-box" style="display: none;">
        <span class="omni-snip-dims" id="omni-snip-dims"></span>
      </div>
    `;

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
        chrome.runtime.sendMessage({
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
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  });

  // Initialize
  initHost();
})();
