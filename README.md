# OmniAI ✨ — In-Tab AI Reading Companion & Multi-Model Side Panel

> **Read any article, technical paper, or documentation on any browser without ever switching tabs, copying text back-and-forth, or taking screenshots.**

OmniAI is an open-source **Manifest V3 Chrome & Chromium extension** that brings your favorite AI models directly into your current reading tab via an **in-page floating action card** and a **persistent multi-model side panel**.

---

## 💡 Why OmniAI?

When reading complex articles or technical documentation, switching tabs to paste context into ChatGPT or Claude breaks your reading flow. 

**OmniAI solves this seamlessly:**
* **Highlight any text** $\rightarrow$ A sleek floating action pill appears right next to your cursor.
* **Instant In-Page Card** $\rightarrow$ Get an immediate explanation or summary right on the webpage without losing your place.
* **Docked Side Panel** $\rightarrow$ Sits alongside your reading material with 1-click switching between **ChatGPT, Claude, Gemini, Perplexity**, or **Fast Free Native AI**.
* **Zero Cost:** Works completely free with your existing web accounts or with a 100% free Google Gemini API key (no credit card required).

---

## ✨ Features

### 1. ⚡ Instant In-Page Action Pill & Popover Card
* **Non-Intrusive:** Select text on any article to display a sleek floating pill.
* **Instant Explanations:** Click **"⚡ Explain"** for a quick in-page popover card that breaks down difficult terms into plain English.
* **3-Bullet Summaries:** Click **"📋 Summary"** to distill long paragraphs into 3 bullet points.
* **Follow-Up Questions:** Type questions directly inside the in-page popover without opening any other windows.
* **Complete CSS Isolation:** Built inside an isolated Shadow DOM (`ShadowRoot`), ensuring it never conflicts with or breaks host webpage styles.

### 2. 💬 Docked Multi-Model Side Panel (Same Tab, Zero Switching)
A persistent native Chrome Side Panel docked on the right side of your window:
* **🤖 ChatGPT (Web):** Use your regular free `chatgpt.com` account with full chat history.
* **🧠 Claude (Web):** Use your regular free `claude.ai` account.
* **💎 Google Gemini (Web):** Direct access to `gemini.google.com/app`.
* **🔍 Perplexity (Web):** Direct web search and source-grounded answers via `perplexity.ai`.
* **⚡ Fast Free AI (Native):** Clean, lightning-fast native chat UI powered by Google's free Gemini API or local Ollama.
* **🌐 Custom AI App:** Connect your own localhost (`http://localhost:3000`) or custom-hosted AI endpoints.

### 3. 📌 Real-Time Live Context Sync ("The Magic Bar")
* As you read and highlight sentences on the page, the side panel **automatically captures the text in real-time**.
* **1-Click Prompt Chips:**
  * `💡 Explain Simply`
  * `📋 Summarize`
  * `🎨 Analogy`
  * `⚖️ Critique / Counter-arguments`
  * `📋 Copy Context`

### 4. 🔑 Resilient Free Gemini AI with Live Model Auto-Discovery
* Supports **Google Gemini 2.0 Flash / 2.5 Flash** via Google AI Studio's 100% free tier (up to 1,500 requests/day at zero cost, no credit card required).
* **Self-Healing Auto-Discovery:** OmniAI queries Google's live `ModelService.ListModels` to inspect your key's authorized models dynamically and automatically picks the best available free generation model.
* **`🔍 Test` Connection Button:** Easily verify your key in Settings and see all available models in real time.

---

## 🚀 60-Second Installation Guide

### Works in Google Chrome, Microsoft Edge, Brave, and Opera

1. **Clone or Download this repository:**
   ```bash
   git clone https://github.com/Kunalkumar93/Omniai_extension.git
   ```
2. Open your browser and go to the extensions manager:
   * **Chrome / Brave:** `chrome://extensions`
   * **Edge:** `edge://extensions`
3. Turn **ON** the **"Developer mode"** toggle (usually located in the top-right corner).
4. Click the **"Load unpacked"** button in the top-left.
5. Select the `Omniai_extension` folder.
6. **(Recommended):** Pin the **OmniAI** icon to your browser toolbar for quick 1-click access.

> [!TIP]
> **Testing Local Files (like `test-article.html`):**
> If you test the extension on local computer files (`file:///...`), Chrome disables extensions on local files by default. On `chrome://extensions`, click **"Details"** on the OmniAI card and toggle **ON "Allow access to file URLs"**. (Live web pages like Wikipedia or Medium work automatically without any extra permissions).

---

## 🧪 Quick Walkthrough (How to Test)

1. Open the included interactive test page in your browser:
   * Double-click `test-article.html` in the extension folder (or open any Wikipedia/Medium article).
2. **Highlight any technical sentence** (e.g., *"variational quantum eigensolvers"* or *"quantum superposition"*).
3. **Test the Floating Pill:**
   * Click **⚡ Explain** $\rightarrow$ An instant glassmorphic card will appear explaining the concept.
   * Type a question in the quick input and press `Enter`.
4. **Test the Docked Side Panel:**
   * Click **💬 Side Panel** (or press `Alt + A`).
   * The side panel opens docked on the right side of your tab with your highlighted text already loaded in the **Selected Context** bar.
   * Toggle between **Fast Free AI**, **ChatGPT**, **Claude**, **Gemini**, and **Perplexity** using the top tab bar.

---

## ⚙️ Adding a 100% Free Gemini API Key (Optional)

For sub-second responses inside the in-page floating bubble and the Fast Free AI tab:
1. Open the OmniAI side panel and click **⚙️ Settings** (top-right gear icon).
2. Click the link to open **[Google AI Studio](https://aistudio.google.com/apikey)**.
3. Click **"Create API key"** (takes 10 seconds, zero cost, no credit card required).
4. Paste the key into OmniAI Settings.
5. Click **`🔍 Test`** $\rightarrow$ A green message `✅ Connected! Found X active models` will confirm your connection.
6. Click **Save Preferences**.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + A` | Open OmniAI Side Panel & send currently highlighted text |
| `Esc` | Dismiss the in-page floating pill and popover card |
| `Enter` | Send message in Fast Free AI chat |
| `Shift + Enter` | New line in chat textarea |

---

## 📁 Repository Structure

```
Omniai_extension/
├── manifest.json         # Chrome Manifest V3 configuration & permissions
├── background.js         # Service worker: SidePanel control, context menus, Gemini API proxy
├── rules/
│   └── rules.json        # DeclarativeNetRequest rules (strips iframe header restrictions)
├── content/
│   ├── content.js        # Content script: Text selection detection & Shadow DOM popover
│   └── content.css       # Isolated modern CSS design for floating pill and popover
├── sidepanel/
│   ├── sidepanel.html    # Side panel UI layout & Settings drawer
│   ├── sidepanel.css     # Dark mode glassmorphism styles & responsive layout
│   └── sidepanel.js      # App switcher, active tab sync, and Fast AI chat engine
├── icons/                # Extension icon assets (16x16, 32x32, 48x48, 128x128)
├── test-article.html     # Interactive testing article with scientific terminology
└── README.md             # Documentation and quickstart guide
```

---

## 🔒 Privacy & Permissions

* **100% Client-Side:** OmniAI runs entirely in your browser. There is no external middleman server collecting your browsing data or reading history.
* **Direct Connections:** All API requests go directly from your browser to Google AI Studio or your local Ollama/custom server.
* **Storage:** API keys and user preferences are stored securely in your browser's private `chrome.storage.local`.

---

## 📄 License

MIT License. Free to use, modify, and distribute. Contributions and feature requests are welcome!
