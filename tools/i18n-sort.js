'use strict';
/*
 * EyeCash · tools/i18n-sort.js
 *
 * Rewrites public/js/i18n-<lang>.js with the keys sorted and without duplicates
 * (the last value wins), keeping the generic separator entries at the top.
 *   node tools/i18n-sort.js en
 */
const fs = require('node:fs');
const path = require('node:path');
const lang = process.argv[2] || 'en';
const file = path.join(__dirname, '..', 'public', 'js', `i18n-${lang}.js`);
const src = fs.readFileSync(file, 'utf8');
const head = src.slice(0, src.indexOf(`I18N.${lang} = {`));
// evaluate the file as the browser does: for duplicated keys the last value wins
const sandbox = { I18N: {} };
require('node:vm').runInNewContext(src, sandbox);
const dict = new Map(Object.entries(sandbox.I18N[lang]));
const generic = [...dict.keys()].filter(k => /^[\s·{}0-9()%]*$/.test(k.replace(/\{\d\}/g, '')));
const rest = [...dict.keys()].filter(k => !generic.includes(k)).sort((a, b) => a.localeCompare(b, 'it'));
const line = k => `  ${JSON.stringify(k)}: ${JSON.stringify(dict.get(k))},`;
fs.writeFileSync(
  file,
  `${head}I18N.${lang} = {\n  // generic separators: the parts around them are translated one by one\n${generic.map(line).join('\n')}\n\n${rest.map(line).join('\n')}\n};\n`
);
console.log(`${file}: ${dict.size} entries`);
