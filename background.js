// Monocle Background Service Worker (Manifest V3)

// Enable opening side panel on extension icon click
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.log('Panel behavior notice:', err));

// Auto-migrate any deprecated model references (2.5, 2.0, 1.5) to gemini-3.8-flash
function migrateDeprecatedModels() {
  chrome.storage.local.get(['geminiModel', 'workingGeminiModel'], (data) => {
    const updates = {};
    if (!data.geminiModel || data.geminiModel.includes('2.5') || data.geminiModel.includes('2.0') || data.geminiModel.includes('1.5') || data.geminiModel === 'auto') {
      updates.geminiModel = 'gemini-3.8-flash';
    }
    if (!data.workingGeminiModel || data.workingGeminiModel.includes('2.5') || data.workingGeminiModel.includes('2.0') || data.workingGeminiModel.includes('1.5')) {
      updates.workingGeminiModel = 'gemini-3.8-flash';
    }
    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }
  });
}
migrateDeprecatedModels();
chrome.runtime.onInstalled.addListener(migrateDeprecatedModels);
chrome.runtime.onStartup?.addListener(migrateDeprecatedModels);

// Context Menu Setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'monocle_explain_selection',
    title: '⚡ Monocle: Quick Explain "%s"',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'monocle_custom_prompt',
    title: '✨ Monocle: Custom Prompt with Selection...',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'monocle_translate_selection',
    title: '🌐 Monocle: Translate "%s"',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'monocle_send_to_sidepanel',
    title: '💬 Monocle: Open in Side Panel',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'monocle_summarize_page',
    title: '📄 Monocle: 30s TL;DR of Page',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'monocle_snip_diagram',
    title: '📸 Monocle: Snip Diagram / Formula (Alt+S)',
    contexts: ['page', 'image']
  });
});

// Keyboard Command Listener (Alt + S)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'snip_diagram') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'START_SNIP' }).catch(() => {});
    }
  }
});

// Helper: Clean tab title for documents, PDFs, and local files
function getCleanTabTitle(tab) {
  if (!tab) return 'Document';
  if (tab.title && !tab.title.startsWith('file:///')) return tab.title;
  if (tab.url) {
    try {
      const pathname = new URL(tab.url).pathname;
      const filename = pathname.split('/').filter(Boolean).pop();
      if (filename) return decodeURIComponent(filename);
    } catch (e) {}
  }
  return tab.title || 'Document';
}

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  const selectedText = (info.selectionText || '').trim();
  const cleanTitle = getCleanTabTitle(tab);

  if (info.menuItemId === 'monocle_explain_selection' || info.menuItemId === 'omni_explain_selection') {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TRIGGER_QUICK_EXPLAIN',
        text: selectedText
      });
    } catch (err) {
      // Content script is unreachable (e.g. Chrome native PDF viewer, local file without permission, or restricted tab)
      // Fallback: Open side panel and trigger explanation immediately
      await saveContextAndOpenPanel(tab.id, selectedText, cleanTitle, tab.url, 'EXPLAIN');
      safeBroadcast({
        type: 'TRIGGER_EXPLAIN_IN_PANEL',
        text: selectedText
      });
    }
  } else if (info.menuItemId === 'monocle_custom_prompt') {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'OPEN_CUSTOM_PROMPT',
        text: selectedText
      });
    } catch (err) {
      await saveContextAndOpenPanel(tab.id, selectedText, cleanTitle, tab.url, 'CUSTOM_PROMPT');
      safeBroadcast({
        type: 'FOCUS_CUSTOM_PROMPT',
        text: selectedText
      });
    }
  } else if (info.menuItemId === 'monocle_translate_selection') {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TRIGGER_QUICK_TRANSLATE',
        text: selectedText
      });
    } catch (err) {
      // Fallback: Open side panel and trigger translation immediately
      await saveContextAndOpenPanel(tab.id, selectedText, cleanTitle, tab.url, 'TRANSLATE');
      safeBroadcast({
        type: 'TRIGGER_TRANSLATE_IN_PANEL',
        text: selectedText
      });
    }
  } else if (info.menuItemId === 'monocle_send_to_sidepanel' || info.menuItemId === 'omni_send_to_sidepanel') {
    await saveContextAndOpenPanel(tab.id, selectedText, cleanTitle, tab.url);
  } else if (info.menuItemId === 'monocle_summarize_page' || info.menuItemId === 'omni_summarize_page') {
    await saveContextAndOpenPanel(tab.id, selectedText, cleanTitle, tab.url, 'TLDR');
    safeBroadcast({ type: 'TRIGGER_PAGE_TLDR' });
  } else if (info.menuItemId === 'monocle_snip_diagram' || info.menuItemId === 'omni_snip_diagram') {
    chrome.tabs.sendMessage(tab.id, { type: 'START_SNIP' }).catch(() => {});
  }
});

// Helper: Safe broadcast to sidepanel / extension views (clears lastError if sidepanel isn't open)
function safeBroadcast(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      // Accessing chrome.runtime.lastError silences the unhandled error
      void chrome.runtime.lastError;
    });
  } catch (e) {
    // Service worker tearing down
  }
}

