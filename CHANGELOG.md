# EyeCash · Novità

## 1.5.3
- **Nuova pagina del progetto** con una demo di 70 secondi in italiano e in inglese: le risposte dell'Occhio sono quelle vere di un modello locale (qwen3:8b su una scheda da 8 GB), i dati sono di una persona inventata.
- **Quanto costa un'AI privata in casa:** una tabella con tre fasce di scheda video (8, 24 e 48 GB), il costo indicativo, il modello consigliato e il livello atteso per cifre, pareri e consigli. Cosa è misurato e cosa è atteso è scritto chiaramente, con le fonti.
- **Patrimonio:** il riquadro degli investimenti mostrava "0 posizioni" anche con il portafoglio pieno. Ora conta le posizioni giuste.
- **Banco di prova:** salva i risultati dopo ogni domanda. Se il PC si spegne o si interrompe, `--resume` riprende da dove si era fermato; `--pause 5` aspetta qualche secondo tra una domanda e l'altra, per non scaldare troppo la scheda.

## 1.5.2
- **L'Occhio legge i dati come serve.** Con l'AI locale ha un nuovo strumento: totali con qualsiasi filtro (testo o esercente, categoria, date, giorno della settimana, importi, conto) e raggruppati per categoria, mese, giorno della settimana, giorno, esercente o conto. Ad esempio: "quanto ho speso di martedì nell'ultimo mese?", "in che giorno spendo di più?", "quanto nei weekend di ottobre?". Anche la ricerca dei movimenti accetta giorno della settimana e conto.
- **Istruzioni più chiare al modello:**
  - sa che giorno è oggi e cosa vuol dire "ultimo mese" (30 giorni), "mese scorso" e "quest'anno";
  - risponde sempre nella lingua dell'app;
  - va dritto alla conclusione, senza emoji né "Risposta:" (le emoji vengono comunque tolte).
- **Simulazioni più giuste:** i versamenti periodici negli investimenti (ad esempio un PAC) escono dai conti ma non sono spese. Il miglior mese per un acquisto ora si cerca fino a 5 anni avanti.
- **Banco di prova:** sono nel repository le 104 domande su una persona inventata, per misurare quanto è bravo un modello come Occhio (`bench/`, istruzioni in `bench/README.md`). Si possono lanciare anche dal server, con un container usa e getta.
- **Barra in basso:** su telefono l'occhio è esattamente al centro, tra Home e Movimenti a sinistra e Patrimonio e Investimenti a destra. "Altro" passa in alto, al posto dell'ingranaggio, e contiene anche Impostazioni.

## 1.5.1
- **Si vede sempre chi risponde.**
  - In alto nell'Occhio c'è lo stato, con un pallino colorato: AI locale con il nome del modello, AI esterna con il servizio, oppure "Sul dispositivo".
  - Sotto ogni risposta c'è "Risposto da", che può essere AI locale, AI esterna (solo la domanda), il telefono senza AI, oppure il telefono con l'AI di casa spenta.
- **AI locale spenta:**
  - l'Occhio controlla se il modello di casa risponde (al server basta un controllo rapido, senza contattare servizi esterni) e lo dice in alto;
  - cifre, simulazioni e spese vengono risposte comunque sul telefono;
  - le domande che richiedono il modello restano in coda, salvate cifrate, e partono da sole quando il PC si riaccende;
  - una domanda in coda si può annullare.
- **Barra in basso:** l'occhio è più piccolo e c'è anche Investimenti.
- **Anello delle spese:** le categorie molto piccole (ad esempio 4 € su 1.700 €) si sovrapponevano alle vicine. Ora ogni fetta ha una lunghezza minima visibile e lo spazio viene preso dalle più grandi.
- **"% della media"** si calcola solo sui mesi precedenti che hanno movimenti. Con pochi mesi importati, i mesi vuoti abbassavano la media e il confronto usciva gonfiato (ad esempio "310%").

