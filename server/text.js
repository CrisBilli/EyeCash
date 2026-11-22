'use strict';
/*
 * EyeCash · server/text.js
 *
 * Category names shared with the client, text anonymisation before anything is
 * sent to an AI, and tolerant JSON extraction from AI replies.
 */
const crypto = require('node:crypto');
const { getMeta } = require('./db');

/* ---------- categories, anonymisation ---------- */
const OUT_CATS = [
  'Casa',
  'Utenze',
  'Spesa',
  'Trasporti',
  'Ristoranti',
  'Abbonamenti',
  'Salute',
  'Shopping',
  'Svago',
  'Viaggi',
  'Tasse e commissioni',
  'Rate e finanziamenti',
  'Carta di credito',
  'Altro'
];
const IN_CATS = ['Stipendio', 'Freelance', 'Dividendi e cedole', 'Altre entrate'];
const NEUTRAL_CATS = ['Giroconti', 'Investimenti'];
const CATS = [...OUT_CATS, ...IN_CATS, ...NEUTRAL_CATS];
const EN = require('../public/engine.js'); // the same calculation engine the browser uses
const anon = s =>
  String(s || '')
    .replace(/\b[A-Z]{2}\s?\d{2}(?:\s?[A-Z0-9]){11,30}\b/gi, m =>
      // a real IBAN has at least 10 digits: "da 30000 a rate in 4 anni" is not one
      m.replace(/\D/g, '').length >= 10 ? '[IBAN]' : m
    )
    .replace(/\d[\d ]{11,}\d/g, '[NUM]')
    .replace(/\*{2,}\d{2,4}/g, '[CARTA]')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[EMAIL]');
function parseJSONLoose(text, open) {
  const t = String(text || '');
  const i = t.indexOf(open),
    j = t.lastIndexOf(open === '[' ? ']' : '}');
  if (i < 0 || j < i) return null;
  try {
    return JSON.parse(t.slice(i, j + 1));
  } catch {
    return null;
  }
}
function sealForApp(obj) {
  const pub = getMeta('inbox_pub');
  if (!pub) throw new Error("Apri EyeCash almeno una volta per attivare l'inserimento da Claude");
  const key = crypto.createPublicKey({ key: JSON.parse(pub), format: 'jwk' });
  const aes = crypto.randomBytes(32),
    iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', aes, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  const ek = crypto.publicEncrypt(
    { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aes
  );
  return JSON.stringify({ ek: ek.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') });
}

module.exports = { CATS, EN, IN_CATS, NEUTRAL_CATS, OUT_CATS, anon, parseJSONLoose, sealForApp };
