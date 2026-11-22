#!/usr/bin/env bash
# EyeCash – first installation on a Linux server with Docker.
# Usage:  git clone https://github.com/CrisBilli/eyecash && cd eyecash && bash install.sh
# Safe to run again: it never touches existing data or settings.
set -euo pipefail
cd "$(dirname "$0")"

echo "== EyeCash $(cat VERSION) – installation =="
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "✘ Docker with the compose plugin is required: https://docs.docker.com/engine/install/"
  exit 1
fi

# settings and data folder (the app runs as user 1000 inside the container)
[ -f .env ] || { cp .env.example .env; chmod 600 .env; echo "✔ Created .env (no AI configured: everything stays on this server)"; }
mkdir -p data
if [ "$(stat -c %u data)" != "1000" ]; then sudo chown -R 1000:1000 data; fi

docker compose up -d --build --remove-orphans
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8080/api/status >/dev/null 2>&1; then
    echo
    echo "✔ EyeCash is running on http://127.0.0.1:8080 (this server only)."
    echo
    echo "Next steps:"
    echo "  1. Reach it from your phone with Tailscale:  sudo tailscale serve --bg 8080"
    echo "     then open the https://<server>.<tailnet>.ts.net address it prints."
    echo "  2. Create your password in the app (it encrypts your data: don't lose it)."
    echo "  3. Optional AI, cloud or fully local:  bash setup-ai.sh"
    exit 0
  fi
  sleep 2
done
echo "✘ EyeCash did not start. Last logs:"; docker compose logs --tail 30; exit 1