// Helper: Save context and open side panel
async function saveContextAndOpenPanel(tabId, text, title, url, pendingAction = null) {
  let cleanTitle = title || 'Web Page';
  if (cleanTitle.startsWith('file:///') && url) {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split('/').filter(Boolean).pop();
      if (filename) cleanTitle = decodeURIComponent(filename);
    } catch (e) {}
  }

  const contextData = {
    text: (text || '').trim(),
    title: cleanTitle,
    url: url || '',
    timestamp: Date.now(),
    pendingAction: pendingAction
  };

  await chrome.storage.local.set({ currentContext: contextData });

  try {
    await chrome.sidePanel.open({ tabId });
  } catch (err) {
    // Fallback for window-based opening if tabId fails
    const win = await chrome.windows.getCurrent();
    if (win?.id) {
      await chrome.sidePanel.open({ windowId: win.id }).catch(() => {});
    }
  }

  // Notify any active sidepanel listening
  safeBroadcast({
    type: 'CONTEXT_UPDATED',
    data: contextData
  });
}

// Listen to messages from content scripts or side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_SIDE_PANEL_WITH_TEXT') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      saveContextAndOpenPanel(tabId, message.text, sender.tab.title, sender.tab.url)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // Keep message channel open for async response
    }
  }

  if (message.type === 'SELECTION_CHANGED') {
    const contextData = {
      text: message.text.trim(),
      title: message.title || (sender.tab ? sender.tab.title : 'Web Page'),
      url: message.url || (sender.tab ? sender.tab.url : ''),
      timestamp: Date.now()
    };
    chrome.storage.local.set({ currentContext: contextData });
    safeBroadcast({
      type: 'CONTEXT_UPDATED',
      data: contextData
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'START_SNIP_REQUEST') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'START_SNIP' }).catch(() => {});
      }
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'PROCESS_SNIP_AREA') {
    const tabId = sender.tab ? sender.tab.id : null;
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, async (dataUrl) => {
      if (chrome.runtime.lastError || !dataUrl) {
        console.error('Failed to capture screen:', chrome.runtime.lastError);
        return;
      }
      const snipPayload = {
        dataUrl,
        area: message.area,
        title: sender.tab?.title || 'Diagram',
        url: sender.tab?.url || '',
        timestamp: Date.now()
      };
      await chrome.storage.local.set({ lastSnipPayload: snipPayload });
      if (tabId) {
        await saveContextAndOpenPanel(tabId, '[Diagram Snip]', sender.tab.title, sender.tab.url);
      }
      setTimeout(() => {
        safeBroadcast({ type: 'SNIP_READY_FOR_CROP', payload: snipPayload });
      }, 350);
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FETCH_GEMINI_VISION') {
    handleGeminiVision(message.prompt, message.base64Image)
      .then((result) => sendResponse({ success: true, text: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'FETCH_GEMINI_EXPLANATION') {
    handleGeminiExplanation(message.prompt, message.text)
      .then((result) => sendResponse({ success: true, text: result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'TEST_GEMINI_KEY') {
    testGeminiKey(message.key)
      .then((res) => sendResponse({ success: true, models: res.models, version: res.version }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'CHECK_FILE_ACCESS') {
    chrome.extension.isAllowedFileSchemeAccess((isAllowed) => {
      sendResponse({ isAllowed: !!isAllowed });
    });
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ status: 'ready' });
  }
});

// Multilingual Translation Prompt Formatter
function buildTranslationPrompt(text, targetLang) {
  const language = targetLang && targetLang !== 'auto' ? targetLang : 'English';
  return `You are a professional multilingual translator and language reading companion.
Translate the following excerpt into ${language} with high precision, natural fluency, and idiomatic nuance:

Excerpt:
"""
${text}
"""

Format your response cleanly in structured markdown as follows:
### 🌐 Translation (${language})
[Provide the fluent, natural translation here]

### 🔍 Key Vocabulary & Nuance Notes
• **[Key Term 1 in original]** → **[Translation]**: [1-sentence contextual meaning, nuance, or technical definition]
• **[Key Term 2 in original]** → **[Translation]**: [1-sentence contextual meaning, nuance, or technical definition]
(List up to 3 notable keywords, idioms, or technical jargon from the excerpt. If the text is short or simple, summarize key message in 1 sentence)`;
}

// Long-lived Port Listener for Real-Time SSE Token Streaming
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'monocle-stream') {
    const abortController = new AbortController();

    port.onDisconnect.addListener(() => {
      abortController.abort();
    });

    port.onMessage.addListener(async (message) => {
      if (message.type === 'START_STREAM') {
        try {
          await handleStreamingRequest(message, (chunk) => {
            try {
              port.postMessage({ type: 'CHUNK', text: chunk });
            } catch (e) {}
          }, abortController.signal);
          try {
            port.postMessage({ type: 'DONE' });
          } catch (e) {}
        } catch (err) {
          if (!abortController.signal.aborted) {
            try {
              port.postMessage({ type: 'ERROR', error: err.message || 'Stream connection error' });
            } catch (e) {}
          }
        }
      }
    });
  }
});

// Central streaming dispatcher
async function handleStreamingRequest(request, onChunk, signal) {
  const { geminiApiKey, geminiModel, targetLanguage, customEndpoint, selectedEngine } = await chrome.storage.local.get([
    'geminiApiKey',
    'geminiModel',
    'targetLanguage',
    'customEndpoint',
    'selectedEngine'
  ]);

  const activeTargetLang = request.targetLanguage || targetLanguage || 'English';

  // 1. Vision Streaming
  if (request.isVision && request.base64Image) {
    if (!geminiApiKey || !geminiApiKey.trim()) {
      throw new Error('Please enter your free Google Gemini API key in Settings to analyze diagrams and formulas.');
    }
    const cleanBase64 = request.base64Image.replace(/^data:image\/[a-z]+;base64,/, '');
    const visionPayload = [
      {
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: cleanBase64
            }
          },
          {
            text: request.prompt || 'Analyze this technical diagram, chart, or mathematical formula. Break down its components, flow, meaning, and key concepts in clear, structured markdown:'
          }
        ]
      }
    ];
    return await streamGeminiContents(geminiApiKey.trim(), visionPayload, geminiModel, onChunk, signal, request.prompt, cleanBase64);
  }

  // 2. Multilingual Translation or Text Prompt
  let fullPrompt = '';
  if (request.isTranslation) {
    fullPrompt = buildTranslationPrompt(request.text, activeTargetLang);
  } else if (request.prompt && request.text) {
    if (request.prompt.includes(request.text)) {
      fullPrompt = request.prompt;
    } else {
      fullPrompt = `${request.prompt}\n\n"${request.text}"`;
    }
  } else {
    fullPrompt = request.prompt || request.text || '';
  }

  // If user provided Gemini API key
  if (geminiApiKey && geminiApiKey.trim()) {
    const textPayload = [
      {
        parts: [{ text: fullPrompt }]
      }
    ];
    return await streamGeminiContents(geminiApiKey.trim(), textPayload, geminiModel, onChunk, signal, fullPrompt);
  }

  // If user configured a custom endpoint and selected custom engine
  if (customEndpoint && customEndpoint.trim() && selectedEngine === 'custom') {
    const response = await fetch(customEndpoint.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: fullPrompt, text: request.text || '' }),
      signal
    });
    if (!response.ok) {
      throw new Error(`Custom endpoint error: HTTP ${response.status}`);
    }
    const data = await response.json();
    const resultText = data.response || data.text || data.message || JSON.stringify(data);
    onChunk(resultText);
    return;
  }

  // Fallback preview when no API key is configured yet (stream simulated tokens)
  await streamSimulatedFallback(request.text || '', request.isTranslation ? `Translation to ${activeTargetLang}` : request.prompt, onChunk, signal);
}

