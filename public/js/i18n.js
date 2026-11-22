/*
 * EyeCash · public/js/i18n.js
 *
 * Interface language (Italian or English) and locale-aware formats.
 *
 * Italian is the source language of the code: every text is written in Italian.
 * When English is active, one translator rewrites what appears on screen, using the
 * dictionary in i18n-en.js (Italian text → English text, gettext style):
 * - a MutationObserver translates every text node and the user-facing attributes
 *   (placeholder, title, aria-label, alt) as soon as they are added or changed, so
 *   views, forms, toasts and the lock screen need no special code;
 * - keys with placeholders, e.g. "Usato {n} volte", also match dynamic texts
 *   ("Usato 3 volte" → "Used 3 times");
 * - stored values (category names, account names) never change: only what is shown.
 * `t(text, vars)` translates a single string in code, e.g. before sending it to the AI.
 * Elements with translate="no" are left untouched.
 */
const LANG_KEY = 'eyecash_lang';
const LANGS = [
  ['it', 'Italiano'],
  ['en', 'English']
];

/** Chosen language: the saved preference, otherwise the phone's language. */
function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && LANGS.some(([k]) => k === saved)) return saved;
  } catch (e) {}
  // automated test browsers default to Italian, the language of the test suites
  if (navigator.webdriver) return 'it';
  return /^it\b/i.test(navigator.language || '') ? 'it' : 'en';
}
const LANG = detectLang();
const LOCALE = LANG === 'en' ? 'en-IE' : 'it-IT'; // en-IE: English with euro amounts written as €1,234.56
const DEC = LANG === 'en' ? '.' : ','; // decimal separator for numbers formatted by hand
document.documentElement.lang = LANG;

/** Saves the language for this device and reloads so every format follows it. */
function setLang(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch (e) {}
  location.reload();
}

/* ---------- dictionary ---------- */
/** Dictionaries by language, filled by i18n-<lang>.js: { 'testo italiano': 'translated text' }. */
const I18N = {};
let trExact = null,
  trPatterns = null;
const trCache = new Map();

/** Builds the lookup tables once: exact keys, and keys with {placeholders} as patterns. */
function trInit() {
  if (trExact) return;
  const dict = I18N[LANG] || {};
  trExact = new Map();
  trPatterns = [];
  for (const [src, dst] of Object.entries(dict)) {
    if (!/\{\w+\}/.test(src)) {
      trExact.set(src, dst);
      continue;
    }
    const names = [];
    const re = src
      .split(/(\{\w+\})/)
      .map(part => {
        const m = part.match(/^\{(\w+)\}$/);
        if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        names.push(m[1]);
        return '(.+?)';
      })
      .join('');
    trPatterns.push([new RegExp('^' + re + '$'), dst, names]);
  }
  // longer patterns first: they are more specific
  trPatterns.sort((a, b) => b[0].source.length - a[0].source.length);
}

/** Translates the text inside surrounding spaces, if it has letters. */
function trPiece(v) {
  const m = v.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return /[A-Za-zÀ-ÿ]/.test(m[2]) ? m[1] + trCore(m[2]) + m[3] : v;
}

/** Translates one piece of text (no HTML); unknown texts are returned unchanged. */
function trCore(s) {
  if (trCache.has(s)) return trCache.get(s);
  let out = trExact.get(s);
  if (out === undefined) {
    out = s;
    for (const [re, dst, names] of trPatterns) {
      const m = s.match(re);
      if (!m) continue;
      out = dst.replace(/\{(\w+)\}/g, (_, n) => {
        const v = m[names.indexOf(n) + 1];
        return v === undefined ? '' : trPiece(v); // a placeholder may itself be translatable (e.g. a category)
      });
      break;
    }
  }
  if (trCache.size > 20000) trCache.clear();
  trCache.set(s, out);
  return out;
}

/** Translates a string from Italian to the current language, keeping surrounding spaces. */
function trText(s) {
  if (LANG === 'it' || !s || !/[A-Za-zÀ-ÿ]/.test(s)) return s;
  trInit();
  return trPiece(s);
}

/** Translation for code: t('Usato {n} volte', { n: 3 }). */
function t(s, vars) {
  let out = trText(s);
  if (vars) out = out.replace(/\{(\w+)\}/g, (k, n) => (n in vars ? vars[n] : k));
  return out;
}

/* ---------- translating the page ---------- */
const TR_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const TR_SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

// elements whose whole subtree is never translated
const trFilter = {
  acceptNode: n =>
    n.nodeType === 1 && (TR_SKIP.has(n.nodeName) || n.getAttribute('translate') === 'no')
      ? NodeFilter.FILTER_REJECT
      : NodeFilter.FILTER_ACCEPT
};
function trTextNode(node) {
  const v = trText(node.nodeValue);
  if (v !== node.nodeValue) node.nodeValue = v;
}
function trAttrs(el) {
  for (const a of TR_ATTRS) {
    const v = el.getAttribute(a);
    if (v) {
      const tv = trText(v);
      if (tv !== v) el.setAttribute(a, tv);
    }
  }
}
/** Translates a node and everything inside it. */
function trNode(node) {
  if (node.nodeType === 3) {
    const p = node.parentElement;
    if (p && !TR_SKIP.has(p.nodeName) && !p.closest('[translate=no]')) trTextNode(node);
    return;
  }
  if (node.nodeType !== 1 || trFilter.acceptNode(node) === NodeFilter.FILTER_REJECT) return;
  trAttrs(node);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, trFilter);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) n.nodeType === 3 ? trTextNode(n) : trAttrs(n);
}

// Starts after every script has run (dictionaries included); the observer then
// translates whatever the app adds or changes.
if (LANG !== 'it')
  document.addEventListener('DOMContentLoaded', () => {
    trNode(document.body);
    document.title = trText(document.title);
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') trNode(m.target);
        else if (m.type === 'attributes') trAttrs(m.target);
        else m.addedNodes.forEach(trNode);
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TR_ATTRS
    });
  });
