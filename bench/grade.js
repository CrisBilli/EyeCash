/*
 * EyeCash · bench/grade.js
 *
 * Automatic scoring of one answer: tools called, figures present (Italian or English
 * number formats, within a tolerance), verdict, required and forbidden words.
 * Opinions still need a human (or Claude) review: the score is a first filter.
 */
'use strict';

/** Every number written in a text: 1.250 · 1.250,37 · 1250,37 · 1,250.37 · 12,5% · 3,5 mila · 2k. */
function numbers(text) {
  const out = [];
  const re = /(\d[\d.,']*\d|\d)(\s*(?:mila|k\b|mln|milioni))?/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    let s = m[1].replace(/'/g, '');
    const dot = s.lastIndexOf('.'),
      comma = s.lastIndexOf(',');
    // both separators: the last one is the decimal point
    if (dot >= 0 && comma >= 0)
      s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    // one kind only: groups of exactly three digits are thousands, otherwise it is the decimal point
    else if (comma >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(/,/g, '.');
    else if (dot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    let n = parseFloat(s);
    if (!isFinite(n)) continue;
    const u = (m[2] || '').trim().toLowerCase();
    if (u === 'mila' || u === 'k') n *= 1000;
    if (u === 'mln' || u === 'milioni') n *= 1e6;
    out.push(n);
  }
  return out;
}
/** True when one of the numbers is close to v (relative tolerance, at least ±1 for euro amounts). */
function hasNumber(found, v, tol = 0.03) {
  const t = Math.max(Math.abs(v) * tol, tol === 0 ? 0 : Math.abs(v) >= 20 ? 1 : 0.01);
  return found.some(n => Math.abs(n - v) <= t || Math.abs(n + v) <= t);
}
/** The conclusion at the start of the answer: 'yes', 'careful', 'no' or null. */
function verdictOf(text) {
  const head = String(text || '')
    .replace(/[*_#>]/g, '')
    .trim()
    .slice(0, 260)
    .toLowerCase();
  if (
    /^\W*s[iì](?![\wà-ù])[^.!\n]{0,40}\b(ma|però|con (cautela|attenzione))\b|con (cautela|attenzione)|al limite|^\W*dipende|^\W*s[iì],? ma\b|^\W*forse\b|^\W*possibile,? ma/.test(
      head
    )
  )
    return 'careful';
  if (
    /^\W*no\b|^\W*non (ancora|adesso|ora|subito|conviene|ce la fai|puoi|riesci|è (consigliabile|il caso|sostenibile|prudente))|sconsiglio|meglio (aspettare|di no|rimandare|non)|conviene aspettare|^\W*purtroppo|^\W*al momento no/.test(
      head
    )
  )
    return 'no';
  if (
    /^\W*s[iì](?![\wà-ù])|puoi permettert|te lo puoi permettere|ce la fai|riesci|^\W*certo|^\W*assolutamente/.test(
      head
    )
  )
    return 'yes';
  return null;
}

function grade(q, r) {
  const checks = [];
  const text = r.answer || '';
  const found = numbers(text);
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  if (r.error) add('risposta', false, r.error);
  else add('risposta', text.length > 0, text ? '' : 'nessuna risposta');
  if (q.tools && q.tools.length) {
    const used = r.steps.map(s => s.name);
    add(
      'strumenti',
      q.tools.some(t => used.includes(t)),
      `attesi: ${q.tools.join(' | ')} · usati: ${used.join(', ') || 'nessuno'}`
    );
  }
  for (const n of q.nums || [])
    add(
      'cifra ' + n.label,
      hasNumber(found, n.v, n.tol == null ? 0.03 : n.tol),
      `attesa ${Math.round(n.v * 100) / 100}`
    );
  if (q.anyNum && q.anyNum.length)
    add(
      'cifra (una tra)',
      q.anyNum.some(v => hasNumber(found, v, 0.04)),
      `una tra ${q.anyNum.map(v => Math.round(v * 100) / 100).join(' · ')}`
    );
  if (q.verdict) {
    const want = Array.isArray(q.verdict) ? q.verdict : [q.verdict];
    const got = verdictOf(text);
    add(
      'verdetto',
      got && want.includes(got),
      `atteso ${want.join(' o ')} · letto ${got || 'non riconosciuto'}`
    );
  }
  for (const group of q.mention || [])
    add(
      'menziona',
      group.some(p => new RegExp(p, 'i').test(text)),
      group.join(' | ')
    );
  for (const p of q.avoid || []) add('evita', !new RegExp(p, 'i').test(text), p);
  const score = checks.filter(c => c.ok).length / checks.length;
  return {
    pass: checks.every(c => c.ok),
    score: Math.round(score * 100) / 100,
    checks,
    numbers_found: found.slice(0, 30)
  };
}

module.exports = { grade, numbers, verdictOf, hasNumber };