// Simulated fallback typing animation when user hasn't added an API key
async function streamSimulatedFallback(text, prompt, onChunk, signal) {
  const preview = generateQuickSmartAnalysis(text, prompt);
  const words = preview.split(/(\s+)/);
  for (const word of words) {
    if (signal?.aborted) break;
    onChunk(word);
    await new Promise(r => setTimeout(r, 16));
  }
}

// Monocle Developer & Knowledge System Instruction
const MONOCLE_SYSTEM_INSTRUCTION = {
  parts: [{
    text: `You are Monocle AI, an expert AI reading companion and senior software engineer powered by Google Gemini.
Your mission is to provide direct, intelligent, high-value answers.

CRITICAL INSTRUCTIONS FOR CODE & PROGRAMMING:
1. When asked for code, programming solutions, implementations, or scripts: ALWAYS provide COMPLETE, fully working, production-ready code.
2. NEVER give high-level hand-wavy text or placeholders like "// TODO: implement here", "// write your logic here", or "you can use library X". Write the actual working code!
3. Format all code inside standard markdown fenced code blocks with the exact language identifier (e.g., \`\`\`python, \`\`\`javascript, \`\`\`typescript, \`\`\`html, \`\`\`css, \`\`\`bash, \`\`\`sql, etc.).
4. Include clear comments explaining critical logic, proper error handling, and best practices.
5. Provide a brief explanation before or after the code explaining how it works and how to run it.

CRITICAL INSTRUCTIONS FOR GENERAL QUERIES:
1. Be concise, structured, and insightful using clean markdown formatting (headings, bullet points, bold key terms).
2. Directly fulfill the user's specific prompt and intent without unnecessary filler.`
  }]
};

const MONOCLE_SYSTEM_TEXT = MONOCLE_SYSTEM_INSTRUCTION.parts[0].text;

