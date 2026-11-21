#!/usr/bin/env bash
# SIMULATED INGRESS browser tests -- NOT Home Assistant acceptance tests.
#
# Topology (private docker network that reuses the Supervisor address plan):
#
#   Playwright (pinned official image)
#        |  http://ha:8123/api/hassio_ingress/<token>/...
#   tests/ingress/proxy.mjs   "simulated Home Assistant", address 172.30.32.2
#        |  prefix stripped, X-Ingress-Path + X-Forwarded-* added
#   App container, ingress port 8099          (or upstream 8095 for the baseline)
#
# Usage:
#   tests/ingress/run.sh                         test local/lmm-c-app:dev
#   LMM_IMAGE=<ref> tests/ingress/run.sh         test another App image
#   LMM_MODE=baseline LMM_APP_PORT=8095 LMM_IMAGE=<upstream> tests/ingress/run.sh
#        runs the same browser session against the unmodified upstream image
#        and REPORTS the requests that leave the prefix instead of failing.
#   LMM_KEEP=1 LMM_GATEWAY_HOST_PORT=18123
#                keep the containers and publish the gateway on
#                http://127.0.0.1:18123/api/hassio_ingress/<token>/ for manual use
#                (nothing is published on the host otherwise)
#
# Results: tests/.artifacts/playwright/ (report.json, evidence/*.json, screenshots).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/harness.sh
source "$HERE/../lib/harness.sh"

LMM_MODE="${LMM_MODE:-strict}"
TOKEN="sim$(random_token)"
PREFIX="/api/hassio_ingress/$TOKEN"
SETUP_CODE="set$(random_token)"
PW_OUT="$ARTIFACTS/playwright"
C_PW=lmm-c-playwright
V_PW=lmm-c-playwright-deps

log "SIMULATED INGRESS browser tests (mode: $LMM_MODE) -- not a Home Assistant acceptance test"
require_image || exit 1
harness_cleanup
ensure_network || exit 1
[[ "${LMM_KEEP:-0}" == "1" ]] || trap harness_cleanup EXIT
rm -rf "$PW_OUT"; mkdir -p "$PW_OUT"

# ---- application under test -------------------------------------------------
fresh_volume
if [[ "$LMM_MODE" == "baseline" ]]; then
  # Unmodified upstream: configured by environment, no options file.
  docker run -d --name "$C_APP" --network "$LMM_NET" --network-alias app -v "$V_DATA":/data \
    -e VERIFIER_MAJ=non -e LANGUE=en -e "ADMIN_MOT_DE_PASSE=$SETUP_CODE" \
    -e MQTT_URL=mqtt://127.0.0.1:1 "$LMM_IMAGE" >/dev/null
else
  write_options "$(jq -cn --arg c "$SETUP_CODE" '{log_language:"en", ha_mqtt_enabled:false, setup_code:$c}')"
  start_app
fi
wait_healthy || { log "FAIL: application did not become healthy"; exit 1; }

# ---- simulated Home Assistant gateway ----------------------------------------
declare -a publish=()
[[ -n "${LMM_GATEWAY_HOST_PORT:-}" ]] && publish=(-p "127.0.0.1:${LMM_GATEWAY_HOST_PORT}:8123")
docker run -d --name "$C_GW" --network "$LMM_NET" --ip "$LMM_GATEWAY_IP" --network-alias ha \
  "${publish[@]}" \
  -e TARGET_HOST=app -e TARGET_PORT="$LMM_APP_PORT" -e INGRESS_TOKEN="$TOKEN" \
  -v "$HERE/proxy.mjs":/proxy.mjs:ro "$NODE_IMAGE" node /proxy.mjs >/dev/null
for _ in $(seq 1 30); do
  gateway_get /__harness/ready >/dev/null && break
  sleep 0.5
done
if ! probe="$(gateway_get "$PREFIX/sante")" || [[ "$probe" != *'"ok":true'* ]]; then
  log "FAIL: gateway cannot reach the application: GET <prefix>/sante -> ${probe:-no answer}"
  docker logs "$C_GW" 2>&1 | tail -5; docker logs "$C_APP" 2>&1 | tail -10
  exit 1
