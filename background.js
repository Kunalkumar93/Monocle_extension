// Monocle Background Service Worker (Manifest V3)

// Enable opening side panel on extension icon click
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.log('Panel behavior notice:', err));

// Context Menu Setup
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'monocle_explain_selection',
    title: '⚡ Monocle: Quick Explain "%s"',
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

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;
  const selectedText = info.selectionText || '';

  if (info.menuItemId === 'monocle_explain_selection' || info.menuItemId === 'omni_explain_selection') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'TRIGGER_QUICK_EXPLAIN',
      text: selectedText
    }).catch(() => {});
  } else if (info.menuItemId === 'monocle_send_to_sidepanel' || info.menuItemId === 'omni_send_to_sidepanel') {
    await saveContextAndOpenPanel(tab.id, selectedText, tab.title, tab.url);
  } else if (info.menuItemId === 'monocle_summarize_page' || info.menuItemId === 'omni_summarize_page') {
    await saveContextAndOpenPanel(tab.id, '', tab.title, tab.url);
    setTimeout(() => {
      safeBroadcast({ type: 'TRIGGER_PAGE_TLDR' });
    }, 400);
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
async function saveContextAndOpenPanel(tabId, text, title, url) {
  const contextData = {
    text: text.trim(),
    title: title || 'Web Page',
    url: url || '',
    timestamp: Date.now()
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

  if (message.type === 'PING') {
    sendResponse({ status: 'ready' });
  }
});

// Vision Analysis using Gemini Multimodal
async function handleGeminiVision(prompt, base64Image) {
  const { geminiApiKey, geminiModel } = await chrome.storage.local.get(['geminiApiKey', 'geminiModel']);

  if (!geminiApiKey || !geminiApiKey.trim()) {
    throw new Error('Please enter your free Google Gemini API key in Settings to analyze diagrams and formulas.');
  }

  // Strip data URL prefix if present
  const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '');

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
            text: prompt || 'Analyze this technical diagram, chart, or mathematical formula. Break down its components, flow, meaning, and key concepts in clear, structured markdown:'
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 800
    }
  };

  const cleanKey = geminiApiKey.trim();
  const { workingGeminiModel, workingGeminiVersion } = await chrome.storage.local.get(['workingGeminiModel', 'workingGeminiVersion']);
  
  const candidates = [
    workingGeminiModel,
    geminiModel && geminiModel !== 'auto' ? geminiModel : null,
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-latest'
  ].filter(Boolean);

  let lastError = null;
  for (const model of [...new Set(candidates)]) {
    for (const ver of [workingGeminiVersion || 'v1beta', 'v1']) {
      try {
        const cleanName = model.replace(/^models\//, '');
        const url = `https://generativelanguage.googleapis.com/${ver}/models/${cleanName}:generateContent?key=${cleanKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
          chrome.storage.local.set({ workingGeminiModel: cleanName, workingGeminiVersion: ver });
          return data.candidates[0].content.parts[0].text;
        }
        if (data.error) {
          lastError = new Error(data.error.message || 'Vision API Error');
        }
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw lastError || new Error('Failed to analyze diagram with Gemini Vision.');
}

// Test connection and retrieve authorized models
async function testGeminiKey(apiKey) {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) throw new Error('Please enter an API key.');

  for (const ver of ['v1beta', 'v1']) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/${ver}/models?key=${cleanKey}`);
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error.message || `Code ${data.error.code}`);
      }
      if (data.models && Array.isArray(data.models)) {
        const genModels = data.models
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''));
        return { models: genModels, version: ver };
      }
    } catch (e) {
      if (e.message && !e.message.includes('fetch')) throw e;
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
    try {
      return await callGeminiApi(geminiApiKey.trim(), fullPrompt, geminiModel);
    } catch (e) {
      console.warn('Gemini API call failed:', e);
      throw e;
    }
  }

  // 2. If user configured a custom local endpoint (e.g. Ollama or Localhost)
  if (customEndpoint && customEndpoint.trim() && selectedEngine === 'custom') {
    try {
      const response = await fetch(customEndpoint.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, text: selectedText })
      });
      const data = await response.json();
      return data.response || data.text || data.message || JSON.stringify(data);
    } catch (e) {
      throw new Error(`Custom endpoint connection failed: ${e.message}`);
    }
  }

  // 3. Fallback preview when no API key is yet configured
  return generateQuickSmartAnalysis(selectedText, userPrompt);
}