// Helper: Normalize model names to avoid formatting issues
function normalizeGeminiModelName(name) {
  if (!name || name === 'auto') return 'gemini-3.8-flash';
  let cleaned = name.trim().toLowerCase().replace(/^models\//, '');
  if (cleaned.includes('3.8') && cleaned.includes('pro')) return 'gemini-3.8-pro';
  if (cleaned.includes('3.8') && cleaned.includes('flash')) return 'gemini-3.8-flash';
  if (cleaned.includes('3') && cleaned.includes('flash')) return 'gemini-3-flash';
  // Fully intercept and upgrade all deprecated 2.5, 2.0, 1.5 models to gemini-3.8-flash
  if (cleaned.includes('2.5') || cleaned.includes('2.0') || cleaned.includes('1.5')) {
    return 'gemini-3.8-flash';
  }
  cleaned = cleaned.replace(/\s+/g, '-');
  return cleaned || 'gemini-3.8-flash';
}

// Helper: Extract recommended replacement model from Google deprecation error string
function extractRecommendedModel(errMessage) {
  if (!errMessage) return null;
  const match = errMessage.match(/use models\/([a-zA-Z0-9._-]+)/i) ||
                errMessage.match(/models\/([a-zA-Z0-9._-]+).*?(?:recommended|latest)/i);
  if (match && match[1]) {
    return normalizeGeminiModelName(match[1]);
  }
  return null;
}

// Default prioritized candidate list for Google Gemini in 2026 (strictly active models)
const DEFAULT_GEMINI_CANDIDATES = [
  'gemini-3.8-flash',
  'gemini-3-flash',
  'gemini-3.8-pro'
];

// Helper: Classify fatal Google API errors (so we don't waste time retrying)
function checkFatalGeminiError(status, errMessage) {
  const msg = (errMessage || '').toLowerCase();
  // If Google says model is deprecated and recommends an upgrade, don't abort fatal: let self-healing upgrade it!
  if (msg.includes('no longer available') || msg.includes('update your code to use') || msg.includes('not available')) {
    return;
  }
  if (status === 400 && (msg.includes('api_key_invalid') || msg.includes('key not valid') || msg.includes('api key'))) {
    throw new Error('Invalid Google Gemini API key. Please verify your key in Settings (⚙️).');
  }
  if (status === 403) {
    if (msg.includes('permission_denied') || msg.includes('blocked') || msg.includes('not enabled')) {
      throw new Error('Permission denied. Ensure Generative Language API is enabled in Google AI Studio.');
    }
    throw new Error(`Google API 403: ${errMessage || 'Access forbidden'}`);
  }
  if (status === 429 || msg.includes('resource_exhausted') || msg.includes('quota')) {
    throw new Error('Gemini API rate limit reached (Quota Exceeded). Please wait a moment or switch to ChatGPT / Claude tab in the side panel.');
  }
}

// Fast, resilient SSE Stream Engine for Gemini with Interactions API and dynamic fallback
async function streamGeminiContents(apiKey, contentsPayload, preferredModel, onChunk, signal, fallbackPromptText = '', imageBase64 = null) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('Please enter your free Google Gemini API key in Settings (⚙️).');
  }

  // 1. Primary: Google Interactions API (Official 2026 Gemini 3.8+ endpoint)
  async function attemptInteractionsStream(modelName) {
    const cleanName = normalizeGeminiModelName(modelName);
    const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${cleanKey}`;

    let inputPayload;
    if (imageBase64) {
      inputPayload = [
        {
          type: 'text',
          text: fallbackPromptText || 'Analyze this technical diagram, chart, or mathematical formula. Break down its components, flow, meaning, and key concepts in clear, structured markdown:'
        },
        {
          type: 'image',
          mime_type: 'image/png',
          data: imageBase64
        }
      ];
    } else {
      inputPayload = fallbackPromptText || contentsPayload?.[0]?.parts?.[0]?.text || '';
    }

    const requestBody = {
      model: cleanName,
      input: inputPayload,
      system_instruction: MONOCLE_SYSTEM_TEXT,
      stream: true
    };

    const streamController = new AbortController();
    const timer = setTimeout(() => streamController.abort(), 10000);
    const onParentAbort = () => streamController.abort();
    if (signal) signal.addEventListener('abort', onParentAbort);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey
        },
        body: JSON.stringify(requestBody),
        signal: streamController.signal
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onParentAbort);
      if (signal?.aborted) throw new Error('Request was cancelled.');
      throw new Error(`Connection timeout: ${fetchErr.message}`);
    }

    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      const errMsg = (errData && errData.error && errData.error.message) || `HTTP ${res.status}`;
      checkFatalGeminiError(res.status, errMsg);
      throw new Error(errMsg);
    }

    if (!res.body) throw new Error('Response body stream is unavailable.');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let emittedAny = false;

    try {
      while (true) {
        if (signal?.aborted) {
          reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.error) {
                checkFatalGeminiError(parsed.error.code || 400, parsed.error.message);
                throw new Error(parsed.error.message || 'Stream candidate error');
              }

              let chunk = null;
              if (parsed.delta) {
                if (typeof parsed.delta === 'string') {
                  chunk = parsed.delta;
                } else if (parsed.delta.content) {
                  chunk = typeof parsed.delta.content === 'string' ? parsed.delta.content : parsed.delta.content.text;
                } else if (parsed.delta.text) {
                  chunk = parsed.delta.text;
                } else if (parsed.delta.parts && parsed.delta.parts[0]?.text) {
                  chunk = parsed.delta.parts[0].text;
                }
              } else if (parsed.content?.text) {
                chunk = parsed.content.text;
              } else if (parsed.text) {
                chunk = parsed.text;
              } else if (parsed.candidates?.[0]?.content?.parts?.[0]?.text) {
                chunk = parsed.candidates[0].content.parts[0].text;
              }

              if (chunk) {
                emittedAny = true;
                onChunk(chunk);
              }
            } catch (err) {
              if (err.message && !err.message.includes('JSON')) throw err;
            }
          }
        }
      }

      if (buffer.trim().startsWith('data:')) {
        const jsonStr = buffer.trim().slice(5).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(jsonStr);
            const chunk = parsed.delta?.text || parsed.delta?.content?.text || parsed.text || parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (chunk) {
              emittedAny = true;
              onChunk(chunk);
            }
          } catch (e) {}
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (emittedAny) {
      chrome.storage.local.set({
        workingGeminiModel: cleanName,
        workingGeminiVersion: 'interactions'
      });
      return true;
    }

    throw new Error(`Empty response from ${cleanName} interactions`);
  }

  // 2. Secondary: Fallback to streamGenerateContent
  async function attemptLegacyStream(modelName) {
    const cleanName = normalizeGeminiModelName(modelName);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanName}:streamGenerateContent?alt=sse&key=${cleanKey}`;

    const requestBody = {
      contents: contentsPayload,
      systemInstruction: MONOCLE_SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 4096
      }
    };

    // Strict 10-second timeout for stream connection/first token
    const streamController = new AbortController();
    const timer = setTimeout(() => streamController.abort(), 10000);

    const onParentAbort = () => streamController.abort();
    if (signal) signal.addEventListener('abort', onParentAbort);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: streamController.signal
      });
    } catch (fetchErr) {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onParentAbort);
      if (signal?.aborted) throw new Error('Request was cancelled.');
      throw new Error(`Connection timeout: ${fetchErr.message}`);
    }

    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onParentAbort);

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      const errMsg = (errData && errData.error && errData.error.message) || `HTTP ${res.status}`;
      checkFatalGeminiError(res.status, errMsg);
      throw new Error(errMsg);
    }

    if (!res.body) {
      throw new Error('Response body stream is unavailable.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let emittedAny = false;

    try {
      while (true) {
        if (signal?.aborted) {
          reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.error) {
                checkFatalGeminiError(parsed.error.code || 400, parsed.error.message);
                throw new Error(parsed.error.message || 'Stream candidate error');
              }

              if (parsed.promptFeedback?.blockReason) {
                onChunk(`\n\n⚠️ Content blocked by Gemini safety policy: ${parsed.promptFeedback.blockReason}`);
                emittedAny = true;
                return true;
              }

              const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (chunk) {
                emittedAny = true;
                onChunk(chunk);
              }
            } catch (err) {
              if (err.message && !err.message.includes('JSON')) {
                throw err;
              }
            }
          }
        }
      }

      if (buffer.trim().startsWith('data:')) {
        const jsonStr = buffer.trim().slice(5).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(jsonStr);
            const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (chunk) {
              emittedAny = true;
              onChunk(chunk);
            }
          } catch (e) {}
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (emittedAny) {
      chrome.storage.local.set({
        workingGeminiModel: cleanName,
        workingGeminiVersion: 'v1beta'
      });
      return true;
    }

    throw new Error(`Empty response from ${cleanName}`);
  }

  // Build candidate list prioritizing user preference, then working model, then gemini-3.8-flash
  const { workingGeminiModel } = await chrome.storage.local.get(['workingGeminiModel']);

  const normPref = normalizeGeminiModelName(preferredModel);
  const normWorking = normalizeGeminiModelName(workingGeminiModel);

  const candidateModels = [];
  if (normPref && normPref !== 'auto') {
    candidateModels.push(normPref);
  }
  if (normWorking && normWorking !== 'auto' && !candidateModels.includes(normWorking)) {
    candidateModels.push(normWorking);
  }
  DEFAULT_GEMINI_CANDIDATES.forEach(m => {
    if (!candidateModels.includes(m)) candidateModels.push(m);
  });

  // Try candidate models with Interactions API and legacy fallback
  let lastError = null;
  const modelsToAttempt = candidateModels.slice(0, 3);

  for (const m of modelsToAttempt) {
    if (signal?.aborted) break;

    // 1. Try Interactions API stream
    try {
      await attemptInteractionsStream(m);
      return true;
    } catch (intErr) {
      if (intErr.message && (intErr.message.includes('Invalid Google Gemini API key') || intErr.message.includes('rate limit reached') || intErr.message.includes('Permission denied'))) {
        throw intErr;
      }
      console.warn(`Interactions stream with ${m} failed: ${intErr.message}. Trying legacy stream...`);

      // 2. Try legacy streamGenerateContent
      try {
        await attemptLegacyStream(m);
        return true;
      } catch (err) {
        lastError = err;
        if (err.message && (err.message.includes('Invalid Google Gemini API key') || err.message.includes('rate limit reached') || err.message.includes('Permission denied'))) {
          throw err;
        }

        // Self-healing: Check if Google provided a replacement model recommendation (e.g. models/gemini-3.8-flash)
        const rec = extractRecommendedModel(err.message) || extractRecommendedModel(intErr.message);
        if (rec && rec !== m) {
          console.log(`Self-healing: Auto-switching from ${m} to ${rec}`);
          chrome.storage.local.set({ workingGeminiModel: rec, geminiModel: rec });
          try {
            await attemptInteractionsStream(rec);
            return true;
          } catch (recErr) {
            try {
              await attemptLegacyStream(rec);
              return true;
            } catch (recErr2) {
              console.warn(`Recommended model ${rec} attempt failed:`, recErr2.message);
            }
          }
        }

        console.warn(`Streaming with ${m} failed: ${err.message}. Trying next candidate...`);
      }
    }
  }

  // Non-streaming fallback: if SSE streaming dropped or failed, try standard generateContent
  if (fallbackPromptText && !signal?.aborted) {
    try {
      const nonStreamRes = await callGeminiApi(cleanKey, fallbackPromptText, preferredModel);
      if (nonStreamRes) {
        onChunk(nonStreamRes);
        return true;
      }
    } catch (nsErr) {
      console.warn('Non-streaming fallback also failed:', nsErr.message);
      if (nsErr.message && (nsErr.message.includes('Invalid Google Gemini API key') || nsErr.message.includes('rate limit reached') || nsErr.message.includes('Permission denied'))) {
        throw nsErr;
      }
    }
  }

  throw lastError || new Error('Could not stream answer from Gemini. Check API key in Settings.');
}

