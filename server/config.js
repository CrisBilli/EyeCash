'use strict';
/*
 * EyeCash · server/config.js
 *
 * Configuration from environment variables (port, data folder, AI provider,
 * timezone) and project-wide constants. Read once at start-up.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..'); // project root (folder with public/ and VERSION)
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PUB = path.join(ROOT, 'public');
/*
 * Optional AI. Nothing in the app requires it. AI_PROVIDER selects where requests go:
 *   anthropic  Claude API (ANTHROPIC_API_KEY)
 *   openai     any OpenAI-compatible "chat completions" API (OPENAI_API_KEY, OPENAI_BASE_URL):
 *              OpenAI, OpenRouter, Mistral, Groq...
 *   ollama     a model running with Ollama on your own machine: no key, nothing leaves
 *              your network (OLLAMA_URL, default http://localhost:11434)
 *   local      any other local OpenAI-compatible server: LM Studio, llama.cpp, vLLM
 *              (OPENAI_BASE_URL, e.g. http://localhost:1234/v1)
 * Without a provider configured the app works the same, minus the AI helpers.
 */
const AI_PROVIDER = (
  process.env.AI_PROVIDER ||
  (process.env.OPENAI_BASE_URL || process.env.OPENAI_API_KEY ? 'openai' : 'anthropic')
).toLowerCase();
const AI_LOCAL = AI_PROVIDER === 'ollama' || AI_PROVIDER === 'local';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE = (
  process.env.OPENAI_BASE_URL ||
  (AI_PROVIDER === 'ollama'
    ? (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '') + '/v1'
    : 'https://api.openai.com/v1')
).replace(/\/+$/, '');
const AI_MODEL =
  process.env.AI_MODEL ||
  (AI_PROVIDER === 'anthropic' ? 'claude-sonnet-5-5' : AI_PROVIDER === 'ollama' ? 'qwen3:8b' : '');
const AI_MODEL_FAST =
  process.env.AI_MODEL_FAST || (AI_PROVIDER === 'anthropic' ? 'claude-haiku-5-5' : AI_MODEL);
/* local models can be slow on small servers: give them more time (seconds) */
const AI_TIMEOUT = 1000 * +(process.env.AI_TIMEOUT || (AI_LOCAL ? 600 : 300));
const AI_ON =
  AI_PROVIDER === 'anthropic'
    ? !!ANTHROPIC_KEY
    : AI_PROVIDER === 'ollama'
      ? !!AI_MODEL
      : !!(AI_MODEL && (OPENAI_KEY || process.env.OPENAI_BASE_URL));
const AI_PDF = AI_PROVIDER === 'anthropic' && AI_ON;
const VERSION = (() => {
  try {
    return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim();
  } catch {
    return 'dev';
  }
})();
const KDF_ITER = 600000;
const SESSION_DAYS = 30;
const APP_TZ = process.env.APP_TZ || 'Europe/Rome';
const localDate = (d = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: APP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
const KEEP_HISTORY = 200;
const KEEP_BACKUP_DAYS = 90;

module.exports = {
  AI_LOCAL,
  AI_TIMEOUT,
  AI_MODEL,
  AI_MODEL_FAST,
  AI_ON,
  AI_PDF,
  AI_PROVIDER,
  ANTHROPIC_KEY,
  APP_TZ,
  DATA,
  HOST,
  KDF_ITER,
  KEEP_BACKUP_DAYS,
  KEEP_HISTORY,
  OPENAI_BASE,
  OPENAI_KEY,
  PORT,
  PUB,
  SESSION_DAYS,
  VERSION,
  localDate
};
