#!/usr/bin/env bash
# EyeCash – esegue i test automatici del server dentro un container usa-e-getta.
# Non tocca l'app in esecuzione né i tuoi dati.  Uso:  bash test.sh
set -euo pipefail
cd "$(dirname "$0")"
docker run --rm -v "$PWD":/app:ro -w /app -e NODE_NO_WARNINGS=1 node:22-alpine node --test tests/api.test.js tests/engine.test.js tests/local-ai.test.js
