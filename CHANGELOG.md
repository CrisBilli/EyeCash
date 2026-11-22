# EyeCash · Novità

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
