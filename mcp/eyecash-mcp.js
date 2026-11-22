#!/usr/bin/env node
'use strict';
/*
 * EyeCash – MCP bridge for Claude Desktop and other MCP clients
 * (stdio → HTTPS of your home server). No dependencies: only Node.js 18+ on the
 * computer running the MCP client.
 *   EYECASH_URL   = https://<server>.<tailnet>.ts.net/mcp
 *   EYECASH_TOKEN = token created in the app (Settings → Claude via MCP)
 * (The older names POC_URL / POC_TOKEN still work.)
 * The server exposes WRITE-ONLY tools: the assistant can add expenses but can
 * never read your data.
 */
const URL_ = process.env.EYECASH_URL || process.env.POC_URL,
  TOKEN = process.env.EYECASH_TOKEN || process.env.POC_TOKEN;
if (!URL_ || !TOKEN) {
  process.stderr.write('Set EYECASH_URL and EYECASH_TOKEN\n');
  process.exit(1);
}

let buf = '';
const queue = [];
let busy = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) queue.push(line);
  }
  pump();
});
process.stdin.on('end', () => {
  const t = setInterval(() => {
    if (!busy && !queue.length) {
      clearInterval(t);
      process.exit(0);
    }
  }, 100);
});

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const line = queue.shift();
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    try {
      const r = await fetch(URL_, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer ' + TOKEN
        },
        body: line,
        signal: AbortSignal.timeout(30000)
      });
      if (r.status === 202) continue;
      const text = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
      process.stdout.write(text.trim() + '\n');
    } catch (e) {
      if (msg && msg.id !== undefined)
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32000, message: 'EyeCash non raggiungibile (VPN attiva?): ' + e.message }
          }) + '\n'
        );
    }
  }
  busy = false;
}