fi
log "gateway ready: http://ha:8123/api/hassio_ingress/<token>/ -> app:$LMM_APP_PORT (gateway address $LMM_GATEWAY_IP)"
[[ -n "${LMM_GATEWAY_HOST_PORT:-}" ]] && log "published for manual use: http://127.0.0.1:${LMM_GATEWAY_HOST_PORT}$PREFIX/"

# ---- browser tests -------------------------------------------------------------
# Test dependencies are installed from the lockfile into a docker volume (not
# into the repository); the browsers come with the pinned image.
docker volume create "$V_PW" >/dev/null
rm_containers "$C_PW"
docker run --name "$C_PW" --network "$LMM_NET" --ipc=host --init \
  -v "$HERE":/tests:ro -v "$V_PW":/work -v "$PW_OUT":/artifacts/playwright \
  -e CI=1 -e GATEWAY_URL=http://ha:8123 -e INGRESS_PREFIX="$PREFIX" -e SETUP_CODE="$SETUP_CODE" \
  -e LMM_MODE="$LMM_MODE" -e EXTERNAL_ALLOW="${EXTERNAL_ALLOW:-}" -e PW_OUTPUT_DIR=/artifacts/playwright \
  -e PW_ARGS="${PW_ARGS:-}" \
  "$PLAYWRIGHT_IMAGE" bash -c '
    set -e
    cp /tests/package.json /tests/package-lock.json /tests/playwright.config.mjs /tests/ingress.spec.mjs /work/
    cd /work
    if [ ! -d node_modules/@playwright/test ] || ! cmp -s package-lock.json node_modules/.lmm-lock; then
      npm ci --no-audit --no-fund --ignore-scripts >/dev/null
      cp package-lock.json node_modules/.lmm-lock
    fi
    # shellcheck disable=SC2086
    exec npx --no-install playwright test $PW_ARGS'
status=$?
docker run --rm -v "$PW_OUT":/a --entrypoint sh "$NODE_IMAGE" -c "chown -R $(id -u):$(id -g) /a" >/dev/null 2>&1 || true

# ---- evidence ------------------------------------------------------------------
gateway_get /__harness/escapes >"$PW_OUT/gateway-escapes-final.json" || true
docker logs "$C_APP" >"$PW_OUT/app.log" 2>&1 || true
if grep -qF "$SETUP_CODE" "$PW_OUT/app.log"; then
  log "FAIL: the setup code appears in the application log"
  status=1
fi
sed -i "s/$SETUP_CODE/<setup-code>/g; s/$TOKEN/<token>/g" "$PW_OUT"/*.json "$PW_OUT"/*.log "$PW_OUT"/evidence/*.json 2>/dev/null || true

log ""
log "==== simulated Ingress summary (mode: $LMM_MODE, image: $LMM_IMAGE) ===="
if [[ -f "$PW_OUT/report.json" ]]; then
  pass_word="PASS"; [[ "$LMM_MODE" == "baseline" ]] && pass_word="RAN "
  jq -r --arg pass "$pass_word" '
    [.. | objects | select(has("specs")) | .specs[]? | . as $s | .tests[]? |
      { title: $s.title, project: .projectName, status: (.results[-1].status // "unknown"),
        notes: [.annotations[]? | select(.type != "skip" and .type != "serial") | "\(.type): \(.description)"] }]
    | .[] | "\(.status | ascii_upcase | if . == "PASSED" then $pass elif . == "SKIPPED" then "SKIP" elif . == "FAILED" or . == "TIMEDOUT" then "FAIL" else . end)  [\(.project)] \(.title)" , (.notes[] | "        " + .[0:400])' \
    "$PW_OUT/report.json" | sed "s/$TOKEN/<token>/g"
else
  log "no report.json produced"
fi
if [[ "$LMM_MODE" == "baseline" ]]; then
  log ""
  log "Baseline mode: tests only RAN; escapes are evidence and nothing above is a pass."
  log "Distinct URLs requested outside the prefix (as seen by the gateway):"
  jq -r '[.allEscapes[] | "\(.kind) \(.method) \(.url | split("?")[0])"] | unique | .[]' "$PW_OUT/gateway-escapes-final.json" 2>/dev/null | sed 's/^/  /' | head -80
fi
log "artifacts: $PW_OUT"
exit "$status"
