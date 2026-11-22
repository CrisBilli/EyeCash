#!/usr/bin/env bash
# EyeCash – choose (or change) the optional AI provider. Writes .env and restarts.
# Usage:  bash setup-ai.sh
# Keys are typed without being shown and never end up in the shell history.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env

cat <<'TXT'
Which AI do you want to use? (The app works without any.)
  1) Local model with Ollama, started here by Docker   – free, nothing leaves your network
  2) Ollama already installed on this server            – free, nothing leaves your network
  3) Other local server (LM Studio, llama.cpp, vLLM)    – free, nothing leaves your network
  4) Anthropic Claude (API key)                         – best quality, also reads PDF statements
  5) OpenAI-compatible cloud API (OpenAI, OpenRouter, Mistral…)
  6) No AI
TXT
read -rp "Choice [1-6]: " C
LINES=""; PROFILE=""
ask_key() { read -rsp "$1 (hidden): " K; echo; K="$(printf '%s' "$K" | tr -d '[:space:]')"; }
case "$C" in
  1) read -rp "Model [qwen2.5:7b]: " M; M=${M:-qwen2.5:7b}
     LINES="AI_PROVIDER=ollama\nOLLAMA_URL=http://ollama:11434\nAI_MODEL=$M"; PROFILE="--profile ollama" ;;
  2) read -rp "Model [qwen2.5:7b]: " M; M=${M:-qwen2.5:7b}
     LINES="AI_PROVIDER=ollama\nOLLAMA_URL=http://host.docker.internal:11434\nAI_MODEL=$M" ;;
  3) read -rp "Server URL [http://host.docker.internal:1234/v1]: " U; U=${U:-http://host.docker.internal:1234/v1}
     read -rp "Model name: " M
     LINES="AI_PROVIDER=local\nOPENAI_BASE_URL=$U\nAI_MODEL=$M" ;;
  4) ask_key "Anthropic key (sk-ant-...)"
     [[ "$K" =~ ^sk-ant-[A-Za-z0-9_-]{20,}$ ]] || { echo "✘ That does not look like an Anthropic key. Nothing changed."; exit 1; }
     LINES="AI_PROVIDER=anthropic\nANTHROPIC_API_KEY=$K\nAI_WEB_SEARCH=true" ;;
  5) read -rp "API URL [https://api.openai.com/v1]: " U; U=${U:-https://api.openai.com/v1}
     ask_key "API key"; read -rp "Model name: " M
     LINES="AI_PROVIDER=openai\nOPENAI_BASE_URL=$U\nOPENAI_API_KEY=$K\nAI_MODEL=$M" ;;
  6) LINES="" ;;
  *) echo "Nothing changed."; exit 0 ;;
esac

cp -a .env ".env.bak-$(date +%Y%m%d-%H%M%S)"
# remove previous active AI settings (commented lines stay)
sed -i -E '/^(AI_PROVIDER|ANTHROPIC_API_KEY|AI_WEB_SEARCH|OPENAI_BASE_URL|OPENAI_API_KEY|OLLAMA_URL|AI_MODEL|AI_MODEL_FAST)=/d' .env
[ -n "$LINES" ] && printf "\n# AI – set by setup-ai.sh on %s\n$LINES\n" "$(date '+%Y-%m-%d %H:%M')" >> .env
chmod 600 .env .env.bak-* 2>/dev/null || true
unset K

docker compose $PROFILE up -d --remove-orphans >/dev/null
if [ "$C" = "1" ]; then
  echo "Downloading the model $M (a few GB, only the first time)…"
  docker compose exec -T ollama ollama pull "$M"
fi
for i in $(seq 1 15); do
  if OUT=$(curl -fsS http://127.0.0.1:8080/api/status 2>/dev/null); then
    if [ -z "$LINES" ]; then echo "✔ AI turned off."; exit 0; fi
    if echo "$OUT" | grep -q '"ai":true'; then
      echo "✔ AI is on. Reload the app and choose what to enable in Settings → Privacy."; exit 0
    fi
  fi
  sleep 2
done
echo "✘ The app does not report the AI as active. Last logs:"; docker compose logs --tail 20 eyecash; exit 1
