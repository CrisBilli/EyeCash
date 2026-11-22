# EyeCash · Novità

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
