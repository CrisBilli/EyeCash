/*
 * EyeCash · public/js/ui.js
 *
 * Visual building blocks: light/dark theme, category icons and colours,
 * navigation, and the small SVG chart helpers (hero line, donut, bars, heatmap).
 * Everything returns HTML strings; nothing here touches the user's data.
 */
/* ===== Theme, category icons, interactions ===== */
const THEME_KEY = 'eyecash_theme';
function themePref() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark';
  } catch (e) {
    return 'dark';
  }
}
/** Applies the light/dark/auto theme and the matching browser chrome colours. */
function applyTheme() {
  const p = themePref(),
    t = p === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p;
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = t === 'light' ? '#F3F5F9' : '#090B10';
  const s = document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]');
  if (s) s.content = t === 'light' ? 'default' : 'black-translucent';
}
applyTheme();
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
} catch (e) {}
const IC = {
  house: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/>',
  bolt: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"/>',
  cart: '<path d="M3 4h2.2l2.3 11h10.8L20.5 8H6.4"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  car: '<path d="M5 16.5h14l-1.4-6.3A2 2 0 0 0 15.6 8.6H8.4a2 2 0 0 0-2 1.6z"/><path d="M4 16.5v3M20 16.5v3"/><circle cx="8" cy="16.5" r="1.3"/><circle cx="16" cy="16.5" r="1.3"/>',
  food: '<path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10"/><path d="M17 21V3c-2.2 1-3.5 3.6-3.5 7 0 1.6 1 3 3.5 3"/>',
  repeat:
    '<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>',
  heart:
    '<path d="M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 0 0-7.1 7.1L12 21l8.4-8.3a5 5 0 0 0 0-7.1z"/>',
  bag: '<path d="M5.5 8h13l-1 13h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  star: '<path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8z"/>',
  plane:
    '<path d="M21 15.5v-2l-8-5V4a1.5 1.5 0 0 0-3 0v4.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z"/>',
  bank: '<path d="M3 21h18M5 21v-9M9.7 21v-9M14.3 21v-9M19 21v-9"/><path d="M2.5 9.5 12 4l9.5 5.5z"/>',
  cal: '<rect x="4" y="5" width="16" height="16" rx="2.5"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
  card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  dots: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
  brief:
    '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8.5 7V5.5A2 2 0 0 1 10.5 3.5h3a2 2 0 0 1 2 2V7M3 12.5h18"/>',
  laptop: '<rect x="4.5" y="5" width="15" height="10.5" rx="1.8"/><path d="M2.5 19h19"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
  swap: '<path d="M7 4 3.5 7.5 7 11"/><path d="M3.5 7.5H17"/><path d="M17 13l3.5 3.5L17 20"/><path d="M20.5 16.5H7"/>',
  chart: '<path d="M4 20V11M10 20V5M16 20v-6M2.5 20h19"/>',
  piggy:
    '<path d="M19 11a6.5 5.5 0 1 0-9.5 4.9V19h3v-2h2v2h3v-3.2A5.4 5.4 0 0 0 19 13h2v-3h-2z"/><path d="M8 7.5 6.5 4.5l3 1"/>',
  up: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  down: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  gem: '<path d="M6 4h12l3.5 5L12 21 2.5 9z"/><path d="M2.5 9h19M9.5 4 8 9l4 12 4-12-1.5-5"/>',
  doc: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  cup: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  cash: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>'
};
const CAT_STYLE = {
  Casa: ['#A78BFA', 'house'],
  Utenze: ['#FBBF24', 'bolt'],
  Spesa: ['#34D399', 'cart'],
  Trasporti: ['#60A5FA', 'car'],
  Ristoranti: ['#FB923C', 'food'],
  Abbonamenti: ['#22D3EE', 'repeat'],
  Salute: ['#F87171', 'heart'],
  Shopping: ['#FB7185', 'bag'],
  Svago: ['#E879F9', 'star'],
  Viaggi: ['#38BDF8', 'plane'],
  'Tasse e commissioni': ['#A1A1AA', 'bank'],
  'Rate e finanziamenti': ['#F472B6', 'cal'],
  'Carta di credito': ['#818CF8', 'card'],
  Altro: ['#94A3B8', 'dots'],
  Stipendio: ['#4ADE80', 'brief'],
  Freelance: ['#2DD4BF', 'laptop'],
  'Dividendi e cedole': ['#A3E635', 'trend'],
  'Altre entrate': ['#86EFAC', 'coin'],
  Giroconti: ['#7DD3FC', 'swap'],
  Investimenti: ['#8B5CF6', 'chart']
};
const ACC_STYLE = {
  Conto: ['#60A5FA', 'bank'],
  Carta: ['#818CF8', 'card'],
  Risparmio: ['#F472B6', 'piggy'],
  Contanti: ['#34D399', 'cash']
};
const svgI = (k, w = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${IC[k] || IC.dots}</svg>`;
/** Coloured tile with a line icon (replaces emoji avatars). */
const tile = (k, c, cls = '') => `<div class="av cico ${cls}" style="--c:${c}">${svgI(k)}</div>`;
const catCol = c => (CAT_STYLE[c] || CAT_STYLE.Altro)[0];
/** Round coloured category avatar (icon in a circle). */
const catAv = c => {
  const [s, k] = CAT_STYLE[c] || CAT_STYLE.Altro;
  return `<div class="av cico" style="--c:${s}">${svgI(k)}</div>`;
};
const catIc = c => {
  if (!CAT_STYLE[c]) return '';
  const [s, k] = CAT_STYLE[c];
  return `<span class="cic" style="--c:${s}">${svgI(k, 2.4)}</span>`;
};
const accAv = a => {
  const [s, k] = ACC_STYLE[a.type] || ACC_STYLE.Conto;
  return `<div class="av cico" style="--c:${s}">${svgI(k)}</div>`;
};
/* smooth curve through the points (Catmull-Rom) */
/** Smooth SVG path through points (Catmull-Rom spline). */
function smoothPath(P) {
  if (P.length < 2) return '';
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] || P[i],
      p1 = P[i],
      p2 = P[i + 1],
      p3 = P[i + 2] || p2;
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
/** Net-worth line chart shown in the Home hero card. */
function heroChart(vals, labels, col = 'var(--aqua)') {
  const W = innerWidth < 820 ? 360 : 700,
    H = innerWidth < 820 ? 130 : 150,
    p = 8,
    mn = Math.min(...vals),
    mx = Math.max(...vals),
    rg = mx - mn || Math.abs(mx) || 1;
  const P = vals.map((v, i) => [
    p + ((W - 2 * p) * i) / (vals.length - 1),
    H - 22 - ((H - 40) * (v - mn)) / rg
  ]);
  const d = smoothPath(P),
    last = P[P.length - 1],
    hid = 'hg' + gid++;
  const lb = labels
    .map((l, i) =>
      i % Math.ceil(labels.length / 6) === 0 || i === labels.length - 1
        ? `<text x="${P[i][0]}" y="${H - 4}" text-anchor="middle">${l}</text>`
        : ''
    )
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="overflow:visible"><defs><linearGradient id="${hid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".32"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
   <path class="fadein" d="${d}L${last[0]},${H - 22}L${P[0][0]},${H - 22}Z" fill="url(#${hid})"/><path class="draw" pathLength="1" d="${d}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/>
   <circle class="pop" style="animation-delay:1s" cx="${last[0]}" cy="${last[1]}" r="5.5" fill="var(--bg)" stroke="${col}" stroke-width="2.6"/>${lb}
   ${P.map((q, i) => `<rect x="${q[0] - W / vals.length / 2}" y="0" width="${W / vals.length}" height="${H}" fill="transparent" data-tip="${labels[i]}\n${eur0(vals[i])}"/>`).join('')}</svg>`;
}
/** Big spending ring of the month: one rounded arc per category, with small gaps. */
function spendRing(rows, total, size = 228) {
  const c = size / 2,
    r = c - 16,
    w = 18,
    C = 2 * Math.PI * r,
    multi = rows.length > 1,
    cut = multi ? w + 6 : 0;
  /* a slice shorter than its round caps would spill onto its neighbours: give every slice a
     minimum length and take that room proportionally from the bigger ones */
  const minL = cut + 5;
  const raw = rows.map(x => (x.v / total) * C);
  let L = raw;
  if (multi && rows.length * minL < C) {
    const small = raw.map(v => v < minL);
    const big = raw.reduce((t, v, i) => t + (small[i] ? 0 : v), 0);
    const k = (C - small.filter(Boolean).length * minL) / (big || 1);
    L = raw.map((v, i) => (small[i] ? minL : v * k));
  }
  let acc = 0;
  const arcs = rows
    .map((x, i) => {
      const dash = multi ? Math.max(0.01, L[i] - cut) : C;
      const el = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${x.col}" stroke-width="${w}" stroke-linecap="${multi ? 'round' : 'butt'}" stroke-dasharray="${dash.toFixed(2)} ${C.toFixed(1)}" stroke-dashoffset="${(-acc - cut / 2).toFixed(2)}" transform="rotate(-90 ${c} ${c})" data-tip="${esc(x.c)}\n${eur(x.v)} · ${Math.round((x.v / total) * 100)}%"/>`;
      acc += L[i];
      return el;
    })
    .join('');
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--ringtrack)" stroke-width="${w}"/><g class="ringarcs">${arcs}</g></svg>`;
}
/** Monthly bars with the average as a dashed line; the current month (partial) is hatched. */
function monthBars(months, vals, opt = {}) {
  const W = 360,
    H = opt.h || 170,
    pb = 20,
    pt = 18,
    n = vals.length,
    mx = Math.max(...vals, 1) * 1.08,
    bw = W / n,
    cur = today().slice(0, 7),
    full = vals.filter((v, i) => months[i] !== cur),
    avg = full.length ? full.reduce((s, v) => s + v, 0) / full.length : 0,
    y = v => H - pb - (v / mx) * (H - pb - pt),
    id = 'mb' + gid++,
    c1 = opt.c1 || '#C4B5FD',
    c2 = opt.c2 || '#8B5CF6';
  const bars = vals
    .map((v, i) => {
      const x = i * bw + bw * 0.14,
        w = bw * 0.72,
        top = Math.min(y(v), H - pb - 3),
        part = months[i] === cur;
      return `<path d="${barPath(x, top, w, H - pb - top, Math.min(7, w / 2))}" fill="url(#${part ? id + 'h' : id})" data-tip="${ymLabel(months[i])}${part ? ' (in corso)' : ''}\n${eur0(v)}"/>`;
    })
    .join('');
  const step = Math.ceil(n / 12);
  const lab = months
    .map((m, i) =>
      i % step === 0 || i === n - 1
        ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${MESI[+m.slice(5) - 1]}</text>`
        : ''
    )
    .join('');
  const ay = y(avg);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="monthbars" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><pattern id="${id}h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${c2}" opacity=".55"/><rect width="3" height="6" fill="${c2}"/></pattern></defs>${bars}${
    avg
      ? `<line x1="0" x2="${W}" y1="${ay.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="var(--tx)" stroke-opacity=".45" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/><text x="${W - 2}" y="${(ay - 5).toFixed(1)}" text-anchor="end" class="avglbl">media ${eur0(avg)}</text>`
      : ''
  }${lab}</svg>`;
}
/** Bars for each day of a month, with the daily average as a dashed line and today highlighted. */
function dayBars(vals, opt = {}) {
  const W = 340,
    H = opt.h || 120,
    pb = 18,
    n = vals.length,
    nz = vals.filter(v => v > 0).sort((x, y) => x - y),
    /* one rent-sized day must not flatten the rest: cap the scale, the tall bar touches the top */
    mx = Math.max(
      1,
      nz.length >= 5
        ? Math.min(nz[nz.length - 1], nz[Math.floor(nz.length * 0.8)] * 2.2)
        : nz[nz.length - 1] || 1
    ),
    bw = W / n,
    todayI = opt.today == null ? -1 : opt.today,
    upto = todayI >= 0 ? todayI + 1 : n,
    avg = vals.slice(0, upto).reduce((s, v) => s + v, 0) / Math.max(upto, 1),
    ay = H - pb - (Math.min(avg, mx) / mx) * (H - pb - 6),
    id = 'db' + gid++;
  const bars = vals
    .map((v, i) => {
      const bh = v > 0 ? Math.max(3, (Math.min(v, mx) / mx) * (H - pb - 6)) : 3,
        fut = todayI >= 0 && i > todayI;
      return `<rect x="${(i * bw + bw * 0.18).toFixed(1)}" y="${(H - pb - bh).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(3, bw * 0.3).toFixed(1)}" fill="${v > 0 && !fut ? `url(#${id})` : 'var(--line2)'}" opacity="${fut ? 0.35 : i === todayI ? 1 : v > 0 ? 0.85 : 0.6}"${v > 0 ? ` data-tip="${i + 1} · ${eur(v)}"` : ''}/>`;
    })
    .join('');
  const lab = [0, 9, 19, n - 1]
    .map(i => `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle">${i + 1}</text>`)
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" class="daybars"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${opt.c1 || '#A78BFA'}"/><stop offset="1" stop-color="${opt.c2 || '#2563EB'}"/></linearGradient></defs>${bars}${avg > 0 ? `<line x1="0" x2="${W}" y1="${ay.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="var(--tx2)" stroke-opacity=".5" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>` : ''}${lab}</svg>`;
}
/* fun facts: playful comparisons computed locally */
/** "Did you know?" card: a playful comparison computed locally. */
function funFact() {
  const y = today().slice(0, 4),
    since = y + '-01-01';
  const by = {};
  let bar = 0;
  for (const t of S.tx) {
    if (t.date < since || t.amount >= 0 || isNeutral(t.cat)) continue;
    by[t.cat] = (by[t.cat] || 0) - t.amount;
    if (/\b(bar|caff[eè])\b/i.test(t.note || '')) bar++;
  }
  const F = [
    ['Ristoranti', '', 8, 'pizze margherita', '#fff1e6'],
    ['Trasporti', '', 70, 'pieni di benzina', '#e8f3ff'],
    ['Svago', '', 9, 'biglietti del cinema', '#e6f8f2'],
    ['Viaggi', '', 90, 'notti in hotel', '#e6f8fb'],
    ['Shopping', '', 70, 'paia di scarpe da ginnastica', '#fde9f2'],
    ['Spesa', '', 60, 'carrelli della spesa media', '#eaf8ec'],
    ['Abbonamenti', '', 12, 'mesi di un abbonamento streaming', '#f1ecff']
  ];
  const ok = F.filter(f => by[f[0]] >= f[2] * 2);
  if (bar >= 10) ok.push(['__bar', '', 0, '', '']);
  if (!ok.length) return null;
  const doy = Math.floor((Date.now() - Date.parse(y + '-01-01')) / 864e5),
    f = ok[doy % ok.length];
  if (f[0] === '__bar')
    return {
      ill: tile('cup', '#FB923C', 'big'),
      t: `Quest'anno sei passato al bar ${bar} volte`,
      d: 'Contando i pagamenti con "bar" o "caffè" nella descrizione.'
    };
  const v = by[f[0]];
  return {
    ill: catAv(f[0]).replace('class="av cico"', 'class="av cico big"'),
    t: `Quest'anno hai già speso ${eur0(v)} in ${f[0]}`,
    d: `Con la stessa cifra potevi comprare circa ${Math.round(v / f[2])} ${f[3]}.`,
    c: f[0]
  };
}
/* monthly budget, "how much can I spend per day" style */
/** Monthly budget card: spent vs budget, ideal pace and daily allowance. */
function budgetCard(cs, k) {
  const bud = Object.entries(S.budgets || {}).filter(([, v]) => v > 0);
  if (!bud.length) return '';
  const tot = bud.reduce((s, b) => s + b[1], 0),
    cats = new Set(bud.map(b => b[0]));
  const [y, m] = k.split('-').map(Number),
    dim = new Date(y, m, 0).getDate(),
    d = +today().slice(8),
    left = dim - d + 1;
  const spent = bud.reduce((s, [c]) => s + (cs[c] || 0), 0),
    r = spent / tot,
    perDay = Math.max(0, (tot - spent) / left);
  const cum = Array(dim).fill(0);
  for (const t of S.tx)
    if (ym(t.date) === k && t.amount < 0 && cats.has(t.cat)) cum[+t.date.slice(8) - 1] -= t.amount;
  for (let i = 1; i < dim; i++) cum[i] += cum[i - 1];
  const W = innerWidth < 820 ? 360 : 480,
    H = 140,
    mx = Math.max(tot, spent) * 1.08,
    X = i => 8 + ((W - 16) * i) / (dim - 1),
    Y = v => H - 18 - ((H - 30) * v) / mx;
  const P = cum.slice(0, d).map((v, i) => [X(i), Y(v)]);
  const prev = lastMonths(2)[0],
    pcs = catSpend(prev),
    ps = bud.reduce((s, [c]) => s + (pcs[c] || 0), 0);
  const col = r > 1 ? 'var(--crit)' : r > d / dim + 0.1 ? 'var(--warn)' : 'var(--accent)';
  return `<div class="card sens"><div class="card-h"><div><h3>Budget del mese</h3><div class="hint">${bud.length} categorie · ${ymLabel(k)}</div></div><button class="btn sm" data-act="go" data-v="impostazioni">Gestisci</button></div>
   <div style="text-align:center"><div class="num" style="font-size:30px;font-weight:700;letter-spacing:-.02em;color:${col}">${eur0(spent)}</div><div class="hint">spesi su ${eur0(tot)}</div></div>
   <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" style="overflow:visible;margin-top:6px">${[0, 0.5, 1].map(f => `<line x1="0" x2="${W}" y1="${Y(tot * f)}" y2="${Y(tot * f)}" stroke="var(--line)"/><text x="0" y="${Y(tot * f) - 4}">${eur0(tot * f)}</text>`).join('')}
    <path d="M${X(0)},${Y(0)}L${X(dim - 1)},${Y(tot)}" stroke="var(--mut)" stroke-dasharray="4 5" stroke-width="1.6" fill="none"/>${P.length > 1 ? `<path class="draw" pathLength="1" d="${smoothPath(P)}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round"/><circle class="pop" style="animation-delay:1s" cx="${P[P.length - 1][0]}" cy="${P[P.length - 1][1]}" r="5" fill="var(--card)" stroke="${col}" stroke-width="3"/>` : ''}</svg>
   <div class="tipbox">${r > 1 ? `Hai superato il budget di <b class="num">${eur0(spent - tot)}</b>. Prova a rallentare fino a fine mese.` : `Puoi spendere ancora <b class="num">${eur(perDay)}</b> al giorno per il resto del mese.`}</div>
   <div class="prog"><i style="width:${Math.min(100, r * 100)}%;background:${col}">${Math.round(r * 100)}%</i><span class="today" style="left:${((d - 0.5) / dim) * 100}%"></span></div>
   <div style="display:flex;justify-content:space-between" class="hint"><span>1 ${MESI[m - 1]}</span><span>${dim} ${MESI[m - 1]}</span></div>
   ${ps ? `<div class="hint" style="margin-top:12px">Mese scorso: ${eur0(ps)} (${Math.round((ps / tot) * 100)}% del budget)</div>` : ''}</div>`;
}
/* count-up of the main number (disabled during automated tests) */
function countUp(el) {
  if (!el || navigator.webdriver || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = +el.dataset.to;
  if (!isFinite(to)) return;
  const t0 = performance.now(),
    dur = 700,
    fmt = v => eur(v);
  (function f(now) {
    const p = Math.min(1, (now - t0) / dur),
      e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(to * e);
    if (p < 1) requestAnimationFrame(f);
    else el.textContent = fmt(to);
  })(t0);
}
/* bottom sheet: drag down to close */
(() => {
  let y0 = null,
    dy = 0,
    box = null;
  document.addEventListener(
    'touchstart',
    e => {
      box = e.target.closest('#sheetbox');
      if (!box || box.scrollTop > 0 || e.target.closest('input,select,textarea,.cgrid')) {
        box = null;
        return;
      }
      y0 = e.touches[0].clientY;
      dy = 0;
    },
    { passive: true }
  );
  document.addEventListener(
    'touchmove',
    e => {
      if (!box || y0 == null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      if (dy > 4) {
        box.classList.add('drag');
        box.style.transform = `translateY(${dy}px)`;
      }
    },
    { passive: true }
  );
  document.addEventListener('touchend', () => {
    if (!box) return;
    box.classList.remove('drag');
    box.style.transition = 'transform .2s';
    if (dy > 110) {
      box.style.transform = 'translateY(100%)';
      setTimeout(() => {
        closeForm();
        box.style.transform = '';
        box.style.transition = '';
      }, 180);
    } else {
      box.style.transform = '';
      setTimeout(() => (box.style.transition = ''), 220);
    }
    y0 = null;
    box = null;
  });
})();

/* ---------- icons/nav ---------- */
const I = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  tx: '<path d="M7 7h13M7 7l3-3M7 7l3 3M17 17H4m13 0-3-3m3 3-3 3"/>',
  inv: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  rec: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M12 8v4l3 2"/>',
  goal: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  fire: '<path d="M12 3c1 3 4 4.5 4 8.5a4 4 0 0 1-8 0c0-1.6.7-2.8 1.5-3.7.2 1.4 1 2.2 2 2.2 0-2.5-.5-4.5.5-7z"/><path d="M12 21a6 6 0 0 0 6-6"/>',
  pat: '<path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  ask: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1v.5M12 16.5v.01"/>',
  afford: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="m9 15 2 2 4-4"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  set: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'
};
const ico = k =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[k]}</svg>`;
const VIEWS = [
  ['home', 'Panoramica', 'home', 'Home'],
  ['movimenti', 'Movimenti', 'tx', 'Movimenti'],
  ['patrimonio', 'Patrimonio', 'pat', 'Patrimonio'],
  ['investimenti', 'Investimenti', 'inv', 'Investimenti'],
  ['fire', 'FIRE', 'fire', 'FIRE'],
  ['ricorrenti', 'Costi ricorrenti', 'rec', 'Ricorrenti'],
  ['obiettivi', 'Obiettivi', 'goal', 'Obiettivi'],
  ['statistiche', 'Statistiche', 'stats', 'Statistiche'],
  ['occhio', 'Occhio', 'ask', 'Occhio'],
  ['permettermelo', 'Posso permettermelo?', 'afford', 'Permettermelo?'],
  ['report', 'Report', 'print', 'Report']
];
let view = 'home';
/* ---------- the consultant orb: the logo eye, with three states ----------
   idle: breathes · alert (something new to read): the chart turns orange and the eye blinks
   until the sheet is opened · thinking (an AI request is running): the iris looks left and right. */
const ORB_SVG =
  '<svg class="eye" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="49" fill="url(#ec-sphere)"/><circle cx="50" cy="50" r="48.5" fill="none" stroke="#fff" stroke-opacity=".15"/>' +
  '<g class="lid"><path d="M17 53 Q48 21 81 45 L61 63 L49 55 L36 63 Z" fill="#fff" fill-opacity=".96"/><g clip-path="url(#ec-eye)"><g class="iris"><circle cx="49" cy="46" r="12" fill="url(#ec-iris)"/><circle cx="49" cy="46" r="5.4" fill="#020617"/><circle cx="45.2" cy="42.3" r="2.4" fill="#fff"/></g></g></g>' +
  '<path class="chart" d="M17 53 L36 63 L49 55 L61 63 L84 42" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path class="chart" d="M75.5 41.2 L85.5 40.6 L84.6 50.4" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const orbHTML = (cls = '') => `<span class="orb ${cls}"><span class="halo"></span>${ORB_SVG}</span>`;
let orbBusyN = 0;
/** Marks an AI request as running (+1) or finished (-1): the eye looks around meanwhile. */
function orbBusy(d) {
  orbBusyN = Math.max(0, orbBusyN + d);
  document.body.classList.toggle('orb-think', orbBusyN > 0);
}
const ORB_SEEN_KEY = 'eyecash_orb_seen';
/** Things worth reading: spending running high and deadlines. Computed on the device. */
function orbNews() {
  try {
    return typeof insights === 'function' && S ? insights().filter(i => i.news) : [];
  } catch (e) {
    return [];
  }
}
/* only a short hash is stored, never the text */
const orbSig = list => {
  let h = 0;
  for (const ch of list.map(i => i.t).join('|')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return list.length ? String(h >>> 0) : '';
};
/** Updates the alert state of the orb. */
function orbRefresh() {
  const sig = orbSig(orbNews());
  let seen = '';
  try {
    seen = localStorage.getItem(ORB_SEEN_KEY) || '';
  } catch (e) {}
  document.body.classList.toggle('orb-alert', !!sig && sig !== seen);
}
function orbMarkSeen() {
  try {
    localStorage.setItem(ORB_SEEN_KEY, orbSig(orbNews()));
  } catch (e) {}
  document.body.classList.remove('orb-alert');
}
/* navigation grouped by area */
const NAV_GROUPS = [
  ['Finanze', ['home', 'movimenti', 'patrimonio', 'investimenti']],
  ['Pianifica', ['obiettivi', 'ricorrenti', 'fire']],
  ['Analisi', ['statistiche', 'report']]
];
function renderNav() {
  const btn = v =>
    `<button class="nav ${view === v[0] ? 'on' : ''}" data-act="go" data-v="${v[0]}">${ico(v[2])}${v[1]}</button>`;
  $('#sidenav').innerHTML =
    `<button class="nav orbnav ${view === 'occhio' ? 'on' : ''}" data-act="orb">${orbHTML()}<span class="main"><span style="display:block">Occhio</span><span class="t2">Chiedi, simula, registra</span></span></button>` +
    NAV_GROUPS.map(
      ([g, ks]) =>
        `<div class="navlbl">${g}</div>` +
        ks
          .map(k => VIEWS.find(v => v[0] === k))
          .filter(Boolean)
          .map(btn)
          .join('')
    ).join('') +
    '<div class="navlbl">Account</div>' +
    `<button class="nav ${view === 'impostazioni' ? 'on' : ''}" data-act="go" data-v="impostazioni">${ico('set')}Impostazioni</button>`;
  const tab = k => {
    const v = VIEWS.find(x => x[0] === k);
    return `<button class="${view === k ? 'on' : ''}" data-act="go" data-v="${k}">${ico(v[2])}<span class="tl">${v[3]}</span></button>`;
  };
  $('#tabbar').innerHTML =
    tab('home') +
    tab('movimenti') +
    `<button class="orbtab ${view === 'occhio' ? 'on' : ''}" data-act="orb" aria-label="Occhio">${orbHTML()}<span class="sr">Occhio</span></button>` +
    tab('patrimonio') +
    tab('investimenti');
  orbRefresh();
}
function renderSync() {
  document.body.classList.toggle('offline', OFFLINE);
  const ob =
    $('#offbar') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'offbar' }));
  ob.textContent = OFFLINE ? (dirty ? 'Offline · modifiche in coda' : 'Offline · copia del dispositivo') : '';
  const m = {
    ok: ['var(--good)', 'Cifrato · server di casa'],
    saving: ['var(--warn)', 'Salvataggio…'],
    errore: ['var(--crit)', 'Server non raggiungibile'],
    offline: ['var(--warn)', dirty ? 'Offline · modifiche in coda' : 'Offline']
  }[sync] || ['var(--good)', 'Cifrato'];
  const t = OFFLINE
    ? 'Si sincronizza da solo quando torna la rete'
    : lastSaved
      ? 'Ultimo salvataggio ' + pad(lastSaved.getHours()) + ':' + pad(lastSaved.getMinutes())
      : 'Dati cifrati con la tua password';
  $('#syncbox').innerHTML =
    `<div style="color:var(--tx);font-weight:500;margin-bottom:3px"><span class="dot" style="background:${m[0]}"></span>${m[1]}</div>${S && S.demo ? 'Dati di esempio: non vengono salvati.' : t}<div style="margin-top:8px"><button class="btn sm" data-act="lock">${svgI('lock')}Blocca</button></div>`;
}

/* ---------- charts ---------- */
function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/* ---------- charts (dashboard style) ---------- */
let gid = 0;
const daysIn = k => {
  const [y, m] = k.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};
function daily(k, sign) {
  const n = daysIn(k),
    a = Array(n).fill(0);
  for (const t of S.tx)
    if (ym(t.date) === k && !isNeutral(t.cat) && (sign < 0 ? t.amount < 0 : t.amount > 0))
      a[+t.date.slice(8) - 1] += Math.abs(t.amount);
  return a;
}
function netAt(k) {
  const [y, m] = k.split('-').map(Number),
    end = ds(new Date(y, m, 0));
  return (
    S.accounts.reduce((s, a) => s + a.balance0, 0) +
    S.tx.reduce((s, t) => (t.date <= end ? s + t.amount : s), 0) +
    invVal() +
    assetsVal() -
    debtsVal(end)
  );
}
function sparkBars(vals, color, h = 34, hiIdx = -1) {
  const w = 160,
    n = vals.length,
    mx = Math.max(...vals, 1),
    bw = w / n;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" class="spark">${vals
    .map((v, i) => {
      const bh = v > 0 ? Math.max(2, (v / mx) * (h - 2)) : 2;
      const on = v > 0;
      return `<rect x="${(i * bw + bw * 0.22).toFixed(2)}" y="${(h - bh).toFixed(2)}" width="${(bw * 0.56).toFixed(2)}" height="${bh.toFixed(2)}" rx="1" fill="${on ? color : 'var(--line2)'}" opacity="${on ? (i === hiIdx ? 1 : 0.45 + (0.55 * v) / mx).toFixed(2) : 0.6}"/>`;
    })
    .join('')}</svg>`;
}
function axisY(top, pl, pt, ih, W, pr, fmt) {
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const v = (top * i) / 3,
      y = pt + ih - (ih * i) / 3;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="var(--line)" ${i ? 'stroke-dasharray="2 4"' : ''}/><text x="${pl - 8}" y="${y + 3}" text-anchor="end">${fmt(v)}</text>`;
  }
  return g;
}
const kfmt = v =>
  Math.abs(v) >= 1000
    ? (v / 1000).toFixed(Math.abs(v) % 1000 ? 1 : 0).replace('.', DEC) + 'k'
    : String(Math.round(v));
const niceTop = m => {
  const st = Math.pow(10, Math.floor(Math.log10(Math.max(m, 1))));
  return Math.ceil(m / st) * st;
};
/* cumulative spending this month vs last month (area chart) */
function monthArea() {
  const k = today().slice(0, 7),
    pk = lastMonths(2)[0],
    dToday = +today().slice(8);
  const cum = a => {
    let s = 0;
    return a.map(v => (s += v));
  };
  const cur = cum(daily(k, -1)).slice(0, dToday),
    prev = cum(daily(pk, -1));
  const n = daysIn(k),
    W = innerWidth < 820 ? 360 : 640,
    H = innerWidth < 820 ? 200 : 210,
    pl = 40,
    pr = 12,
    pt = 26,
    pb = 22,
    iw = W - pl - pr,
    ih = H - pt - pb;
  const top = niceTop(Math.max(cur[cur.length - 1] || 0, prev[prev.length - 1] || 0, 100));
  const X = i => pl + (i / (n - 1)) * iw,
    Y = v => pt + ih - (ih * v) / top;
  const id = 'gm' + ++gid;
  const pl2 = prev
    .slice(0, n)
    .map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1))
    .join('');
  const cl = cur.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('');
  let g = axisY(top, pl, pt, ih, W, pr, kfmt);
  for (const d of W < 500 ? [1, 10, 20, n] : [1, 5, 10, 15, 20, 25, n])
    g += `<text x="${X(d - 1)}" y="${H - 5}" text-anchor="middle">${pad(d)}</text>`;
  g += `<path d="${pl2}" fill="none" stroke="var(--mut)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  if (cur.length) {
    const lx = X(cur.length - 1),
      ly = Y(cur[cur.length - 1]);
    g += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--s-orange)" stop-opacity=".45"/><stop offset="1" stop-color="var(--s-orange)" stop-opacity="0"/></linearGradient></defs>
    <path d="${cl}L${lx},${pt + ih}L${X(0)},${pt + ih}Z" fill="url(#${id})"/><path d="${cl}" fill="none" stroke="var(--s-orange)" stroke-width="2" stroke-linejoin="round"/>
    <line x1="${lx}" x2="${lx}" y1="${ly}" y2="${pt + ih}" stroke="var(--s-orange)" stroke-dasharray="2 3" opacity=".6"/><circle cx="${lx}" cy="${ly}" r="4.5" fill="var(--card)" stroke="var(--s-orange)" stroke-width="2"/>
    <g transform="translate(${Math.min(Math.max(lx, pl + 44), W - pr - 44)},${Math.max(ly - 16, 12)})"><rect x="-44" y="-11" width="88" height="20" rx="6" fill="var(--card2)" stroke="var(--line2)"/><text x="0" y="3" text-anchor="middle" style="fill:var(--tx);font-weight:600;font-size:11px">${eur0(cur[cur.length - 1])}</text></g>`;
  }
  for (let i = 0; i < n; i++)
    g += `<rect x="${X(i) - iw / (n - 1) / 2}" y="${pt}" width="${iw / (n - 1)}" height="${ih}" fill="transparent" data-tip="${i + 1} ${MESIL[+k.slice(5) - 1]}${i < cur.length ? '\nQuesto mese: ' + eur(cur[i]) : ''}\n${MESIL[+pk.slice(5) - 1]}: ${eur(prev[i] || prev[prev.length - 1] || 0)}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${g}</svg>`;
}
/* monthly saving: grey bars, best month highlighted, worst in red */
function savingsBars(nm = 12, endK) {
  let ks = lastMonths(nm);
  if (endK) {
    const i = ks.indexOf(endK);
    if (i >= 0) ks = ks.slice(0, i + 1);
  }
  let d = ks.map(k => {
    const t = monthTot(k);
    return { k, v: t.inc - t.out, inc: t.inc, out: t.out };
  });
  while (d.length > 1 && !d[0].inc && !d[0].out) d.shift();
  const W = innerWidth < 820 ? 360 : 640,
    H = 200,
    pl = 40,
    pr = 8,
    pt = 26,
    pb = 22,
    iw = W - pl - pr,
    ih = H - pt - pb;
  const mx = Math.max(0, ...d.map(x => x.v)),
    mn = Math.min(0, ...d.map(x => x.v));
  const top = niceTop(mx || 100),
    bot = mn < 0 ? -niceTop(-mn) : 0;
  const rg = top - bot;
  const Y = v => pt + ih - ((v - bot) / rg) * ih;
  const zero = Y(0);
  const best = d.reduce((a, b) => (b.v > a.v ? b : a), d[0]),
    worst = d.reduce((a, b) => (b.v < a.v ? b : a), d[0]);
  let g = '';
  for (let i = 0; i <= 3; i++) {
    const v = bot + (rg * i) / 3,
      y = Y(v);
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="var(--line)" ${Math.abs(v) > 1e-6 ? 'stroke-dasharray="2 4"' : ''}/><text x="${pl - 8}" y="${y + 3}" text-anchor="end">${kfmt(v)}</text>`;
  }
  const gw = iw / d.length,
    bw = Math.min(26, gw * 0.62);
  d.forEach((x, i) => {
    const cx = pl + gw * i + gw / 2,
      y = Y(Math.max(x.v, 0)),
      h = Math.abs(Y(x.v) - zero);
    const isB = x === best && best.v > 0,
      isW = x === worst && worst !== best;
    const fill = isB ? 'var(--tx)' : isW ? 'var(--crit)' : 'var(--bar)';
    const m = +x.k.slice(5) - 1;
    const path =
      x.v >= 0
        ? barPath(cx - bw / 2, y, bw, h, 4)
        : `M${cx - bw / 2},${zero}H${cx + bw / 2}V${zero + h - 4}Q${cx + bw / 2},${zero + h} ${cx + bw / 2 - 4},${zero + h}H${cx - bw / 2 + 4}Q${cx - bw / 2},${zero + h} ${cx - bw / 2},${zero + h - 4}Z`;
    g += `<g data-tip="${MESIL[m]} ${x.k.slice(0, 4)}\nRisparmio: ${eur(x.v)}\nEntrate ${eur0(x.inc)} · Uscite ${eur0(x.out)}"><rect x="${pl + gw * i}" y="${pt}" width="${gw}" height="${ih}" fill="transparent"/><path d="${path}" fill="${fill}"/>${isB || isW ? `<text x="${cx}" y="${x.v >= 0 ? y - 6 : zero + h + 12}" text-anchor="middle" style="fill:var(--tx2);font-weight:600">${kfmt(x.v)}</text>` : ''}<text x="${cx}" y="${H - 5}" text-anchor="middle">${MESI[m]}</text></g>`;
  });
  return { svg: `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${g}</svg>`, best, worst };
}
/* spending calendar: grid of small squares */
function heatmap(weeks = 18) {
  const end = pd(today());
  const start = new Date(end);
  start.setDate(start.getDate() - ((end.getDay() + 6) % 7) - 7 * (weeks - 1));
  const map = {};
  for (const t of S.tx) if (t.amount < 0) map[t.date] = (map[t.date] || 0) - t.amount;
  const vals = Object.values(map)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  const q = p => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0);
  const th = [q(0.25), q(0.5), q(0.75)];
  const lvl = v => (!v ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : 4);
  const OP = [0, 0.28, 0.5, 0.75, 1];
  const c = 13,
    gp = 3,
    ox = 22,
    oy = 16;
  let g = '',
    lastM = -1;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + w * 7 + d);
      if (dt > end) continue;
      const s = ds(dt);
      const v = map[s] || 0;
      const L = lvl(v);
      if (d === 0 && dt.getMonth() !== lastM) {
        lastM = dt.getMonth();
        g += `<text x="${ox + w * (c + gp)}" y="10">${MESI[lastM]}</text>`;
      }
      g += `<rect x="${ox + w * (c + gp)}" y="${oy + d * (c + gp)}" width="${c}" height="${c}" rx="3" fill="${L ? 'var(--s-orange)' : 'var(--card2)'}" ${L ? `fill-opacity="${OP[L]}"` : 'stroke="var(--line)"'} data-tip="${dLabel(s)}\n${v ? 'Spese: ' + eur(v) : 'Nessuna spesa'}"/>`;
    }
  }
  ['L', '', 'M', '', 'V', '', 'D'].forEach((l, i) => {
    if (l) g += `<text x="0" y="${oy + i * (c + gp) + 10}">${l}</text>`;
  });
  const W = ox + weeks * (c + gp),
    H = oy + 7 * (c + gp);
  const leg = `<div class="legend" style="justify-content:flex-end;margin-top:8px;gap:5px;align-items:center"><span style="margin-right:4px">Meno</span>${OP.map((o, i) => `<i style="width:11px;height:11px;border-radius:3px;background:${i ? 'var(--s-orange)' : 'var(--card2)'};${i ? 'opacity:' + o : 'border:1px solid var(--line)'}"></i>`).join('')}<span style="margin-left:4px">Di più</span></div>`;
  return `<div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="${Math.round(W * 1.15)}" height="${Math.round(H * 1.15)}" style="display:block;max-width:100%;height:auto">${g}</svg></div>${leg}`;
}
