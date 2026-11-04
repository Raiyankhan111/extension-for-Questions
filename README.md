# PortalMind - AI College Question Assistant Chrome Extension (Manifest V3)

PortalMind is a production-grade Chrome Extension designed to detect questions on college learning portals, extract MCQs, theory prompts, and coding challenges line-by-line, and generate verified answers with step-by-step explanations.

---

## 🌟 Key Features

1. **Intelligent Question Detection**:
   - Automatically detects question boundaries across major LMS platforms (Canvas, Moodle, Blackboard, Google Forms, HackerRank/LeetCode-style portals).
   - Accurately classifies question types: **MCQ**, **Theory / Essay**, or **Coding Challenge**.
   - Extracts options (A, B, C, D) with clean letter mapping.
   - Dynamic DOM observation (`MutationObserver`) supports single-page applications (SPAs) where questions load without full page reloads.

2. **Step-by-Step AI Solutions**:
   - **MCQs**: Identifies the correct option and provides reasoning for why it is correct and why other options are eliminated.
   - **Theory**: Delivers structured, academic explanations tailored to university assessment standards.
   - **Coding**: Produces clean, beginner-friendly code with time & space complexity analysis and a 1-click **Copy Code** button.
   - **High-Yield Tips**: Supplies a short mnemonic or exam tip for each question.

3. **Portal-Safe Architecture**:
   - **Zero Auto-Submissions**: Intentionally ignores and blocks triggers on `Submit`, `Finish`, or `Grade` buttons.
   - **Review Confirmation**: Answers are provided for student review only; students retain full control.
   - **On-Page Visual Highlighting**: Outlines the active question on the webpage with a glow and badge so you always know which item is being reviewed.

4. **Dual AI Integration Architectures**:
   - **Mode A: Secure Self-Hosted Backend Server** (Node.js Express proxy - keeps API keys secret).
   - **Mode B: Direct Google Gemini API** (Enter your free Gemini key in Extension Options).

---

## 📁 Project Architecture

```
college-portal-ai-extension/
├── manifest.json         # Chrome Extension Manifest V3 configuration
├── background.js         # Service Worker: API routing, rate-limiting, and caching
├── content.js            # Injected script: DOM heuristics, question detection, highlights
├── popup.html            # Extension popup interface
├── popup.css             # Modern gradient dashboard styling
├── popup.js              # Controller for popup interactions and navigation
├── options.html          # Extension settings & API configuration UI
├── options.js            # Settings storage and connection testing
├── icons/                # Extension icon assets (16x16, 48x48, 128x128)
├── backend/              # Secure Node.js Express proxy server
│   ├── server.js         # Express server handling /api/solve and /api/health
│   ├── package.json      # Dependencies (express, cors, dotenv)
│   ├── .env.example      # Sample environment configuration
│   └── README.md         # Backend setup guide
└── test-portal/          # Mock college exam portal for immediate local testing
    └── index.html        # Interactive test page with MCQ, Theory, and Coding items
```

---

## 🚀 Quick Setup Instructions

### Step 1: Load the Extension into Google Chrome

1. Open Google Chrome and navigate to:
   ```
   chrome://extensions
   ```
2. In the top-right corner, toggle **Developer mode** to **ON**.
3. In the top-left corner, click **Load unpacked**.
4. Select the directory:
   ```
   /Users/raiyankhan/Downloads/CropCare AI/college-portal-ai-extension
   ```
5. You will see **PortalMind - AI Question Solver & Study Assistant** appear in your extension list! Pin it to your Chrome toolbar for easy access.

---

### Step 2: Configure AI Access (Choose Mode A or Mode B)

#### Option A: Run the Secure Backend Server (Recommended)
1. Open your terminal:
   ```bash
   cd "college-portal-ai-extension/backend"
   npm install
   cp .env.example .env
   ```
2. Edit `.env` and set your Gemini API key (from [Google AI Studio](https://aistudio.google.com/app/apikey)):
   ```env
   PORT=3001
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-1.5-flash
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. In Chrome, right-click the PortalMind extension icon and choose **Options** (or click the Settings gear in the popup). Make sure **Secure Backend Server** is selected with URL `http://localhost:3001/api/solve`, then click **Test Connection**.

#### Option B: Direct Gemini API Key (No Backend Required)
1. Right-click the PortalMind icon in Chrome and click **Options**.
2. Select **Direct Gemini API**.
3. Paste your free Google Gemini API Key and select your preferred model (e.g. `gemini-1.5-flash`).
4. Click **Test Connection** to verify, then click **Save Settings**.

---

### Step 3: Test on the Included College Portal Mock Page

1. In Chrome, open the local test portal:
   ```
   file:///Users/raiyankhan/Downloads/CropCare AI/college-portal-ai-extension/test-portal/index.html
   ```
2. Click the **PortalMind** icon in the Chrome toolbar.
3. Notice how it instantly detects **Question 1 (MCQ)** and lists all options.
4. Click **Generate Answer**:
   - The AI marks the correct option (Stack with O(1) operations).
   - Highlights the correct option in green.
   - Provides step-by-step logic and elimination of other options.
   - Displays a study tip.
5. Click **Next** in the popup:
   - Navigates smoothly to Question 2 (Theory on Dijkstra vs Bellman-Ford) and Question 3 (Coding challenge).
   - Generates working Python/JavaScript code with 1-click copy for coding questions!
