'use strict';
/*
 * EyeCash – local AI provider (Ollama / OpenAI-compatible servers on your own machine).
 * Starts EyeCash with AI_PROVIDER=ollama pointed at a fake Ollama and checks that:
 * the AI is reported as local, requests go to <OLLAMA_URL>/v1/chat/completions with the
 * default model, no API key is sent and the reply is used.
 * Usage:  node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PORT = 19000 + Math.floor(Math.random() * 500);
const OLLAMA_PORT = PORT + 1;
const B = `http://127.0.0.1:${PORT}`;
const seen = [];
let fake, srv, DATA, COOKIE;

function call(method, p, body, cookie) {
  return new Promise((res, rej) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const h = {
      'x-pointofcash': '1',
      ...(data ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    };
    const r = http.request(B + p, { method, headers: h }, s => {
      let t = '';
      s.on('data', c => (t += c));
      s.on('end', () => {
        const sc = s.headers['set-cookie'];
        res({ status: s.statusCode, json: JSON.parse(t || 'null'), cookie: sc ? sc[0].split(';')[0] : null });
      });
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

test.before(async () => {
  fake = http
    .createServer((q, r) => {
      let b = '';
      q.on('data', d => (b += d));
      q.on('end', () => {
        const body = JSON.parse(b || '{}');
        seen.push({ path: q.url, auth: q.headers.authorization, body });
        r.writeHead(200, { 'content-type': 'application/json' });
        if (/RICETTA/.test(JSON.stringify(body.messages)))
          return r.end(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: '{"events":[{"label":"PC","amount":3000,"month":2}],"target":0,"checks":[]}'
                  }
                }
              ]
            })
          );
        const out =
          '{"type":"uscita","amount":9.5,"description":"Bar Centrale","date":"2026-01-10","category":"Ristoranti"}';
        r.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
      });
    })
    .listen(OLLAMA_PORT);
  DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'eyecash-local-ai-'));
  const env = {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    PORT: String(PORT),
    DATA_DIR: DATA,
    AI_PROVIDER: 'ollama',
    OLLAMA_URL: `http://127.0.0.1:${OLLAMA_PORT}/`
  };
  for (const k of ['AI_MODEL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY']) delete env[k];
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await call('GET', '/api/status')).status === 200) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
test.after(() => {
  srv && srv.kill();
  fake && fake.close();
  fs.rmSync(DATA, { recursive: true, force: true });
});

test('Ollama is reported as a local AI, with no key needed', async () => {
  const s = (await call('GET', '/api/status')).json;
  assert.equal(s.ai, true);
  assert.equal(s.ai_provider, 'ollama');
  assert.equal(s.ai_local, true);
});

test('requests go to Ollama with the default model and no API key', async () => {
  const r = await call('POST', '/api/setup', {
    authKey: crypto.createHash('sha256').update('pw').digest('hex')
  });
  COOKIE = r.cookie;
  const p = await call('POST', '/api/ai/parse-entry', { text: 'caffè 9,50 al bar' }, COOKIE);
  assert.equal(p.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, '/v1/chat/completions');
  assert.equal(seen[0].auth, undefined);
  assert.equal(seen[0].body.model, 'qwen2.5:7b');
  assert.equal(seen[0].body.temperature, 0.2);
  assert.match(JSON.stringify(p.json), /Bar Centrale/);
});
test('consulente con Ollama: JSON imposto dal server del modello', async () => {
  seen.length = 0;
  const r = await call(
    'POST',
    '/api/ai/advise',
    { question: 'posso comprare un PC da 3000 a gennaio?' },
    COOKIE
  );
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(seen[0].body.response_format, { type: 'json_object' });
  assert.equal(r.json.events[0].amount, 3000);
});
