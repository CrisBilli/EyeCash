#!/usr/bin/env bash
# EyeCash – run every test suite: Node (server, engine, local AI) and the browser
# end-to-end suites (Python + Playwright + Chrome) against fake AI and price servers.
# Usage:  bash tests/run-all.sh          (from the repository root)
#         CHROME=/path/to/chrome bash tests/run-all.sh
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=8091
export NODE_NO_WARNINGS=1

echo "== Node suites"
node --test tests/engine.test.js tests/api.test.js tests/local-ai.test.js 2>&1 | grep -E "^# (pass|fail)|^not ok"

echo "== Browser suites"
node tests/mock_ai.js >/dev/null 2>&1 & MOCK1=$!
node tests/mock_quotes.js >/dev/null 2>&1 & MOCK2=$!
trap 'kill $MOCK1 $MOCK2 ${SRV:-} 2>/dev/null' EXIT
sleep 1
ENV=(AI_PROVIDER=openai AI_MODEL=mock OPENAI_API_KEY=x OPENAI_BASE_URL=http://127.0.0.1:8099/v1
  YAHOO_URLS=http://127.0.0.1:8098 STOOQ_URL=http://127.0.0.1:8098 KRAKEN_URL=http://127.0.0.1:8098
  COINGECKO_URL=http://127.0.0.1:8098 ECB_URL=http://127.0.0.1:8098/ecb.xml JUSTETF_URL=http://127.0.0.1:8098
  YAHOO_COOKIE_URL=http://127.0.0.1:8098/cookie PORT=$PORT)
start() { DATA=$(mktemp -d); env "${ENV[@]}" DATA_DIR="$DATA" node server.js >/dev/null 2>&1 & SRV=$!; sleep 1.2; }
stop() { kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; rm -rf "$DATA"; }
FAIL=0
run() { out=$(POC_URL=http://localhost:$PORT POC_DB="$DATA/pointofcash.db" timeout 400 python3 "tests/$1.py" 2>&1); p=$(grep -c '^PASS' <<<"$out"); f=$(grep -c '^FAIL' <<<"$out")
  err=$(grep -m1 'Error' <<<"$out" | cut -c1-140); echo "$1: $p pass, $f fail $err"; [ "$f" = 0 ] && [ -z "$err" ] || FAIL=1; }
# these three share one data folder, in this order
start; for t in e2e_browser e2e_quotes e2e_fire; do run $t; done; stop
for t in e2e_assets e2e_stats e2e_invest_ask e2e_offline e2e_privacy e2e_report; do start; run $t; stop; done
exit $FAIL