// Vision Analysis using Gemini Multimodal (Interactions API with generateContent fallback)
async function handleGeminiVision(prompt, base64Image) {
  const { geminiApiKey, geminiModel, workingGeminiModel } = await chrome.storage.local.get(['geminiApiKey', 'geminiModel', 'workingGeminiModel']);

  if (!geminiApiKey || !geminiApiKey.trim()) {
    throw new Error('Please enter your free Google Gemini API key in Settings to analyze diagrams and formulas.');
  }

  const cleanKey = geminiApiKey.trim();
  const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');

  const normPref = normalizeGeminiModelName(geminiModel);
  const normWorking = normalizeGeminiModelName(workingGeminiModel);

  const candidates = [];
  if (normPref && normPref !== 'auto') candidates.push(normPref);
  if (normWorking && normWorking !== 'auto' && !candidates.includes(normWorking)) candidates.push(normWorking);
  DEFAULT_GEMINI_CANDIDATES.forEach(m => {
    if (!candidates.includes(m)) candidates.push(m);
  });

  const visionPrompt = prompt || 'Analyze this technical diagram, chart, or mathematical formula. Break down its components, flow, meaning, and key concepts in clear, structured markdown:';

  let lastError = null;
  for (const model of candidates.slice(0, 3)) {
    const cleanName = normalizeGeminiModelName(model);

    // 1. Try Interactions API with multimodal input
    try {
      const interactionsUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${cleanKey}`;
      const interactionsBody = {
        model: cleanName,
        input: [
          { type: 'text', text: visionPrompt },
          { type: 'image', mime_type: 'image/png', data: cleanBase64 }
        ],
        system_instruction: MONOCLE_SYSTEM_TEXT
      };

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);

      const res = await fetch(interactionsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey
        },
        body: JSON.stringify(interactionsBody),
        signal: ctrl.signal
      }).finally(() => clearTimeout(timer));

      const data = await res.json().catch(() => null);
      if (res.ok) {
        if (data?.output_text) {
          chrome.storage.local.set({ workingGeminiModel: cleanName });
          return data.output_text;
        }
        if (Array.isArray(data?.steps)) {
          let combined = '';
          for (const step of data.steps) {
            if (Array.isArray(step.content)) {
              for (const item of step.content) {
                if (item.text) combined += item.text;
              }
            } else if (step.text) combined += step.text;
          }
          if (combined.trim()) {
            chrome.storage.local.set({ workingGeminiModel: cleanName });
            return combined;
          }
        }
        if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          chrome.storage.local.set({ workingGeminiModel: cleanName });
          return data.candidates[0].content.parts[0].text;
        }
      } else {
        const errMsg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
        checkFatalGeminiError(res.status, errMsg);
      }
    } catch (intErr) {
      if (intErr.message && (intErr.message.includes('Invalid Google Gemini API key') || intErr.message.includes('rate limit reached') || intErr.message.includes('Permission denied'))) {
        throw intErr;
      }
      console.warn(`Interactions vision with ${cleanName} failed: ${intErr.message}. Trying legacy vision...`);
    }

    // 2. Fallback: Legacy generateContent
    try {
      const payload = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: cleanBase64
                }
              },
              {
                text: visionPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048
        }
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanName}:generateContent?key=${cleanKey}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      }).finally(() => clearTimeout(timer));

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const errMsg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
        checkFatalGeminiError(res.status, errMsg);

        const rec = extractRecommendedModel(errMsg);
        if (rec && rec !== cleanName) {
          chrome.storage.local.set({ workingGeminiModel: rec, geminiModel: rec });
          const retryRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${rec}:generateContent?key=${cleanKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const retryData = await retryRes.json().catch(() => null);
          if (retryData?.candidates?.[0]?.content?.parts?.[0]?.text) {
            return retryData.candidates[0].content.parts[0].text;
          }
        }
        throw new Error(errMsg);
      }

      if (data?.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        chrome.storage.local.set({ workingGeminiModel: cleanName });
        return data.candidates[0].content.parts[0].text;
      }
      if (data?.error) {
        checkFatalGeminiError(data.error.code || 400, data.error.message);
        throw new Error(data.error.message);
      }
    } catch (err) {
      lastError = err;
      if (err.message && (err.message.includes('Invalid Google Gemini API key') || err.message.includes('rate limit reached') || err.message.includes('Permission denied'))) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Failed to analyze diagram with Gemini Vision.');
}

// Test connection and retrieve authorized models
async function testGeminiKey(apiKey) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) throw new Error('Please enter an API key.');

  function rankModel(name) {
    const l = name.toLowerCase();
    if (l.includes('3.8-flash')) return 100;
    if (l.includes('3.8-pro')) return 95;
    if (l.includes('3-flash')) return 90;
    if (l.includes('3')) return 85;
    if (l.includes('flash')) return 60;
    if (l.includes('pro')) return 50;
    return 10;
  }

  for (const ver of ['v1beta', 'v1']) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`https://generativelanguage.googleapis.com/${ver}/models?key=${cleanKey}`, { signal: ctrl.signal })
        .finally(() => clearTimeout(timer));

      const data = await res.json();
      if (data.error) {
        checkFatalGeminiError(data.error.code || 400, data.error.message);
        throw new Error(data.error.message || `Code ${data.error.code}`);
      }
      if (data.models && Array.isArray(data.models)) {
        const genModels = data.models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''))
          .filter(name => !name.includes('embedding') && !name.includes('aqa') && !name.includes('imagen'))
          .filter(name => !name.includes('2.5') && !name.includes('2.0') && !name.includes('1.5'));

        if (!genModels.includes('gemini-3.8-flash')) {
          genModels.unshift('gemini-3.8-flash');
        }
        if (!genModels.includes('gemini-3-flash')) {
          genModels.push('gemini-3-flash');
        }
        if (!genModels.includes('gemini-3.8-pro')) {
          genModels.push('gemini-3.8-pro');
        }

        genModels.sort((a, b) => rankModel(b) - rankModel(a));
        return { models: genModels, version: ver };
      }
    } catch (e) {
      if (e.message && !e.message.includes('fetch') && !e.message.includes('timeout')) throw e;
    }
  }
  throw new Error('Could not connect to Google Generative Language service.');
}

