# PortalMind Secure AI Backend

A lightweight Express proxy server that securely communicates with Google Gemini API without exposing API keys inside the Chrome Extension client.

## Quick Start

### 1. Install Dependencies
```bash
cd college-portal-ai-extension/backend
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and insert your Gemini API key:
```bash
cp .env.example .env
```
Edit `.env`:
```env
PORT=3001
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-1.5-flash
```

### 3. Start Server
```bash
npm start
```
The server will start at `http://localhost:3001`.

## Endpoints

- `GET /api/health` - Check server health and API key presence
- `POST /api/solve` - Receives question JSON payload and returns structured answer, explanation, code snippet, and study tips.
