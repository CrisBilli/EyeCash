# EyeCash: guida completa

Questa guida porta da zero a EyeCash funzionante sul telefono, su un server Linux di casa (Ubuntu o Debian). Per una panoramica del progetto vedi il [README](../README.it.md).

## Come è protetto
- **Niente porte aperte su internet.** L'app ascolta solo su `127.0.0.1`; da fuori si entra con **Tailscale**, una VPN privata. La vedono solo i tuoi dispositivi.
- **Dati cifrati nel browser** (AES-256-GCM) con una chiave derivata dalla tua password (PBKDF2, 600.000 iterazioni). Il server conserva solo testo cifrato: anche chi ruba il disco o un backup non legge nulla.
- **La password non arriva mai al server.** ⚠️ Se la perdi, i dati non sono recuperabili: salvala in un password manager.
- **AI facoltativa e anche locale.** Saldi, conti, investimenti e obiettivi non vengono mai inviati. Ogni invio si può spegnere ed è registrato (*Impostazioni → Privacy*). Con un modello locale (Ollama) non esce nulla dalla tua rete.
- **MCP solo in scrittura.** Claude può aggiungere spese ma non leggerle. Le spese arrivano cifrate con la chiave pubblica dell'app.
- Nessuna libreria esterna: solo Node.js e Docker. Il container gira in sola lettura e senza privilegi.

## 1. Prerequisiti (una volta)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades     # aggiornamenti di sicurezza automatici
sudo usermod -aG docker $USER && newgrp docker
```
Firewall: blocca tutto in ingresso (SSH solo se ti serve).
```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow OpenSSH        # facoltativo
sudo ufw enable
```

## 2. Installa EyeCash
```bash
git clone https://github.com/CrisBilli/eyecash.git
cd eyecash
bash install.sh
```
`install.sh` crea il file di configurazione `.env` e la cartella `data/`, avvia l'app e verifica che risponda. Si può rilanciare quando vuoi: non tocca mai dati e impostazioni esistenti.

## 3. Accesso dal telefono e da fuori casa (Tailscale)
1. Sul server: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`
2. Nella console di Tailscale (login.tailscale.com) → **DNS**: attiva **MagicDNS** e **HTTPS Certificates**.
3. Sul server: `sudo tailscale serve --bg 8080`. Ti dà un indirizzo del tipo `https://nomeserver.tuo-tailnet.ts.net`.
4. Installa l'app **Tailscale** sul telefono e sul computer, con lo stesso account.
5. Apri l'indirizzo, crea la password, poi installa l'app:
   - **iPhone/iPad:** Safari → Condividi → *Aggiungi alla schermata Home*
   - **Android:** Chrome → menu ⋮ → *Installa app*
   - **Computer:** Chrome o Edge → icona di installazione nella barra dell'indirizzo; Safari su Mac → *File → Aggiungi al Dock*

Per verificare che l'app non sia esposta su internet: `sudo ss -tlnp | grep 8080` deve mostrare solo `127.0.0.1:8080`.

## 4. AI (facoltativa)
Il modo più semplice è lo script guidato:
```bash
bash setup-ai.sh
```
Puoi scegliere tra:
- **Modello locale con Ollama** (gratis, non esce nulla dalla tua rete). Lo script lo avvia con Docker e scarica il modello (alcuni GB, solo la prima volta). Serve un server con almeno 8 GB di RAM.
- **Ollama, LM Studio o altri server locali** già installati.
- **Anthropic Claude** con chiave API: la qualità migliore, e legge anche gli estratti conto in PDF.
- **Altre API compatibili OpenAI** (OpenAI, OpenRouter, Mistral…).

Cosa fa l'AI (ogni voce si accende o spegne in *Impostazioni → Privacy*):

| Funzione | Cosa viene inviato |
|---|---|
| Inserimento rapido | solo la frase che scrivi o detti |
| Chiedi ai tuoi dati | la domanda, i nomi delle categorie e il tipo dei conti: i numeri li calcola il telefono |
| Categorizzazione | descrizione e importo dei soli movimenti nuovi senza categoria |
| Formato banca nuovo | intestazioni e al massimo 12 righe, con le cifre degli importi mascherate; una volta per banca, poi il formato viene memorizzato |
| Stima di auto e casa | solo le caratteristiche del bene (mai l'indirizzo) |
| PDF (spento di default) | il PDF intero |

Dettagli, modelli consigliati e configurazione manuale: [AI.md](AI.md) (in inglese).

## 5. Importare i dati della banca
*Movimenti → Importa estratto conto* accetta CSV, Excel e vecchi `.xls`. L'app è stata provata con gli export di **Fineco**:
- movimenti del conto e delle carte;
- *Portafoglio di sintesi*;
- *Movimenti Dossier Titoli*.

Le altre banche passano dal riconoscimento automatico delle colonne. Se un formato non viene riconosciuto, l'AI lo impara una volta guardando poche righe con gli importi mascherati. Prima di salvare vedi sempre un'anteprima con i movimenti nuovi e quelli che avevi già segnato a mano.

Tutti i dettagli sono in [IMPORT.md](IMPORT.md) (in inglese).

## 5b. Report per te o per il consulente
*Menu → Report* (su iPhone in *Altro*). Scegli **mese**, **anno** o **ultimi 12 mesi**, poi *Stampa / Salva PDF*. Il report contiene:
- entrate, uscite, risparmio e patrimonio netto;
- gli **indicatori di salute finanziaria**: tasso di risparmio, fondo di emergenza, spese fisse e rate sul reddito, rata aggiuntiva sostenibile, debiti sul patrimonio, rendimento e costi degli investimenti;
- la composizione del patrimonio, le spese per categoria confrontate con la media e, nella versione completa, tutti i movimenti.

Con **Solo sintesi** esercenti e singoli movimenti spariscono: è la versione da mandare a un consulente. Gli indicatori sono riferimenti orientativi, non una consulenza.

## 6. Claude Desktop via MCP (aggiungere spese a voce o per testo)
1. Nell'app: **Impostazioni → Claude via MCP → Attiva e genera token**. Copia la configurazione mostrata.
2. Sul computer dove usi Claude Desktop (serve Node.js 18+): copia `mcp/eyecash-mcp.js` in una cartella a tua scelta.
3. In Claude Desktop vai su *Impostazioni → Sviluppatore → Modifica configurazione*: incolla il blocco, sostituisci `/PERCORSO/` con il percorso reale e riavvia Claude Desktop.
4. Di' o scrivi a Claude: *"segna 12 euro di benzina con la carta"*. La spesa compare alla prossima apertura dell'app.

Il computer deve avere Tailscale attivo. Per bloccare tutto: **Revoca** nell'app.
Sul telefono usa il tasto **+ → 🎙️ Detta** dentro l'app.

## 7. Backup
Il server salva da solo una copia al giorno in `data/backups/` e la conserva 90 giorni. **Le copie sono già cifrate con la tua password**: senza quella non le legge nessuno. Finché stanno solo sul server, però, si perdono se si rompe il disco. Portale fuori in uno di questi modi:

**A) Copiale sul tuo computer, ogni tanto.**
```bash
scp -r <utente>@<ip-del-server>:~/eyecash/data/backups ./EyeCash-backup
```
Essendo cifrate, puoi tenerle anche su un cloud o su una chiavetta.

