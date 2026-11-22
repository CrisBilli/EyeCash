'use strict';
/*
 * EyeCash · server/ai.js
 *
 * Single entry point to the optional AI. Works with Anthropic, any OpenAI-compatible
 * API, or a LOCAL model (Ollama, LM Studio, llama.cpp server, vLLM...).
 */
const {
  AI_LOCAL,
  AI_MODEL,
  AI_MODEL_FAST,
  AI_PROVIDER,
  AI_TIMEOUT,
  ANTHROPIC_KEY,
  OPENAI_BASE,
  OPENAI_KEY
} = require('./config');

/**
 * Sends a prompt to the configured AI and returns the text of the reply.
 * @param {{system:string, messages:Array, fast?:boolean, max_tokens?:number}} req
 * @returns {Promise<string>}
 */
async function callAI({ system, messages, fast, max_tokens }) {
  const model = fast ? AI_MODEL_FAST : AI_MODEL;
  const maxTok = Math.min(+max_tokens || 1500, 16000);
  let r, j;
  if (AI_PROVIDER === 'anthropic') {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model, max_tokens: maxTok, system, messages }),
      signal: AbortSignal.timeout(AI_TIMEOUT)
    });
    j = await r.json().catch(() => ({}));
    if (!r.ok)
      throw Object.assign(new Error((j.error && j.error.message) || 'Errore AI ' + r.status), { code: 502 });
    return (j.content || [])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');
  }
  r = await fetch(OPENAI_BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(OPENAI_KEY ? { authorization: 'Bearer ' + OPENAI_KEY } : {})
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTok,
      ...(AI_LOCAL ? { temperature: 0.2 } : {}), // steadier JSON from small local models
      messages: [{ role: 'system', content: system }, ...messages]
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT)
  });
  j = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error((j.error && (j.error.message || j.error)) || 'Errore AI ' + r.status), {
      code: 502
    });
  return (((j.choices || [])[0] || {}).message || {}).content || '';
}

module.exports = { callAI };
