/*
 * EyeCash · public/js/core.js
 *
 * Core helpers shared by every other file: DOM shortcuts, number/date
 * formatting (Italian locale), ids, the category lists and a few tiny utilities.
 * No state, no side effects.
 */
/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
const F2 = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' });
const F0 = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur = v => F2.format(v || 0),
  eur0 = v => F0.format(v || 0);
const pct = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1).replace('.', DEC) + '%';
/** Escapes text for safe use inside HTML strings. Use it for every user-provided value. */
const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
/** Random id for new records. */
const uid = () => Math.random().toString(36).slice(2, 10);
const pad = n => String(n).padStart(2, '0');
/** Formats a Date as YYYY-MM-DD (local time). */
const ds = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const pd = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const today = () => ds(new Date());
const ym = s => s.slice(0, 7);
// month names: Italian as before, other languages from the browser (Intl)
const monthNames = style =>
  [...Array(12)].map((_, i) => {
    const m = new Intl.DateTimeFormat(LOCALE, { month: style }).format(new Date(2026, i, 1)).replace('.', '');
    return m.charAt(0).toUpperCase() + m.slice(1);
  });
const MESI =
  LANG === 'it'
    ? ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']
    : monthNames('short');
const MESIL =
  LANG === 'it'
    ? [
        'Gennaio',
        'Febbraio',
        'Marzo',
        'Aprile',
        'Maggio',
        'Giugno',
        'Luglio',
        'Agosto',
        'Settembre',
        'Ottobre',
        'Novembre',
        'Dicembre'
      ]
    : monthNames('long');
/** Month name as used inside a sentence: lowercase in Italian, capitalised in English. */
const monthInText = name => (LANG === 'it' ? name.toLowerCase() : name);
const ymLabel = k => {
  const [y, m] = k.split('-');
  return MESIL[+m - 1] + ' ' + y;
};
const dLabel = s => {
  const d = pd(s);
  return d.getDate() + ' ' + MESI[d.getMonth()] + ' ' + d.getFullYear();
};
const daysTo = s => Math.round((pd(s) - pd(today())) / 864e5);
const r2 = v => Math.round(v * 100) / 100;
/** Next due date of a recurring item, keeping the original day of month. */
function addPeriod(s, f, anchor) {
  const d = pd(s);
  if (f === 'settimanale') {
    d.setDate(d.getDate() + 7);
    return ds(d);
  }
  const step = f === 'annuale' ? 12 : f === 'trimestrale' ? 3 : 1;
  const day = anchor || d.getDate();
  const y = d.getFullYear(),
    m = d.getMonth() + step;
  const last = new Date(y, m + 1, 0).getDate();
  return ds(new Date(y, m, Math.min(day, last)));
}
const FREQM = { settimanale: 52 / 12, mensile: 1, trimestrale: 1 / 3, annuale: 1 / 12 };

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
const NEUTRAL_CATS = ['Giroconti', 'Investimenti'];
const isNeutral = c => NEUTRAL_CATS.includes(c);
const signOk = (c, amt) => isNeutral(c) || amt > 0 === IN_CATS.includes(c);
const ALL_CATS = () => [...OUT_CATS, ...IN_CATS, ...NEUTRAL_CATS];
const IN_CATS = ['Stipendio', 'Freelance', 'Dividendi e cedole', 'Altre entrate'];