## 1.5.0 · L'Occhio
- **Tutta l'interazione con i dati è nell'Occhio.** Toccando il logo al centro della barra si apre un'unica conversazione, che prende il posto di "Chiedi ai tuoi dati" e di "Posso permettermelo?". Puoi:
  - chiedere cifre;
  - chiedere un parere ("conviene…?");
  - simulare un acquisto: il verdetto e il grafico della liquidità compaiono nella risposta, con *Modifica nel simulatore* per i dettagli;
  - raccontare una spesa ("ho speso 12,50 € al bar"): l'Occhio la propone e tu la registri, la modifichi o la annulli. C'è anche il microfono.

  In alto trovi cosa c'è di nuovo da leggere. La conversazione è salvata cifrata.
- **Risponde in modo diverso a seconda dell'AI**, e lo dice sotto l'occhio:
  - **AI locale:** è un vero agente. Il modello usa strumenti che girano sul dispositivo (quadro generale, spese per categoria, ricerca nei movimenti, ricorrenti, obiettivi, portafoglio, beni e debiti, simulazione della liquidità, rata) e ragiona sui numeri veri. Nulla esce di casa, e il server rifiuta questa modalità se l'AI configurata è esterna.
  - **AI esterna:** alla cieca, come prima. Esce solo la domanda e i numeri li calcola il dispositivo.
  - **Senza AI od offline:** sul dispositivo vengono capite le domande rapide, le cifre semplici (categoria, esercente e periodo, ad esempio "quanto ho speso in ristoranti negli ultimi 6 mesi?"), le simulazioni d'acquisto e le spese.
- **Menu più semplice:** spariscono le voci "Chiedi" e "Posso permettermelo?".
- **Modello locale predefinito:** `qwen3:8b`, che sa usare gli strumenti e sta in una GPU da 8 GB. Chi ha già impostato `AI_MODEL` non deve cambiare nulla.
- Corretto il riconoscimento di frasi come "12,50 € bar": il simbolo € non finisce più nella descrizione.

## 1.4.0 · Nuovo stile
- **Nuovo logo:** un occhio con la palpebra inferiore che è un grafico in salita. Nuove icone dell'app, nuova favicon e nuova schermata di sblocco.
- **Nuovo tema scuro, ora predefinito:**
  - sfondo profondo con due bagliori colorati, diversi per ogni sezione;
  - card con profondità;
  - pulsanti a pillola;
  - icone delle categorie in tessere colorate sfumate;
  - cifre grandi in Inter Display.

  Il tema chiaro resta disponibile in Impostazioni, rivisto con lo stesso sistema.
- **Font inclusi nell'app:** Inter e Inter Display sono serviti dal tuo server. Nessuna richiesta a servizi esterni (licenza OFL in `public/fonts`).
- **Meno emoji:** spunti, beni, debiti, "Lo sapevi?", impostazioni e pulsanti usano icone disegnate, coerenti con le categorie.
- **Il consulente è l'occhio:**
  - **su telefono** sta al centro di una barra in basso fluttuante in vetro;
  - **su computer** è in cima al menu laterale.

  L'occhio ha tre stati:
  - **a riposo** respira piano;
  - **quando c'è qualcosa da leggere** (una spesa che corre più della media, una scadenza vicina) il grafico diventa arancione e l'occhio sbatte le palpebre, finché non lo apri;
  - **mentre l'AI elabora una richiesta** l'occhio guarda a destra e a sinistra.

  Toccandolo vedi cosa c'è di nuovo, gli spunti e le scorciatoie per "Chiedi ai tuoi dati", "Posso permettermelo?" e FIRE. Tutto è calcolato sul dispositivo. Per ricordare cosa hai già letto, l'app salva solo un numero, mai il testo.
- **Menu riordinato** in tre aree: Finanze, Pianifica, Analisi. Su telefono Investimenti si trova in *Altro*.
- **Home nuova:**
  - in cima c'è l'anello delle spese del mese diviso per categoria, con il totale al centro e quanto hai speso rispetto alla media;
  - sotto, le categorie con il numero di movimenti, l'importo, la percentuale e una barretta colorata;
  - quando c'è qualcosa da leggere, compare una scheda arancione del consulente;
  - nuovo grafico **Giorno per giorno**, con le uscite di ogni giorno e la linea della media.
