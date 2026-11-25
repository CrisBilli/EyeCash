#!/usr/bin/env node
/*
 * EyeCash · bench/run.js — the advisor benchmark.
 *
 * Asks 104 questions about a made-up person to a model (Ollama, LM Studio, Strata or any
 * OpenAI-compatible server), runs the advisor tools on the made-up data, scores every
 * answer automatically and writes a JSON file (to send for review) and a Markdown report.
 * No real data is used. Needs Node 18 or newer, no packages.
 *
 *   node bench/run.js                                   # Ollama on this PC, qwen3:8b
 *   node bench/run.js --model qwen3.5:9b
 *   node bench/run.js --url http://pc-casa:11434/v1 --model qwen3:8b
 *   node bench/run.js --only q001,q072 --verbose        # a few questions, printing answers
 *   node bench/run.js --cat pareri                      # one category
 */
'use strict';
const fs = require('fs');
const path = require('path');
const EN = require('../public/engine.js');
const { build } = require('./dataset.js');
const { make } = require('./tools.js');
const { questions } = require('./questions.js');
const { grade } = require('./grade.js');

/* ---------- options ---------- */
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const flag = name => args.includes('--' + name);
if (flag('help')) {
  console.log(fs.readFileSync(path.join(__dirname, 'run.js'), 'utf8').split('*/')[0]);
  process.exit(0);
}
const URL_ = (opt('url', process.env.BENCH_URL || 'http://localhost:11434/v1') || '').replace(/\/+$/, '');
const MODEL = opt('model', process.env.BENCH_MODEL || 'qwen3:8b');
const KEY = opt('key', process.env.BENCH_KEY || '');
const MAX_STEPS = +opt('max-steps', 6);
const TIMEOUT = 1000 * +opt('timeout', 300);
const TEMP = +opt('temperature', 0.3);
const ONLY = (opt('only', '') || '').split(',').filter(Boolean);
const CAT = opt('cat', '');
const VERBOSE = flag('verbose');
const OUT = opt('out', path.join(__dirname, 'results'));

/* ---------- the model ---------- */
function parseArgs(a) {
  if (a && typeof a === 'object') return a;
  try {
    return JSON.parse(a || '{}') || {};
  } catch (e) {
    return {};
  }
}
async function chat(messages, withTools) {
  const body = {
    model: MODEL,
    temperature: TEMP,
    max_tokens: 2000,
    messages,
    ...(withTools ? { tools: EN.CHAT_TOOLS } : {})
  };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(URL_ + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(KEY ? { authorization: 'Bearer ' + KEY } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || 'HTTP ' + r.status);
      const m = ((j.choices || [])[0] || {}).message || {};
      let content = String(m.content || '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();
      let calls = (m.tool_calls || []).map((c, i) => ({
        id: c.id || 'call_' + i,
        name: c.function && c.function.name,
        arguments: parseArgs(c.function && c.function.arguments)
      }));
      // small models sometimes write the call as text: same fallback as the server
      if (!calls.length && withTools) {
        const t =
          content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/) ||
          content.match(/^\s*(\{[\s\S]*"name"[\s\S]*\})\s*$/);
        if (t) {
          const o = parseArgs(t[1]);
          if (o && typeof o.name === 'string') {
            calls = [{ id: 'call_0', name: o.name, arguments: parseArgs(o.arguments || o.parameters) }];
            content = '';
          }
        }
      }
      return { content, calls: calls.filter(c => c.name), usage: j.usage || null };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** One question: the tool loop, exactly like the app's chat. */
async function ask(T, system, question) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: question }
  ];
  const steps = [];
  const t0 = Date.now();
  let answer = '';
  for (let i = 0; i <= MAX_STEPS && !answer; i++) {
    const r = await chat(messages, i < MAX_STEPS);
    if (r.calls.length && i < MAX_STEPS) {
      messages.push({
        role: 'assistant',
        content: r.content || '',
        tool_calls: r.calls.map(c => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments) }
        }))
      });
      for (const c of r.calls) {
        const result = T.run(c.name, c.arguments);
        const text = JSON.stringify(result);
        steps.push({
          name: c.name,
          args: c.arguments,
          result: text.length > 4000 ? text.slice(0, 4000) + '…' : text
        });
        messages.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: text });
      }
    } else answer = r.content;
  }
  return { answer, steps, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}

