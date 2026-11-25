#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
fixture=$(mktemp -d "$root/node_modules/.probe-XXXXXXXX")
pid=""
stop_worker() {
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    pid=""
  fi
}
cleanup() {
  stop_worker
  rm -rf "$fixture"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

# Isolate Wrangler's configuration, credentials and D1 state from the developer's checkout.
cp -R "$root/src" "$root/migrations" "$root/wrangler.jsonc" "$fixture/"
mkdir "$fixture/web"
cp "$root/web/public-info.ts" "$fixture/web/"
cp "$root/tests/e2e/google-provider.mjs" "$fixture/src/"
{ echo 'import "./google-provider.mjs";'; cat "$root/src/index.ts"; } >"$fixture/src/index.ts"
cd "$fixture"
wrangler="$root/node_modules/.bin/wrangler"
export WRANGLER_SEND_METRICS=false NO_COLOR=1
"$wrangler" d1 migrations apply DB --local --env=""
for mode in code raw; do
  "$wrangler" dev --local --env="" --port 0 --inspector-port 0 --ip 127.0.0.1 \
    --var "SETUP_TOKEN:local-probe" --var "MCP_MODE:$mode" >worker.log 2>&1 &
  pid=$!
  base=""
  for ((i=0; i<150; i++)); do
    base=$(sed -nE 's|.*Ready on (http://127\.0\.0\.1:[0-9]+).*|\1|p' worker.log | tail -1)
    [[ -z "$base" ]] || break
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  if [[ -z "$base" ]]; then cat worker.log >&2; exit 1; fi
  if [[ "$mode" == code && -n "${CHROME_BIN:-}" ]]; then
    "$CHROME_BIN" --headless --disable-gpu --no-first-run --user-data-dir="$fixture/chrome" \
      --virtual-time-budget=5000 --dump-dom "$base" >dashboard.html
    grep -Eq '<button[^>]*>Unlock setup</button>' dashboard.html
    echo "PASS Chrome rendered the dashboard sign-in form"
  fi
  BASE="$base" MODE="$mode" SETUP_TOKEN=local-probe node "$root/tests/e2e/probe.mjs"
  if [[ "$mode" == raw ]]; then
    "$wrangler" d1 execute DB --local --env="" --command="INSERT INTO settings (key,value,updated_at) VALUES ('oauth_state:expired','expired',unixepoch()-901),('oauth_state','legacy',unixepoch())"
    BASE="$base" SETUP_TOKEN=local-probe node "$root/tests/e2e/google-flows.mjs"
    if [[ -n "${CHROME_BIN:-}" ]]; then
      BASE="$base" SETUP_TOKEN=local-probe CHROME_BIN="$(command -v "$CHROME_BIN")" node "$root/tests/e2e/workspace.mjs"
    fi
  fi
  stop_worker
done