- **Patrimonio:**
  - in cima c'è il patrimonio netto in grande, con l'andamento degli ultimi 12 mesi e quanto è cambiato;
  - accanto c'è "Da cosa è fatto", con una barra di composizione e le righe Conti, Carta, Investimenti, Beni e Debiti.
- **Investimenti:**
  - un anello mostra la ripartizione per tipo di strumento, con al centro il valore del portafoglio e il guadagno;
  - una card Rendimento mostra capitale investito, valore attuale e guadagno o perdita;
  - i ticker sono colorati per tipo.
- **Statistiche:**
  - puoi scegliere una categoria (o tutte le spese) e vedere la media al mese, le barre mese per mese con la linea della media (il mese in corso è tratteggiato) e i principali esercenti;
  - sotto restano i dettagli: KPI, tabelle e mappa di calore.
- **Movimenti:** in cima c'è un riepilogo con uscite ed entrate del mese e le barre per giorno. Segue i filtri di mese, categoria e ricerca. "Importa estratto conto" diventa un pulsante più discreto.

## 1.3.0 · Il consulente
- **Chiedi un parere, non solo una cifra.** In "Chiedi ai tuoi dati" puoi scrivere *"Tra un mese spendo 15.000 €, il prossimo anno vorrei un PC da 3.000: conviene?"*. La risposta contiene:
  - un verdetto chiaro (Sì / Sì, ma da… / No);
  - i motivi con i tuoi numeri veri;
  - i valori principali e il grafico della liquidità mese per mese, con le spese segnate.
- **Funziona senza far uscire i tuoi dati.** L'AI riceve solo la domanda e restituisce una "ricetta": le spese future (anche a rate, mensili o entrate) e le regole da verificare. Il telefono simula sui dati reali e scrive la risposta. In *Come è stato calcolato* vedi eventi e regole usati.
- **Domande di seguito:** *"e se lo prendo a rate?"*, *"e tra sei mesi?"*.
- **Collegato al simulatore:** le domande su un acquisto mostrano anche *Apri nel simulatore*.
- **AI locale più affidabile:** con Ollama il server del modello è obbligato a restituire JSON valido, e il prompt contiene un esempio completo. Consigliati modelli da 7–8B.

## 1.2.1 · Domande più libere
- **"Posso permettermelo?" capisce più domande:**
  - *"Posso fare un mutuo da 200k in 20 anni?"*: 200.000 € è l'importo del mutuo, non il prezzo della casa; anche "in 20" senza "anni" vale come durata;
  - domande generali come *"che mutuo posso permettermi?"* o *"quanto posso spendere per un'auto?"*: trova il prezzo più alto che supera i controlli con i tuoi numeri, usando come anticipo la liquidità oltre il fondo emergenza.
- Da "Chiedi ai tuoi dati" anche "posso fare un mutuo…", "un finanziamento da…" e simili portano al simulatore. Le domande sulle spese ("quanto pago di rata del mutuo?") restano in "Chiedi".
- **Tema chiaro:** gli interruttori accesi tornano verdi (prima sembravano tutti spenti).
- Un IBAN scritto nella domanda non viene più scambiato per un prezzo.

## 1.2.0 · Posso permettermelo?
- **Nuova schermata "Posso permettermelo?"** per mutuo, auto o qualsiasi grande acquisto, simulati sulle tue entrate, spese, risparmi e rate reali. Mostra:
  - un verdetto chiaro: sì, con attenzione, non ancora;
  - la rata mensile e gli interessi totali;
  - i controlli che farebbe una banca: rate sul reddito, mutuo sul prezzo, fondo di emergenza che resta, risparmio dopo l'acquisto;
  - il prezzo massimo consigliato e tra quanti mesi avresti anticipo e fondo pronti;
  - la liquidità dei prossimi 3 anni, con e senza l'acquisto.