**B) Copia automatica ogni notte** su un disco USB, un NAS o un'altra cartella:
```bash
sudo apt install -y rsync
bash ~/eyecash/backup-copy.sh /media/usb/eyecash-backups      # prova una volta
crontab -e     # e aggiungi:
0 3 * * * bash $HOME/eyecash/backup-copy.sh /media/usb/eyecash-backups >> $HOME/eyecash-backup.log 2>&1
```

**C) Dall'app:** *Impostazioni → Dati e sicurezza → ⬇️ Scarica backup cifrato*. È illeggibile senza la tua password e si ripristina da *Ripristina da JSON*, oppure dal server con il comando qui sotto. C'è anche *Esporta copia leggibile*, che però **non è cifrata**: usala solo se ti serve leggere i dati con un altro programma.

**Ripristino** (cambia la data con quella del file che vuoi):
```bash
cd ~/eyecash
docker compose exec eyecash node server.js restore /data/backups/pointofcash-AAAA-MM-GG.json
```
Dopo il ripristino serve comunque la tua password per aprire i dati.

## 8. Aggiornare
```bash
cd ~/eyecash && bash update.sh
```
`update.sh` scarica la nuova versione e ferma l'app. Poi fa una copia di sicurezza del database, ricostruisce, riavvia e verifica che tutto funzioni. Se qualcosa va storto ti mostra il comando per tornare indietro.

Facoltativo: `bash test.sh` esegue i test automatici del server in un container a parte, senza toccare i tuoi dati.

## 9. Quotazioni automatiche: verifica con i dati reali
Prima di fidarti, controlla un tuo titolo direttamente dal server e confrontalo con il broker:
```bash
cd ~/eyecash
docker compose exec eyecash node server.js search IE00B4L5Y983     # elenca i listini con borsa, valuta e prezzo
docker compose exec eyecash node server.js quote SWDA.MI           # prezzo, fonte, ora, controllo incrociato
docker compose exec eyecash node server.js quote BTC Crypto
```
Nell'app: **Investimenti → 🔎 Cerca titolo** (meglio con l'ISIN). Scegli il listino con la stessa borsa e valuta del tuo broker e conferma il prezzo.
Obbligazioni e BTP spesso non hanno una quotazione pubblica affidabile: lasciali con il prezzo inserito a mano.

## 9a. Lingua
L'app si apre nella lingua del telefono: italiano o inglese. Per cambiarla vai in *Impostazioni → Dati e sicurezza → 🌐 Lingua*. Vale per quel dispositivo e i dati non cambiano: per esempio una spesa in "Ristoranti" appare come "Restaurants" in inglese.

## 9b. Privacy sul telefono
In *Impostazioni → Dati e sicurezza*:
- **Blocco automatico:** dopo quanto tempo fuori dall'app serve di nuovo la password (o Face ID). Si sceglie per ogni dispositivo.
- **Sblocco con Face ID / impronta**, **Saldi oscurati** e **Copia offline**.

In più, quando passi a un'altra app il contenuto di EyeCash viene sfocato, così nel multitasking non si vedono i saldi.

## 10. Manutenzione
- Log: `docker compose logs -f eyecash`
- Riavvio: `docker compose restart`
- Password dimenticata: non si recupera. `docker compose exec eyecash node server.js reset --yes` cancella tutto. Poi puoi ripristinare un backup e reimpostare **la stessa password di allora**.

## Installazioni precedenti alla versione pubblica
Le installazioni create prima della versione pubblica 1.0 (quando il progetto si chiamava PointofCash) hanno il container chiamato `pointofcash`. `update.sh` lo sostituisce da solo con il nuovo `eyecash`: dati e impostazioni restano dove sono. Nei comandi, usa `eyecash` al posto di `pointofcash`.