// Handle Free Gemini API or Local/Smart fallback
async function handleGeminiExplanation(userPrompt, selectedText) {
  const { geminiApiKey, geminiModel, customEndpoint, selectedEngine } = await chrome.storage.local.get([
    'geminiApiKey',
    'geminiModel',
    'customEndpoint',
    'selectedEngine'
  ]);

  const fullPrompt = `${userPrompt || 'Explain this text simply and clearly in 2 to 3 concise bullet points or a brief paragraph'}:\n\n"${selectedText}"`;

  // 1. If user provided a free Gemini API key
  if (geminiApiKey && geminiApiKey.trim()) {
    return await callGeminiApi(geminiApiKey.trim(), fullPrompt, geminiModel);
  }

  // 2. If user configured a custom local endpoint (e.g. Ollama or Localhost)
  if (customEndpoint && customEndpoint.trim() && selectedEngine === 'custom') {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const response = await fetch(customEndpoint.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, text: selectedText }),
        signal: ctrl.signal
      });
      const data = await response.json();
      return data.response || data.text || data.message || JSON.stringify(data);
    } finally {
      clearTimeout(timer);
    }
  }

  // 3. Fallback preview when no API key is yet configured
  return generateQuickSmartAnalysis(selectedText, userPrompt);
}

// High-speed, resilient Non-Streaming Gemini API Caller (Interactions API with generateContent fallback)
async function callGeminiApi(apiKey, fullPrompt, preferredModel) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) throw new Error('Please enter an API key in Settings.');

  // 1. Primary: Interactions API
  async function attemptInteractions(modelName) {
    const cleanName = normalizeGeminiModelName(modelName);
    const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${cleanKey}`;
    const requestBody = {
      model: cleanName,
      input: fullPrompt,
      system_instruction: MONOCLE_SYSTEM_TEXT
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey
        },
        body: JSON.stringify(requestBody),
        signal: ctrl.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const errMsg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      checkFatalGeminiError(res.status, errMsg);
      throw new Error(errMsg);
    }

    if (data?.output_text) {
      chrome.storage.local.set({ workingGeminiModel: cleanName });
      return data.output_text;
    }

    if (Array.isArray(data?.steps)) {
      let combined = '';
      for (const step of data.steps) {
        if (Array.isArray(step.content)) {
          for (const item of step.content) {
            if (item.text) combined += item.text;
          }
        } else if (step.text) {
          combined += step.text;
        }
      }
      if (combined.trim()) {
        chrome.storage.local.set({ workingGeminiModel: cleanName });
        return combined;
      }
    }

    if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      chrome.storage.local.set({ workingGeminiModel: cleanName });
      return data.candidates[0].content.parts[0].text;
    }

    throw new Error(`Empty response from ${cleanName} interactions`);
  }

  // 2. Secondary: generateContent fallback
  async function attemptGenerate(modelName) {
    const cleanName = normalizeGeminiModelName(modelName);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanName}:generateContent?key=${cleanKey}`;

    const requestBody = {
      contents: [{ parts: [{ text: fullPrompt }] }],
      systemInstruction: MONOCLE_SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.25,
        maxOutputTokens: 4096
      }
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: ctrl.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const errMsg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      checkFatalGeminiError(res.status, errMsg);
      throw new Error(errMsg);
    }

    if (data?.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      chrome.storage.local.set({ workingGeminiModel: cleanName });
      return data.candidates[0].content.parts[0].text;
    }

    if (data?.promptFeedback?.blockReason) {
      return `⚠️ Content was blocked by Gemini safety policy: ${data.promptFeedback.blockReason}`;
    }

    if (data?.error) {
      checkFatalGeminiError(data.error.code || 400, data.error.message);
      throw new Error(data.error.message || `Error calling ${modelName}`);
    }

    throw new Error(`Empty response from ${modelName}`);
  }

  const { workingGeminiModel } = await chrome.storage.local.get(['workingGeminiModel']);

  const normPref = normalizeGeminiModelName(preferredModel);
  const normWorking = normalizeGeminiModelName(workingGeminiModel);

  const candidates = [];
  if (normPref && normPref !== 'auto') candidates.push(normPref);
  if (normWorking && normWorking !== 'auto' && !candidates.includes(normWorking)) candidates.push(normWorking);
  DEFAULT_GEMINI_CANDIDATES.forEach(m => {
    if (!candidates.includes(m)) candidates.push(m);
  });

  let lastError = null;
  for (const m of candidates.slice(0, 3)) {
    // Try Interactions API first
    try {
      return await attemptInteractions(m);
    } catch (intErr) {
      if (intErr.message && (intErr.message.includes('Invalid Google Gemini API key') || intErr.message.includes('rate limit reached') || intErr.message.includes('Permission denied'))) {
        throw intErr;
      }
      console.warn(`Interactions call with ${m} failed: ${intErr.message}. Trying legacy generateContent...`);

      // Try generateContent
      try {
        return await attemptGenerate(m);
      } catch (e) {
        lastError = e;
        if (e.message && (e.message.includes('Invalid Google Gemini API key') || e.message.includes('rate limit reached') || e.message.includes('Permission denied'))) {
          throw e;
        }

        // Self-healing check
        const rec = extractRecommendedModel(e.message) || extractRecommendedModel(intErr.message);
        if (rec && rec !== m) {
          chrome.storage.local.set({ workingGeminiModel: rec, geminiModel: rec });
          try {
            return await attemptInteractions(rec);
          } catch (recErr) {
            try {
              return await attemptGenerate(rec);
            } catch (recErr2) {}
          }
        }
      }
    }
  }

  throw lastError || new Error('Could not get answer from Gemini. Check API key in Settings.');
}

