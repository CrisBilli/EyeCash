/* EyeCash – tests for the advisor benchmark (bench/): stable made-up data, 100 questions, grader. */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { build } = require('../bench/dataset.js');
const { make } = require('../bench/tools.js');
const { questions } = require('../bench/questions.js');
const { numbers, verdictOf, grade } = require('../bench/grade.js');

test('banco di prova: dati inventati sempre identici', () => {
  const h = d => crypto.createHash('sha256').update(JSON.stringify(d)).digest('hex');
  assert.equal(h(build()), h(build()));
  const T = make(build());
  const o = T.run('get_overview');
  assert.ok(o.emergency_fund_months_covered < 6, 'il fondo emergenza è volutamente sotto i 6 mesi');
  assert.ok(
    T.run('get_portfolio').by_asset_class.find(c => c.asset_class === 'azioni').difference_pct > 5,
    'portafoglio volutamente sbilanciato'
  );
  assert.equal(o.regular_investing_monthly, 300);
});

test('banco di prova: 100 domande con id unici e attese valide', () => {
  const Q = questions(make(build()));
  assert.equal(Q.length, 100);
  assert.equal(new Set(Q.map(q => q.id)).size, 100);
  for (const q of Q) {
    for (const n of q.nums || []) assert.ok(isFinite(n.v), q.id + ' ' + n.label);
    for (const v of q.anyNum || []) assert.ok(isFinite(v), q.id);
    for (const g of q.mention || []) for (const p of g) new RegExp(p, 'i');
    for (const p of q.avoid || []) new RegExp(p, 'i');
  }
});

test('banco di prova: lettura di cifre e verdetti', () => {
  assert.deepEqual(
    numbers('2.408,77 € · 2.409 € · 17,4% · 1,250.50 · 3,5 mila · 11.533'),
    [2408.77, 2409, 17.4, 1250.5, 3500, 11533]
  );
  assert.equal(verdictOf('**Sì, ma** aspetta marzo'), 'careful');
  assert.equal(verdictOf('No, non adesso.'), 'no');
  assert.equal(verdictOf('Sì, te lo puoi permettere.'), 'yes');
  const q = { tools: ['get_overview'], nums: [{ v: 507.9, label: 'risparmio' }], verdict: 'yes' };
  const ok = grade(q, { answer: 'Sì: risparmi circa 508 € al mese.', steps: [{ name: 'get_overview' }] });
  assert.equal(ok.pass, true);
  const ko = grade(q, { answer: 'Risparmi 900 €.', steps: [] });
  assert.equal(ko.pass, false);
  assert.ok(ko.score < 0.5);
});
