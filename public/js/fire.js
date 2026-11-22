/*
 * EyeCash · public/js/fire.js
 *
 * Financial independence (FIRE) simulator: a Monte Carlo simulation that
 * runs entirely on the device, with stress scenarios and the FIRE view.
 */
const hCls = h => h.cls || DEF_CLS[h.type] || 'azioni',
  hTax = h => h.taxClass || DEF_TAX[h.type] || 'azioni';

const clsLabel = k => (EN.CLASSES.find(c => c.k === k) || { label: k }).label;

function avgSpendYear() {
  const ms = lastMonths(13)
    .slice(0, 12)
    .filter(k => S.tx.some(t => ym(t.date) === k));
  if (ms.length < 2) return 24000;
  return Math.round(((ms.reduce((s, k) => s + monthTot(k).out, 0) / ms.length) * 12) / 100) * 100;
}

function avgSaveMonth() {
  const ms = lastMonths(7)
    .slice(0, 6)
    .filter(k => S.tx.some(t => ym(t.date) === k));
  if (!ms.length) return 500;
  return Math.max(
    0,
    Math.round(
      ms.reduce((s, k) => {
        const t = monthTot(k);
        return s + t.inc - t.out;
      }, 0) /
        ms.length /
        10
    ) * 10
  );
}

function fireDefaults() {
  return {
    age: '',
    endAge: 95,
    mode: 'fire',
    retireAge: 60,
    maxWorkAge: 70,
    spending: avgSpendYear(),
    saving: avgSaveMonth(),
    savingGrowth: 0,
    swr: 3.5,
    inclCash: true,
    emergencyMonths: 6,
    extraStart: 0,
    pension: { amount: 0, fromAge: 67 },
    side: { amount: 0, untilAge: 0 },
    flex: { on: false, drop: 20, cut: 10 },
    infl: { mu: 2, sd: 1 },
    ret: {},
    weightsSrc: 'target',
    bollo: true
  };
}

function currentWeights() {
  const by = {};
  for (const h of S.holdings) {
    const k = hCls(h);
    by[k] = (by[k] || 0) + h.qty * h.price;
  }
  return by;
}

function fireInputs() {
  const F = { ...fireDefaults(), ...(S.fire || {}) };
  const iv = invVal(),
    basis = invCost();
  const cashIn = F.inclCash ? Math.max(0, cash() - (F.emergencyMonths * F.spending) / 12) : 0;
  const tgt =
    S.target && S.target.weights && Object.values(S.target.weights).some(v => v > 0)
      ? S.target.weights
      : null;
  let weights = F.weightsSrc === 'target' && tgt ? { ...tgt } : currentWeights();
  if (!Object.values(weights).some(v => v > 0)) weights = { azioni: 60, obbligazioni: 40 };
  const terW = S.holdings.reduce((s, h) => s + h.qty * h.price * (+h.ter || 0), 0),
    ter = iv ? terW / iv : 0.2;
  const taxW = S.holdings.reduce((s, h) => s + h.qty * h.price * EN.TAX[hTax(h)].rate, 0),
    taxRate = iv ? taxW / iv : 26;
  return {
    F,
    p: {
      age: +F.age,
      endAge: +F.endAge,
      mode: F.mode,
      retireAge: +F.retireAge,
      maxWorkAge: +F.maxWorkAge,
      spending: +F.spending,
      saving: +F.saving,
      savingGrowth: +F.savingGrowth,
      start: iv + cashIn + (+F.extraStart || 0),
      basis: basis + cashIn + (+F.extraStart || 0),
      weights,
      ret: F.ret,
      infl: F.infl,
      swr: +F.swr,
      taxRate,
      ter,
      bollo: F.bollo,
      pension: F.pension,
      sideIncome: F.side,
      flex: F.flex,
      seed: 4242
    },
    iv,
    cashIn,
    ter,
    taxRate
  };
}