// Resilient Gemini Generator with automatic model discovery via Google's ListModels
async function callGeminiApi(apiKey, fullPrompt, preferredModel) {
  const cleanKey = apiKey.trim();

  // Helper to call generateContent
  async function attemptGenerate(apiVersion, modelName) {
    const cleanName = modelName.replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${cleanName}:generateContent?key=${cleanKey}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 700
        }
      })
    });

    const data = await res.json();
    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      // Cache verified working model and version
      chrome.storage.local.set({
        workingGeminiModel: cleanName,
        workingGeminiVersion: apiVersion
      });
      return data.candidates[0].content.parts[0].text;
    }

    if (data.error) {
      throw new Error(data.error.message || `Error calling ${modelName}`);
    }

    throw new Error(`Empty response from ${modelName}`);
  }

  // 1. If user has a manually specified model (not 'auto'), try it first
  if (preferredModel && preferredModel !== 'auto') {
    try {
      return await attemptGenerate('v1beta', preferredModel);
    } catch (e) {
      try {
        return await attemptGenerate('v1', preferredModel);
      } catch (err2) {
        console.warn(`User preferred model ${preferredModel} failed, auto-discovering...`, err2);
      }
    }
  }

  // 2. Check if we have a recently cached working model that still works
  const { workingGeminiModel, workingGeminiVersion } = await chrome.storage.local.get([
    'workingGeminiModel',
    'workingGeminiVersion'
  ]);

  if (workingGeminiModel) {
    try {
      return await attemptGenerate(workingGeminiVersion || 'v1beta', workingGeminiModel);
    } catch (e) {
      console.warn(`Cached model ${workingGeminiModel} expired or failed, re-discovering...`, e);
      chrome.storage.local.remove(['workingGeminiModel']);
    }
  }

  // 3. Query Google's ModelService.ListModels to see the exact models authorized for this key
  let availableModels = [];
  let workingApiVersion = 'v1beta';

  for (const ver of ['v1beta', 'v1']) {
    try {
      const listUrl = `https://generativelanguage.googleapis.com/${ver}/models?key=${cleanKey}`;
      const listRes = await fetch(listUrl);
      const listData = await listRes.json();

      if (listData.error) {
        // If Google explicitly rejected the key (e.g. invalid key, quota, or service disabled)
        throw new Error(`Google API: ${listData.error.message} (Code ${listData.error.code || listData.error.status})`);
      }

      if (listData.models && Array.isArray(listData.models) && listData.models.length > 0) {
        availableModels = listData.models.filter(m =>
          m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')
        );
        workingApiVersion = ver;
        break;
      }
    } catch (err) {
      // If error was an explicit Google error message, rethrow to inform user
      if (err.message && err.message.startsWith('Google API:')) {
        throw err;
      }
      console.warn(`ListModels on ${ver} failed:`, err);
    }
  }

  if (availableModels.length === 0) {
    throw new Error('No generation models found for this API key. Verify that the Generative Language API is enabled in your Google Cloud / AI Studio project.');
  }

  // Log discovered models for visibility
  console.log(`Discovered ${availableModels.length} models on ${workingApiVersion}:`, availableModels.map(m => m.name));

  // Smart model ranking:
  // 1. Newest 2.5/2.0 Flash
  // 2. Any other Flash model
  // 3. Pro models
  // 4. Any other supported model
  function getModelScore(name) {
    const lower = name.toLowerCase();
    if (lower.includes('2.5-flash')) return 100;
    if (lower.includes('2.0-flash') && !lower.includes('lite')) return 90;
    if (lower.includes('2.0-flash-lite')) return 85;
    if (lower.includes('flash-latest')) return 80;
    if (lower.includes('1.5-flash')) return 75;
    if (lower.includes('flash')) return 70;
    if (lower.includes('pro')) return 60;
    return 10;
  }

  availableModels.sort((a, b) => getModelScore(b.name) - getModelScore(a.name));

  // Try discovered models in ranked order
  let lastDiscoveredError = null;
  for (const m of availableModels) {
    try {
      const cleanName = m.name.replace(/^models\//, '');
      return await attemptGenerate(workingApiVersion, cleanName);
    } catch (err) {
      lastDiscoveredError = err;
      console.warn(`Attempt with discovered model ${m.name} failed:`, err.message);
    }
  }

  throw lastDiscoveredError || new Error('Failed to generate content with available models.');
}

// Fallback intelligent parser when user hasn't added an API key yet
function generateQuickSmartAnalysis(text, prompt) {
  const wordCount = text.trim().split(/\s+/).length;
  const sentences = text.split(/(?<=[.?!])\s+/).filter(s => s.trim().length > 0);
  
  let keyIdea = sentences[0] || text.slice(0, 120);
  if (keyIdea.length > 150) keyIdea = keyIdea.slice(0, 145) + '...';

  return `### 💡 Quick Breakdown:\n\n` +
    `• **Core Idea:** ${keyIdea}\n` +
    `• **Context:** Selection of ~${wordCount} words from the current page.\n` +
    `• **Action:** For deep live answers, open **ChatGPT / Claude** in the side panel or add your **100% Free Gemini API key** in OmniAI settings!`;
}