- Il calcolo si aggiorna mentre scrivi. L'affitto viene preso dai costi ricorrenti: con il mutuo smetteresti di pagarlo.
- **Domande a parole**, anche senza AI: *"posso permettermi un'auto da 25.000 € a rate in 5 anni?"*. Con l'AI attiva esce solo la frase; entrate, spese e saldi restano sul dispositivo.
- Ci arrivi dal menu, dal report (*Simula un acquisto*, accanto alla rata sostenibile) e da "Chiedi ai tuoi dati".
- In italiano e in inglese.
- Correzione privacy: il filtro che maschera gli IBAN prima di chiamare l'AI scambiava per IBAN alcune frasi normali con numeri (es. "da 30000 a rate in 4 anni") e le cancellava. Ora riconosce gli IBAN anche scritti in minuscolo e con gli spazi.

## 1.1.0 · Interfaccia in inglese
- **Cambio lingua:** l'app parte nella lingua del telefono (italiano o inglese) e si cambia in *Impostazioni → Dati e sicurezza → 🌐 Lingua*.
- In inglese importi, numeri e mesi seguono il formato inglese (€1,234.56, "January 2026").
- "Chiedi ai tuoi dati" risponde nella lingua scelta, anche quando la risposta la scrive l'AI.
- L'inserimento rapido capisce anche l'inglese ("12.50 pizza yesterday card").
- Cambiando lingua i dati non cambiano: le categorie restano salvate allo stesso modo.
- Nuove schermate e nuovi video di presentazione, in inglese e in italiano, con l'app nella lingua giusta.
- Correzioni: due testi sulle quotazioni automatiche erano stati modificati per errore; i mesi dentro le frasi hanno ora le maiuscole corrette.

## 1.0.0 · Prima versione pubblica
EyeCash è un'app di finanza personale che gira sul tuo server di casa, con i dati cifrati sul dispositivo dalla tua password.

**Ogni giorno**
- Conti, carte di credito, risparmio e contanti con saldi aggiornati; inserimento veloce con importo e icona della categoria, oppure a voce o per testo.
- Movimenti giorno per giorno, spese ricorrenti, budget con quanto puoi spendere al giorno, obiettivi.
- Importazione degli estratti conto (CSV, Excel, vecchi .xls, PDF con AI): formati ricordati per banca, categorie automatiche, doppioni riconosciuti anche rispetto alle spese segnate a mano, gestione delle carte di credito. Provata con gli export Fineco.

**Il quadro generale**
- Patrimonio netto con beni (auto con deprezzamento, case) e debiti (mutui con piano di ammortamento).
- Investimenti: più portafogli, prezzi automatici da fonti pubbliche, allocazione obiettivo e ribilanciamento, fiscalità italiana, storico delle operazioni con rendimento annuo (XIRR).
- Statistiche, simulatore FIRE Monte Carlo e "Chiedi ai tuoi dati": l'AI scrive solo la ricetta, i conti li fa il telefono.
- Report per te o per il consulente (mese, anno, ultimi 12 mesi) con gli indicatori di salute finanziaria, compresa la rata aggiuntiva sostenibile; versione "solo sintesi" senza esercenti né movimenti.

**Privacy**
- Cifratura end-to-end (PBKDF2 + AES-256-GCM): il server conserva solo dati cifrati e non riceve mai la password.
- Backup giornalieri cifrati e backup cifrato scaricabile dall'app.
- Sblocco con Face ID / Touch ID / Windows Hello, blocco automatico, saldi oscurati, contenuto nascosto nel multitasking, dati cifrati arrotondati a blocchi di 16 KB.
- AI facoltativa e anche locale (Ollama, LM Studio, llama.cpp, vLLM): ogni funzione ha il suo interruttore e ogni invio è registrato.
- Accesso MCP (Claude Desktop) solo in scrittura.
- Modalità offline con copia cifrata sul dispositivo.

**Progetto**
- Zero dipendenze, nessuna compilazione; installazione con `bash install.sh`, AI con `bash setup-ai.sh`, aggiornamento con `bash update.sh`.
- Test automatici di server, motore di calcolo e browser, controllo ESLint e Prettier a ogni modifica.
- Licenza Apache 2.0 con credito all'autore (file NOTICE).