/** Runs the Monte Carlo FIRE simulation and the stress scenarios. */
function runFire() {
  const { p } = fireInputs();
  if (!(p.age > 0)) return toast('Inserisci la tua età');
  fireBusy = true;
  renderView();
  setTimeout(() => {
    try {
      const main = EN.simulate({ ...p, runs: 2000 });
      const lean = EN.simulate({ ...p, spending: p.spending * 0.75, runs: 800 }),
        fat = EN.simulate({ ...p, spending: p.spending * 1.5, runs: 800 });
      const stress = ['crash', 'lostdecade', 'stagflation'].map(s => ({
        s,
        r: EN.simulate({ ...p, shock: s, runs: 800 })
      }));
      const safeAge =
        p.mode === 'age'
          ? p.retireAge
          : main.fireAge && main.reached >= 0.5
            ? Math.round(main.fireAge.p50)
            : p.maxWorkAge;
      const safe = EN.safeSpending({ ...p, mode: 'age', retireAge: safeAge, runs: 400 }, 0.9);
      const realRet = EN.expectedReturn(p.weights, p.ret || {}) - (p.infl ? p.infl.mu : 2) - p.ter;
      const horizon = safeAge - p.age;
      fireRes = {
        main,
        lean,
        fat,
        stress,
        safe,
        safeAge,
        realRet,
        coast: EN.coastNumber(main.fireNumber, p.retireAge - p.age, realRet),
        horizon,
        p,
        at: Date.now()
      };
    } catch (e) {
      toast('Errore nella simulazione: ' + e.message);
    }
    fireBusy = false;
    renderView();
  }, 30);
}

function fanChart(r, p) {
  const W = innerWidth < 820 ? 360 : 700,
    H = 250,
    pl = 52,
    pr = 10,
    pt = 14,
    pb = 26,
    iw = W - pl - pr,
    ih = H - pt - pb,
    n = r.ages.length;
  const top = niceTop(Math.max(r.fireNumber * 1.1, ...r.bands.p90.slice(0, n))),
    X = i => pl + (i / (n - 1)) * iw,
    Y = v => pt + ih - (ih * Math.min(v, top)) / top;
  const area = (a, b) =>
    a.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('') +
    b
      .map((v, i) => i)
      .reverse()
      .map(i => 'L' + X(i).toFixed(1) + ',' + Y(b[i]).toFixed(1))
      .join('') +
    'Z';
  const line = a => a.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('');
  let g = axisY(top, pl, pt, ih, W, pr, v => kfmt(v));
  const step = n > 40 ? 10 : 5;
  for (let i = 0; i < n; i++)
    if (r.ages[i] % step === 0)
      g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${r.ages[i]}</text>`;
  g += `<path d="${area(r.bands.p90, r.bands.p10)}" fill="var(--s-blue)" opacity=".16"/><path d="${area(r.bands.p75, r.bands.p25)}" fill="var(--s-blue)" opacity=".32"/><path d="${line(r.bands.p50)}" fill="none" stroke="var(--s-blue)" stroke-width="2.2"/>`;
  if (r.fireNumber < top)
    g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(r.fireNumber)}" y2="${Y(r.fireNumber)}" stroke="var(--s-orange)" stroke-dasharray="5 4" stroke-width="1.5"/><text x="${W - pr}" y="${Y(r.fireNumber) - 5}" text-anchor="end" style="fill:var(--s-orange)">Numero FIRE ${kfmt(r.fireNumber)}</text>`;
  const ra =
    p.mode === 'age' ? p.retireAge : r.fireAge && r.reached >= 0.5 ? Math.round(r.fireAge.p50) : p.maxWorkAge;
  if (ra && ra > p.age && ra < p.age + n - 1) {
    const i = ra - p.age;
    g += `<line x1="${X(i)}" x2="${X(i)}" y1="${pt}" y2="${pt + ih}" stroke="var(--tx2)" stroke-dasharray="2 3"/><text x="${X(i) + 4}" y="${pt + 10}" style="fill:var(--tx2)">ritiro ${ra}</text>`;
  }
  for (let i = 0; i < n; i++)
    g += `<rect x="${X(i) - iw / (n - 1) / 2}" y="${pt}" width="${iw / (n - 1)}" height="${ih}" fill="transparent" data-tip="${r.ages[i]} anni (euro di oggi)\nScenario buono (90°): ${eur0(r.bands.p90[i])}\nMediano: ${eur0(r.bands.p50[i])}\nScenario cattivo (10°): ${eur0(r.bands.p10[i])}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${g}</svg>`;
}