// Fallback intelligent parser when user hasn't added an API key yet
function generateQuickSmartAnalysis(text, prompt) {
  const wordCount = (text || '').trim().split(/\s+/).filter(Boolean).length;
  const isTranslation = prompt && prompt.toLowerCase().includes('translat');
  const isCodeRequest = prompt && /(code|script|function|program|python|javascript|typescript|java|c\+\+|html|css|sql|rust|go|react|vue|implement|algorithm)/i.test(prompt);

  if (isCodeRequest) {
    return `### 💻 Free Gemini API Key Required for Code Generation:\n\n` +
      `You asked for working code: **"${prompt}"**.\n\n` +
      `• Monocle generates full, production-ready code with the Google Gemini API. To enable this, add your **100% Free Gemini API key** in **⚙️ Settings** (top-right of the Side Panel).\n` +
      `• Get your free key instantly with no credit card at [Google AI Studio](https://aistudio.google.com/app/apikey).\n` +
      `• Alternatively, switch to **ChatGPT / Claude / Gemini Web** in the Side Panel tabs to generate code right now without a key!`;
  }

  const sentences = (text || '').split(/(?<=[.?!])\s+/).filter(s => s.trim().length > 0);
  let keyIdea = sentences[0] || (text || '').slice(0, 120);
  if (keyIdea.length > 150) keyIdea = keyIdea.slice(0, 145) + '...';

  if (isTranslation) {
    return `### 🌐 Quick Translation Preview:\n\n` +
      `• **Original Text:** "${keyIdea}"\n` +
      `• **Target:** Selected language (${wordCount} words analyzed)\n` +
      `• **Action:** Enter your **100% Free Google Gemini API key** in Monocle Settings (or open ChatGPT / Claude in the Side Panel) for instant high-precision AI translation with vocabulary nuance breakdown!`;
  }

  return `### 💡 Quick Breakdown:\n\n` +
    `• **Core Idea:** ${keyIdea}\n` +
    `• **Context:** Selection of ~${wordCount} words from the current page.\n` +
    `• **Action:** For deep live answers and code generation, open **ChatGPT / Claude** in the side panel or add your **100% Free Gemini API key** in Monocle settings!`;
}
