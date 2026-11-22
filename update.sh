#!/usr/bin/env bash
# EyeCash – aggiornamento sicuro. Non tocca mai data/ né .env.
# Usage:  bash update.sh   (from the EyeCash folder)
set -euo pipefail
cd "$(dirname "$0")"
echo "== EyeCash: aggiornamento alla versione $(cat VERSION 2>/dev/null || echo '?') =="

# 1. cartella dati con i permessi giusti (l'app gira come utente 1000)
mkdir -p data
if [ "$(stat -c %u data)" != "1000" ]; then sudo chown -R 1000:1000 data; fi
[ -f .env ] || cp .env.example .env

# 1b. with a git checkout, get the latest version first
if [ -d .git ]; then git pull --ff-only; fi

# 2. copia di sicurezza del database prima di aggiornare (a container fermo = copia coerente)
SNAP="$PWD-snapshot-$(date +%Y%m%d-%H%M%S)"
if [ -f data/pointofcash.db ]; then
  docker compose stop >/dev/null 2>&1 || true
  mkdir -p "$SNAP" && cp -a data/pointofcash.db* "$SNAP"/
  echo "✔ Copia di sicurezza (cifrata) in $SNAP"
fi

# 3. ricostruisci e riavvia
# --remove-orphans replaces the container of older versions (named "pointofcash")
docker compose up -d --build --remove-orphans

# 4. verifica
for i in $(seq 1 15); do
  if OUT=$(curl -fsS http://127.0.0.1:8080/api/status 2>/dev/null); then
    echo "✔ EyeCash attivo: $OUT" | cut -c1-120
    echo "Tutto ok. Puoi cancellare la copia $SNAP tra qualche giorno."
    exit 0
  fi
  sleep 2
done
echo "✘ L'app non risponde. Ultimi log:"; docker compose logs --tail 30
echo "Per tornare indietro: docker compose stop && cp -a $SNAP/* data/ && docker compose up -d"
exit 1
