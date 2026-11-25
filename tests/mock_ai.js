const http = require('http');
const fs = require('fs');
http
  .createServer((q, r) => {
    let b = '';
    q.on('data', d => (b += d));
    q.on('end', () => {
      const j = JSON.parse(b);
      const last = j.messages[j.messages.length - 1];
      const u = last.content;
      fs.appendFileSync('/tmp/mockai.log', JSON.stringify(j.messages) + '\n');
      // the advisor chat (local model with tools): one tool call, then an answer from its result
      if (j.tools && last.role === 'user') {
        const call = /auto/i.test(u)
          ? ['simulate_cashflow', { events: [{ label: 'Auto', amount: 20000, month: 2 }], target_index: 0 }]
          : /ristoranti/i.test(u)
            ? ['search_transactions', { category: 'Ristoranti', limit: 5 }]
            : ['get_overview', {}];
        return r.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'c1',
                      type: 'function',
                      function: { name: call[0], arguments: JSON.stringify(call[1]) }
                    }
                  ]
                }
              }
            ]
          })
        );
      }
      if (last.role === 'tool') {
        const x = JSON.parse(last.content);
        const out =
          last.name === 'get_overview'
            ? `**Stai andando bene.**\n- Risparmi circa ${x.avg_monthly_saving} € al mese\n- Liquidità: ${x.cash} €`
            : last.name === 'simulate_cashflow'
              ? `**${x.verdict === 'safe' ? 'Sì' : 'Non ancora'}.** Mese sicuro: ${x.earliest_safe_month_for_target}. Liquidità minima ${x.cash_lowest} €.`
              : `Ho trovato ${x.count} movimenti, totale ${x.total} €.`;
        return r.end(JSON.stringify({ choices: [{ message: { content: '<think>calcolo</think>' + out } }] }));
      }
      let out = '{}';
      if (/Traduci la domanda/.test(u)) {
        if (/«[^»]*ristoranti[^»]*»/i.test(u))
          out =
            'Ecco la ricetta: {"title":"Ristoranti: quest\'anno e l\'anno scorso","queries":[{"id":"a","source":"movimenti","measure":"totale","type":"uscite","categories":["Ristoranti","INVENTATA"],"text":"<script>x","from":"2026-01-01","to":"2026-12-31","group":"nessuno"},{"id":"b","source":"movimenti","measure":"totale","type":"uscite","categories":["Ristoranti"],"from":"2025-01-01","to":"2025-12-31","group":"nessuno"},{"id":"c","source":"movimenti","measure":"totale","type":"uscite","categories":["Ristoranti"],"group":"mese","from":"2025-01-01","to":"2026-12-31"}],"answer":"Quest\'anno {a}, l\'anno scorso {b} ({change:a:b}). Il mese più caro: {c.top}. <b>","chart":{"query":"c","kind":"linea"}}';
        else
          out =
            '{"queries":[],"clarify":"Posso rispondere solo a domande sui tuoi movimenti o investimenti."}';
      } else if (/RICETTA/.test(u))
        out = /«[^»]*meteo[^»]*»/.test(u)
          ? '{"events":[],"checks":[],"clarify":"Posso aiutarti solo con domande sui tuoi soldi."}'
          : '{"title":"PC dopo una spesa grande","events":[{"label":"Spesa","amount":15000,"month":1},{"label":"PC","amount":3000,"month":' +
            (/«[^»]*rate[^»]*»/.test(u) ? '1,"financed":{"months":12,"ratePct":0,"down":0}' : '1') +
            '}],"target":1,"checks":[{"expr":"cash_min >= 0","ok":"Non vai mai in rosso.","ko":"Andresti in rosso a {first_negative_month}."},{"expr":"cash_after_target >= emergency_target","soft":true,"ok":"Dopo il PC resti sopra il fondo emergenza di {emergency_target}.","ko":"Dopo il PC, a {target_month}, scenderesti a {cash_after_target}: sotto il fondo emergenza di {emergency_target}."}],"answer":{"yes":"Sì, puoi prenderlo.","careful":"Sì, ma aspetta: da {best_month} è sicuro.","no":"No, non adesso."},"show":["cash_after_target","emergency_target","best_month","saving"],"clarify":""}';
      else if (/parametri di un acquisto/.test(u))
        out = /«[^»]*mutuo[^»]*»/.test(u)
          ? '{"kind":"mortgage","loanAmount":200000,"price":null,"years":20}'
          : !/«[^»]*casa[^»]*»/.test(u)
            ? '{"kind":"car","label":"auto","price":30000,"years":4,"payCash":false}'
            : 'Ecco: {"kind":"mortgage","label":"Casa <b>a Torino","price":"260000","downPayment":40000,"extraCosts":null,"ratePct":95,"years":25,"payCash":null,"income":3000}';
      else if (/Trasforma questa frase/.test(u))
        out =
          '{"type":"uscita","amount":23.5,"description":"Pizzeria Da Mario","date":"2026-11-09","category":"Ristoranti","account_hint":"carta"}';
      else if (/valore_min/.test(u))
        out =
          '{"valore_min":15000,"valore_centrale":16500,"valore_max":18000,"affidabilita":"media","deprezzamento_annuo_pct":11,"motivazione":"Basata su annunci simili.","confronti":[{"descrizione":"Golf 2020 60.000 km","prezzo":16900}]}';
      else if (/Categorizza/.test(u)) out = '[{"i":0,"cat":"Shopping"}]';
      else if (/prime righe di un estratto/.test(u))
        out =
          '{"bank_name":"Banca Strana","header_row":0,"date_col":0,"date_format":"DMY","desc_cols":[2],"amount_col":3,"debit_col":null,"credit_col":null,"decimal":",","expenses_positive":false}';
      r.writeHead(200, { 'content-type': 'application/json' });
      r.end(JSON.stringify({ choices: [{ message: { content: out } }] }));
    });
  })
  .listen(8099);
