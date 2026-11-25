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
 * @param {{system:string, messages:Array, fast?:boolean, max_tokens?:number, json?:boolean}} req
 *   json: the answer must be one JSON object; with Ollama this is enforced by the server,
 *   which makes small local models much more reliable.
 * @returns {Promise<string>}
 */
async function callAI({ system, messages, fast, max_tokens, json }) {
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
  const send = forceJSON =>
    fetch(OPENAI_BASE + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(OPENAI_KEY ? { authorization: 'Bearer ' + OPENAI_KEY } : {})
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTok,
        ...(AI_LOCAL ? { temperature: 0.2 } : {}), // steadier JSON from small local models
        ...(forceJSON ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: system }, ...messages]
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT)
    });
  const forceJSON = !!json && AI_PROVIDER === 'ollama';
  r = await send(forceJSON);
  // an older server that does not know response_format: ask again without it
  if (forceJSON && r.status === 400) r = await send(false);
  j = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error((j.error && (j.error.message || j.error)) || 'Errore AI ' + r.status), {
      code: 502
    });
  // reasoning models (e.g. qwen3) may put their thinking in the text: drop it
  return String((((j.choices || [])[0] || {}).message || {}).content || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
}

/**
 * One round of the advisor chat with tools (OpenAI-compatible function calling, as
 * offered by Ollama). Only ever called for LOCAL models: see /api/ai/chat.
 * Returns { content, tool_calls: [{ id, name, arguments }] }.
 */
async function callAIChat({ messages, tools }) {
  const r = await fetch(OPENAI_BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(OPENAI_KEY ? { authorization: 'Bearer ' + OPENAI_KEY } : {})
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.3,
      max_tokens: 2000,
      messages,
      ...(tools && tools.length ? { tools } : {})
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && (j.error.message || j.error)) || 'Errore AI ' + r.status;
    throw Object.assign(
      new Error(
        /tool/i.test(String(msg))
          ? 'Il modello locale non supporta gli strumenti: usa ad esempio qwen3:8b o llama3.1:8b (' +
              msg +
              ')'
          : String(msg)
      ),
      { code: 502 }
    );
  }
  const m = ((j.choices || [])[0] || {}).message || {};
  let content = String(m.content || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim();
  let calls = (m.tool_calls || []).map((c, i) => ({
    id: c.id || 'call_' + i,
    name: c.function && c.function.name,
    arguments: parseArgs(c.function && c.function.arguments)
  }));
  // some small models write the call as text instead of using the tools field
  if (!calls.length && tools && tools.length) {
    const t =
      content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/) ||
      content.match(/^\s*(\{[\s\S]*"name"[\s\S]*\})\s*$/);
    if (t) {
      const o = parseArgs(t[1]);
      if (o && typeof o.name === 'string' && tools.some(x => x.function.name === o.name)) {
        calls = [{ id: 'call_0', name: o.name, arguments: parseArgs(o.arguments || o.parameters) }];
        content = '';
      }
    }
  }
  return { content, tool_calls: calls.filter(c => c.name) };
}
function parseArgs(a) {
  if (a && typeof a === 'object') return a;
  try {
    return JSON.parse(a || '{}') || {};
  } catch (e) {
    return {};
  }
}

module.exports = { callAI, callAIChat };