/* ---------- main ---------- */
(async () => {
  const D = build();
  const T = make(D);
  let Q = questions(T);
  if (ONLY.length) Q = Q.filter(q => ONLY.includes(q.id));
  if (CAT) Q = Q.filter(q => q.cat === CAT);
  const system = EN.chatSystemPrompt({
    lang: 'it',
    today: D.today,
    categories: [...new Set(D.tx.map(t => t.cat))]
  });

  console.log(`EyeCash · banco di prova del consulente`);
  console.log(`Modello: ${MODEL} · ${URL_} · ${Q.length} domande\n`);
  try {
    const r = await chat([{ role: 'user', content: 'Rispondi solo: ok' }], false);
    if (!r.content) throw new Error('risposta vuota');
  } catch (e) {
    console.error(
      `✕ Non riesco a parlare con il modello (${e.message}).\n  Controlla che Ollama sia acceso e che il modello sia scaricato: ollama pull ${MODEL}`
    );
    process.exit(1);
  }

  const results = [];
  const started = Date.now();
  for (const [i, q] of Q.entries()) {
    process.stdout.write(
      `[${String(i + 1).padStart(3)}/${Q.length}] ${q.id} ${q.q.slice(0, 60).padEnd(60)} `
    );
    let r;
    try {
      r = await ask(T, system, q.q);
    } catch (e) {
      r = { answer: '', steps: [], seconds: 0, error: e.message };
    }
    const auto = grade(q, r);
    results.push({
      id: q.id,
      cat: q.cat,
      q: q.q,
      expected: {
        tools: q.tools,
        nums: q.nums,
        anyNum: q.anyNum,
        verdict: q.verdict,
        mention: q.mention,
        avoid: q.avoid,
        sim: q.sim
      },
      review: q.review || '',
      ...r,
      auto
    });
    console.log(
      `${auto.pass ? '✓' : '✕'} ${Math.round(auto.score * 100)}% · ${r.seconds}s${r.error ? ' · ERRORE ' + r.error : ''}`
    );
    if (VERBOSE) console.log('    ' + (r.answer || '').replace(/\n/g, '\n    ') + '\n');
  }

  /* summary */
  const by = {};
  for (const r of results) {
    const c = (by[r.cat] = by[r.cat] || { n: 0, pass: 0, score: 0 });
    c.n++;
    c.pass += r.auto.pass ? 1 : 0;
    c.score += r.auto.score;
  }
  const total = {
    n: results.length,
    pass: results.filter(r => r.auto.pass).length,
    score: results.reduce((s, r) => s + r.auto.score, 0) / (results.length || 1)
  };
  const secs = results.map(r => r.seconds).sort((a, b) => a - b);
  const meta = {
    tool: 'eyecash-bench',
    version: 1,
    model: MODEL,
    url: URL_.replace(/\/\/[^@/]*@/, '//'),
    date: new Date().toISOString(),
    today_in_data: D.today,
    temperature: TEMP,
    max_steps: MAX_STEPS,
    minutes: Math.round((Date.now() - started) / 6000) / 10,
    median_seconds: secs[Math.floor(secs.length / 2)] || 0
  };
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const base = path.join(OUT, `${MODEL.replace(/[^a-z0-9.]+/gi, '_')}-${stamp}`);
  fs.writeFileSync(base + '.json', JSON.stringify({ meta, total, by_category: by, results }, null, 1));
  const md = [
    `# EyeCash · banco di prova del consulente`,
    ``,
    `**Modello:** ${MODEL} · **data:** ${meta.date.slice(0, 16)} · **durata:** ${meta.minutes} min · **tempo mediano per domanda:** ${meta.median_seconds}s`,
    ``,
    `**Superate automaticamente:** ${total.pass}/${total.n} · **punteggio medio:** ${Math.round(total.score * 100)}%`,
    ``,
    `| Categoria | Domande | Superate | Punteggio |`,
    `|---|---|---|---|`,
    ...Object.entries(by).map(
      ([k, c]) => `| ${k} | ${c.n} | ${c.pass} | ${Math.round((c.score / c.n) * 100)}% |`
    ),
    ``,
    `## Non superate`,
    ``,
    ...results
      .filter(r => !r.auto.pass)
      .map(
        r =>
          `- **${r.id}** ${r.q}\n  - ${r.auto.checks
            .filter(c => !c.ok)
            .map(c => c.name + ': ' + c.detail)
            .join('\n  - ')}`
      ),
    ``,
    `La valutazione automatica controlla strumenti, cifre, verdetto e parole chiave. Le risposte "di parere" vanno lette: manda il file .json per l'analisi.`
  ].join('\n');
  fs.writeFileSync(base + '.md', md);
  console.log(
    `\nSuperate: ${total.pass}/${total.n} · punteggio medio ${Math.round(total.score * 100)}% · ${meta.minutes} minuti`
  );
  console.log(`Risultati: ${base}.json\nReport:    ${base}.md`);
})();
