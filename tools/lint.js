'use strict';
/*
 * EyeCash · tools/lint.js
 *
 * ESLint over the whole code base, with rules that catch real bugs (undefined
 * names, redeclarations, unused code, unreachable code).
 * The client files share one global scope (plain scripts loaded in order), so they
 * are linted together, concatenated in the order of public/index.html.
 *   npm i --no-save eslint@10 && node tools/lint.js
 * Exit code 1 if anything is found.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const browser = Object.fromEntries(JSON.parse(read('tools/browser-globals.json')).map(k => [k, 'readonly']));
const node = Object.fromEntries(
  'require module exports process __dirname console Buffer setTimeout setInterval clearTimeout clearInterval setImmediate fetch URL URLSearchParams AbortSignal AbortController TextDecoder TextEncoder Intl structuredClone queueMicrotask globalThis crypto performance'
    .split(' ')
    .map(k => [k, 'readonly'])
);
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-dupe-else-if': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-fallthrough': 'error',
  'no-shadow-restricted-names': 'error'
};
const linter = new Linter({ configType: 'flat' });
const problems = [];

// client: one combined source, mapped back to the original files
const files = [...read('public/index.html').matchAll(/<script src="\/(js\/[a-z0-9-]+\.js|engine\.js)"/g)].map(
  m => 'public/' + m[1]
);
let src = '';
const map = [];
for (const f of files) {
  const start = src.split('\n').length;
  src += read(f) + '\n';
  map.push([f, start, src.split('\n').length]);
}
const where = line => {
  const m = map.find(([, a, b]) => line >= a && line < b);
  return `${m[0]}:${line - m[1] + 1}`;
};
for (const p of linter.verify(src, {
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script',
    globals: { ...browser, module: 'readonly' }
  },
  rules
}))
  problems.push(`${where(p.line)}  ${p.ruleId}: ${p.message}`);

// server, MCP bridge, service worker, tests: one file at a time
const others = [
  'server.js',
  'mcp/eyecash-mcp.js',
  'public/sw.js',
  ...fs.readdirSync(path.join(ROOT, 'server')).map(f => 'server/' + f)
];
for (const f of others) {
  const globals = f.endsWith('sw.js')
    ? { ...browser, self: 'readonly', caches: 'readonly', clients: 'readonly' }
    : node;
  for (const p of linter.verify(read(f), {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals },
    rules
  }))
    problems.push(`${f}:${p.line}  ${p.ruleId}: ${p.message}`);
}

console.log(problems.length ? problems.join('\n') : `✔ ${files.length + others.length} files, no problems`);
process.exit(problems.length ? 1 : 0);