const probChip = v =>
  v >= 0.9
    ? '<span class="chip c-good">✓ Solido</span>'
    : v >= 0.75
      ? '<span class="chip c-warn">! Discreto</span>'
      : '<span class="chip c-crit">✕ Fragile</span>';

const pctI = v => Math.round(v * 100) + '%';

function fld(label, name, val, opt = {}) {
  return `<div class="fld" style="margin:0"><label>${label}</label>${opt.select ? `<select class="inp" name="${name}">${opt.select.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>` : `<input class="inp num" name="${name}" value="${esc(val ?? '')}" ${opt.ph ? `placeholder="${opt.ph}"` : ''} inputmode="decimal" style="font-size:15px">`}</div>`;
}

function vFire() {
  const { F, p, iv, cashIn, ter, taxRate } = fireInputs();
  const r = fireRes && fireRes.main;
  const ret = { ...Object.fromEntries(EN.CLASSES.map(c => [c.k, { mu: c.mu, sd: c.sd }])), ...(F.ret || {}) };
  const ws = Object.entries(p.weights).filter(([, v]) => v > 0);
  const wsum = ws.reduce((s, [, v]) => s + v, 0);
  const form = `<form id="fireform"><div class="grid g4" style="gap:10px">
    ${fld('La tua età', 'age', F.age, { ph: 'es. 35' })}${fld('Età fine piano', 'endAge', F.endAge)}
    ${fld('Quando smetti di lavorare', 'mode', F.mode, {
      select: [
        ['fire', 'Appena raggiungo il numero FIRE'],
        ['age', "A un'età fissa"]
      ]
    })}
    ${F.mode === 'age' ? fld('Età di ritiro', 'retireAge', F.retireAge) : fld('Età massima di lavoro', 'maxWorkAge', F.maxWorkAge)}
    ${fld('Spesa annua da finanziare (€ di oggi)', 'spending', F.spending)}${fld('Risparmio investito al mese (€)', 'saving', F.saving)}
    ${fld('Crescita annua del risparmio (%)', 'savingGrowth', F.savingGrowth)}${fld('Tasso di prelievo per il numero FIRE (%)', 'swr', F.swr)}
    ${fld('Pensione pubblica netta (€/anno, oggi)', 'pension_amount', F.pension.amount)}${fld("…dall'età di", 'pension_fromAge', F.pension.fromAge)}
    ${fld('Lavoretto/part-time da FIRE (€/anno)', 'side_amount', F.side.amount)}${fld("…fino all'età di", 'side_untilAge', F.side.untilAge)}
    ${fld('Includi liquidità (oltre il fondo emergenza)', 'inclCash', F.inclCash ? '1' : '0', {
      select: [
        ['1', 'Sì'],
        ['0', 'No']
      ]
    })}${fld('Fondo emergenza (mesi di spesa)', 'emergencyMonths', F.emergencyMonths)}
    ${fld('Altro capitale da aggiungere (€)', 'extraStart', F.extraStart)}${fld(
      'Spesa flessibile nei mercati negativi',
      'flex_on',
      F.flex.on ? '1' : '0',
      {
        select: [
          ['0', 'No'],
          ['1', 'Sì: taglio la spesa']
        ]
      }
    )}
    ${fld('Taglio spesa (%) se il capitale scende del 20%', 'flex_cut', F.flex.cut)}${fld(
      'Allocazione da usare',
      'weightsSrc',
      F.weightsSrc,
      {
        select: [
          ['target', 'Obiettivo (Investimenti → Allocazione)'],
          ['current', 'Attuale']
        ]
      }
    )}
    ${fld('Inflazione media (%)', 'infl_mu', F.infl.mu)}${fld('Volatilità inflazione (%)', 'infl_sd', F.infl.sd)}
  </div>
  <details style="margin-top:12px"><summary class="hint" style="cursor:pointer">Ipotesi di rendimento per classe (nominali annue, modificabili)</summary>
   <table class="tbl"><thead><tr><th>Classe</th><th class="r">Peso</th><th class="r">Rendimento medio %</th><th class="r">Volatilità %</th></tr></thead><tbody>
   ${EN.CLASSES.map(c => `<tr><td>${c.label}</td><td class="r num">${wsum ? Math.round(((p.weights[c.k] || 0) / wsum) * 100) : 0}%</td><td class="r"><input class="inp num" name="mu_${c.k}" value="${ret[c.k].mu}" style="width:80px;text-align:right"></td><td class="r"><input class="inp num" name="sd_${c.k}" value="${ret[c.k].sd}" style="width:80px;text-align:right"></td></tr>`).join('')}
   </tbody></table><p class="hint" style="margin-top:6px;line-height:1.5">Valori prudenziali di partenza. I rendimenti reali derivano sottraendo l'inflazione simulata. Il modello usa code grasse (t di Student) e correlazioni tra classi.</p></details>
  <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn pri" type="submit">${fireBusy ? 'Calcolo…' : '▶ Salva e simula'}</button><button class="btn ghost" type="button" data-act="fire-reset">Ripristina valori dai miei dati</button></div></form>`;
  const head = `<div class="card"><div class="card-h"><div><h3>🔥 Simulazione FIRE</h3><div class="hint">Monte Carlo · 2.000 scenari · calcolato sul tuo dispositivo, nessun dato inviato</div></div></div>
    <div class="hint" style="margin-bottom:12px;line-height:1.55">Capitale di partenza: investimenti ${eur0(iv)}${cashIn ? ` + liquidità ${eur0(cashIn)}` : ''}${+F.extraStart ? ` + ${eur0(+F.extraStart)}` : ''} = <b style="color:var(--tx)">${eur0(p.start)}</b> · costi medi ${String(ter.toFixed(2)).replace('.', ',')}%/anno · aliquota media sui guadagni ${Math.round(taxRate)}% · bollo 0,2%</div>${form}</div>`;
  if (!r)
    return (
      head +
      `<div class="card" style="margin-top:14px"><div class="empty">${fireBusy ? 'Simulo 2.000 futuri possibili…' : 'Inserisci la tua età e premi “Salva e simula”.'}</div></div>`
    );
  const R = fireRes,
    m = R.main;
  const ageTxt =
    p.mode === 'age'
      ? `Ritiro a ${p.retireAge} anni`
      : m.fireAge && m.reached >= 0.5
        ? `${Math.round(m.fireAge.p50)} anni`
        : `oltre i ${p.maxWorkAge}`;
  return (
    head +
    `
  <div class="grid g4" style="margin-top:14px">
    <div class="card kpi"><div class="lbl">Probabilità di successo</div><div class="val num">${pctI(m.success)} ${probChip(m.success)}</div><div class="foot">non finire i soldi prima dei ${p.endAge} anni</div></div>
    <div class="card kpi"><div class="lbl">Numero FIRE</div><div class="val num">${eur0(m.fireNumber)}</div><div class="foot">${eur0(p.spending)}/anno al ${String(p.swr).replace('.', ',')}%</div></div>
    <div class="card kpi"><div class="lbl">${p.mode === 'age' ? 'Età di ritiro' : 'Età FIRE stimata'}</div><div class="val num">${ageTxt}</div><div class="foot">${p.mode === 'age' ? 'scelta da te' : m.reached >= 0.5 ? `ottimista ${Math.round(m.fireAge.p10)} · prudente ${Math.round(m.fireAge.p90)} · numero raggiunto nel ${pctI(m.reached)} dei casi` : `numero FIRE raggiunto solo nel ${pctI(m.reached)} dei casi entro i ${p.maxWorkAge} anni: negli altri smetti a ${p.maxWorkAge}`}</div></div>
    <div class="card kpi"><div class="lbl">Spesa sostenibile al 90%</div><div class="val num">${eur0(R.safe)}</div><div class="foot">all'anno (euro di oggi) se smetti a ${R.safeAge} anni</div></div>
  </div>
  <div class="card" style="margin-top:14px"><div class="card-h"><div><h3>Patrimonio nel tempo (euro di oggi)</h3><div class="hint">Banda chiara: 80% degli scenari · banda scura: 50% · linea: scenario mediano</div></div><div class="legend"><span><i style="background:var(--s-blue)"></i>Mediano</span><span><i style="background:var(--s-orange)"></i>Numero FIRE</span></div></div>${fanChart(m, p)}
    <div class="hint" style="margin-top:8px">A ${p.endAge} anni: mediano ${eur0(m.final.p50)} · scenario cattivo ${eur0(m.final.p10)} · buono ${eur0(m.final.p90)}${m.ruinAgeMedian ? ` · quando fallisce, i soldi finiscono in media a ${Math.round(m.ruinAgeMedian)} anni` : ''}</div></div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Lean · Regular · Fat FIRE</h3>
      <table class="tbl"><thead><tr><th>Stile di vita</th><th class="r">Spesa/anno</th><th class="r">Numero FIRE</th><th class="r">${p.mode === 'fire' ? 'Età mediana' : 'Successo'}</th></tr></thead><tbody>
      ${[
        ['Lean (−25%)', R.lean, p.spending * 0.75],
        ['Regular', m, p.spending],
        ['Fat (+50%)', R.fat, p.spending * 1.5]
      ]
        .map(
          ([l, x, s]) =>
            `<tr><td>${l}</td><td class="r num">${eur0(s)}</td><td class="r num">${eur0(x.fireNumber)}</td><td class="r num">${p.mode === 'fire' ? (x.fireAge && x.reached >= 0.5 ? Math.round(x.fireAge.p50) + ' anni' : 'oltre ' + p.maxWorkAge) + ' · ' + pctI(x.success) : pctI(x.success)}</td></tr>`
        )
        .join('')}</tbody></table>
      <div class="bcard" style="margin-top:12px"><div class="k"><span>Coast FIRE a ${p.retireAge} anni</span>${p.start >= R.coast ? '<span class="chip c-good">✓ raggiunto</span>' : ''}</div><div class="v num">${eur0(R.coast)} <small>oggi</small></div>
      <div class="f"><span>Con questo capitale potresti smettere di risparmiare e arrivare comunque al numero FIRE a ${p.retireAge} anni (rendimento reale atteso ${String(R.realRet.toFixed(1)).replace('.', ',')}%).</span></div><div class="bar"><i style="width:${Math.min(100, (p.start / R.coast) * 100)}%;background:var(--good)"></i></div></div></div>
    <div class="card"><h3>Prove di stress</h3><p class="hint" style="margin:4px 0 8px">Cosa succede se le cose vanno male proprio all'inizio della pensione.</p>
      <table class="tbl"><thead><tr><th>Scenario</th><th class="r">Successo</th><th class="r">Differenza</th></tr></thead><tbody>
      <tr><td>Normale</td><td class="r num">${pctI(m.success)}</td><td class="r">—</td></tr>
      ${R.stress.map(({ s, r: x }) => `<tr><td>${{ crash: 'Crollo del 40% nel primo anno di pensione', lostdecade: 'Decennio perduto: azioni ferme 10 anni', stagflation: 'Stagflazione: inflazione 7% per 10 anni' }[s]}</td><td class="r num">${pctI(x.success)} ${probChip(x.success)}</td><td class="r num down">${Math.round((x.success - m.success) * 100)} pt</td></tr>`).join('')}
      </tbody></table>
      <p class="hint" style="margin-top:10px;line-height:1.55">Le leve più efficaci: spesa flessibile nei mercati negativi, qualche anno di part-time, o un tasso di prelievo più basso. È una simulazione con ipotesi, non una previsione né consulenza finanziaria.</p></div>
  </div>`
  );
}
