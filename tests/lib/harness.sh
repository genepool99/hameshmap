#!/usr/bin/env bash
# Shared helpers for tests/integration and tests/ingress.
#
# LOCAL CONTAINER TEST SUPPORT. Nothing here talks to a real Home Assistant
# installation. The "Supervisor", the "Ingress gateway" and the brokers are
# throwaway containers on a private docker network that reuses the Supervisor's
# address plan (172.30.32.0/23, gateway app at 172.30.32.2) so that the App's
# source-address rules can be exercised.
#
# Conventions: containers lmm-c-*, images local/lmm-c-*, host ports bound to
# 127.0.0.1 only, everything removed by tests/lib/cleanup.sh.
# shellcheck shell=bash

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"
# shellcheck source=../images.env
source "$REPO_ROOT/tests/images.env"

LMM_IMAGE="${LMM_IMAGE:-local/lmm-c-app:dev}"
# Port the simulated gateway connects to: 8099 for the App, 8095 for upstream.
LMM_APP_PORT="${LMM_APP_PORT:-8099}"
# Port of the upstream web server inside the container (health endpoint).
LMM_WEB_PORT="${LMM_WEB_PORT:-8095}"
LMM_NET="${LMM_NET:-lmm-c-hassio}"
LMM_SUBNET="${LMM_SUBNET:-172.30.32.0/23}"
LMM_GATEWAY_IP="${LMM_GATEWAY_IP:-172.30.32.2}"   # Home Assistant ingress source address
LMM_PEER_IP="${LMM_PEER_IP:-172.30.33.50}"        # "another App" on the same network
LMM_START_TIMEOUT="${LMM_START_TIMEOUT:-90}"
LMM_STOP_TIMEOUT="${LMM_STOP_TIMEOUT:-10}"        # Supervisor default stop timeout (config.yaml `timeout`)
ARTIFACTS="${LMM_ARTIFACTS:-$REPO_ROOT/tests/.artifacts}"

C_APP=lmm-c-app
C_SUP=lmm-c-supervisor
C_MQ_SUP=lmm-c-mq-supervisor
C_MQ_MAN=lmm-c-mq-manual
C_GW=lmm-c-gateway
C_PEER=lmm-c-peer
V_DATA=lmm-c-data

# ---- reporting --------------------------------------------------------------
declare -a RESULT_NAMES=() RESULT_STATES=() RESULT_NOTES=()
CURRENT_TEST=""
CURRENT_FAILED=0
declare -a CURRENT_NOTES=()

log() { printf '%s\n' "$*"; }
note() { CURRENT_NOTES+=("$*"); log "    note: $*"; }
fail() { CURRENT_FAILED=1; CURRENT_NOTES+=("FAIL: $*"); log "    FAIL: $*"; }
ok() { log "    ok: $*"; }

# skip_test "reason": marks the running test as skipped and returns from it.
SKIPPED_REASON=""
skip() { SKIPPED_REASON="$*"; log "    SKIP: $*"; }

run_test() {
  local name="$1"
  CURRENT_TEST="$name"; CURRENT_FAILED=0; CURRENT_NOTES=(); SKIPPED_REASON=""
  log ""
  log "--- $name"
  # Tests are functions that record failures through fail(); an unexpected
  # command error inside one is also a failure.
  if ! "$name"; then
    if [[ -z "$SKIPPED_REASON" && "$CURRENT_FAILED" -eq 0 ]]; then
      fail "test function returned an error"
    fi
  fi
  local state="PASS"
  if [[ -n "$SKIPPED_REASON" ]]; then state="SKIP"
  elif [[ "$CURRENT_FAILED" -ne 0 ]]; then
    state="FAIL"
    save_logs "$name"
  fi
  RESULT_NAMES+=("$name"); RESULT_STATES+=("$state")
  local IFS=';'
  RESULT_NOTES+=("${SKIPPED_REASON:-${CURRENT_NOTES[*]:-}}")
  log "--- $name: $state"
}

print_summary() {
  local title="$1" failed=0 i
  log ""
  log "==== $title ===="
  log "image under test: $LMM_IMAGE ($(docker image inspect "$LMM_IMAGE" --format '{{.Id}}' 2>/dev/null || echo 'not present'))"
  for i in "${!RESULT_NAMES[@]}"; do
    printf '%-5s %s\n' "${RESULT_STATES[$i]}" "${RESULT_NAMES[$i]}"
    if [[ -n "${RESULT_NOTES[$i]}" ]]; then
      printf '%s\n' "${RESULT_NOTES[$i]}" | tr ';' '\n' | sed 's/^/        /'
    fi
    [[ "${RESULT_STATES[$i]}" == "FAIL" ]] && failed=1
  done
  return "$failed"
}

save_logs() {
  mkdir -p "$ARTIFACTS"
  local c
  for c in "$C_APP" "$C_SUP" "$C_GW"; do
    if docker inspect "$c" >/dev/null 2>&1; then
      docker logs "$c" >"$ARTIFACTS/$1.$c.log" 2>&1 || true
    fi
  done
}

# ---- docker plumbing --------------------------------------------------------
random_token() { head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }

rm_containers() {
  local c
  for c in "$@"; do docker rm -f -v "$c" >/dev/null 2>&1 || true; done
}

harness_cleanup() {
  rm_containers "$C_APP" "$C_SUP" "$C_MQ_SUP" "$C_MQ_MAN" "$C_GW" "$C_PEER" lmm-c-playwright
  docker volume rm -f "$V_DATA" >/dev/null 2>&1 || true
  docker network rm "$LMM_NET" >/dev/null 2>&1 || true
}

# Creates the test network. The canonical Supervisor range is preferred, so
# that the App's default "only 172.30.32.2" rule is what gets exercised. When
# that range is already used on this host, a fallback range is used and the
# App is told about the gateway address through LMM_INGRESS_ALLOW; the run is
# then marked NON-CANONICAL in the output.
LMM_NONCANONICAL=0
ensure_network() {
  if docker network inspect "$LMM_NET" >/dev/null 2>&1; then docker network rm "$LMM_NET" >/dev/null 2>&1 || true; fi
  # Dynamic addresses come from the upper quarter of the range, so the fixed
  # gateway and peer addresses are never handed to another container.
  if docker network create --subnet "$LMM_SUBNET" --ip-range "${LMM_SUBNET%.*.*}.33.128/25" "$LMM_NET" >/dev/null 2>&1; then return 0; fi
  local fallback="${LMM_FALLBACK_SUBNET:-172.31.232.0/23}"
  if docker network create --subnet "$fallback" --ip-range "${fallback%.*.*}.233.128/25" "$LMM_NET" >/dev/null 2>&1; then
    LMM_NONCANONICAL=1
    LMM_SUBNET="$fallback"
    LMM_GATEWAY_IP="${fallback%.*.*}.232.2"
    LMM_PEER_IP="${fallback%.*.*}.233.50"
    log "NOTE: NON-CANONICAL NETWORK. 172.30.32.0/23 is in use on this host, using $fallback."
    log "      The App is started with LMM_INGRESS_ALLOW=$LMM_GATEWAY_IP, so its built-in"
    log "      default allow-list (172.30.32.2) is NOT what this run exercises."
    return 0
  fi
  log "FAIL: cannot create docker network $LMM_NET (tried $LMM_SUBNET and $fallback)."
  log "      Set LMM_SUBNET / LMM_FALLBACK_SUBNET to a free /23 range."
  return 1
}

require_image() {
  if ! docker image inspect "$LMM_IMAGE" >/dev/null 2>&1; then
    if ! docker pull -q "$LMM_IMAGE" >/dev/null 2>&1; then
      log "FAIL: image $LMM_IMAGE not found locally and cannot be pulled."
      log "      Build it with 'make build' or set LMM_IMAGE."
      return 1
    fi
  fi
}

fresh_volume() {
  docker volume rm -f "$V_DATA" >/dev/null 2>&1 || true
  docker volume create "$V_DATA" >/dev/null
}

# write_options <json>: stores /data/options.json the way Supervisor does
# (owned by root, mode 600).
write_options() {
  printf '%s' "$1" | docker run --rm -i --network none -v "$V_DATA":/data \
    --entrypoint sh "$NODE_IMAGE" -c 'cat > /data/options.json && chmod 600 /data/options.json'
}

# start_broker <container> <alias> <user> <password>
start_broker() {
  local name="$1" alias="$2" user="$3" pass="$4"
  rm_containers "$name"
  docker run -d --name "$name" --network "$LMM_NET" --network-alias "$alias" \
    -e MQ_USER="$user" -e MQ_PASS="$pass" --entrypoint sh "$MOSQUITTO_IMAGE" -c '
      set -e
      printf "listener 1883\nallow_anonymous false\npassword_file /mosquitto/config/pw\npersistence false\nlog_dest stdout\n" > /mosquitto/config/test.conf
      : > /mosquitto/config/pw
      chmod 600 /mosquitto/config/pw
      mosquitto_passwd -b /mosquitto/config/pw "$MQ_USER" "$MQ_PASS"
      chown mosquitto:mosquitto /mosquitto/config/pw
      exec mosquitto -c /mosquitto/config/test.conf' >/dev/null
  local i
  for i in $(seq 1 30); do
    if docker exec "$name" mosquitto_pub -h 127.0.0.1 -u "$user" -P "$pass" -t lmm-c/ready -m 1 >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  log "FAIL: broker $name did not become ready"; docker logs "$name" 2>&1 | tail -5
  return 1
}

# mq_dump <container> <user> <password> <topic-filter> [seconds]
# Prints "topic payload" lines for retained and live messages.
mq_dump() {
  docker exec "$1" mosquitto_sub -h 127.0.0.1 -u "$2" -P "$3" -t "$4" -v -W "${5:-3}" 2>/dev/null || true
}

# wait_topic <container> <user> <password> <topic-filter> <timeout-seconds>
wait_topic() {
  docker exec "$1" mosquitto_sub -h 127.0.0.1 -u "$2" -P "$3" -t "$4" -C 1 -W "$5" >/dev/null 2>&1
}

# start_supervisor <mode> <token> [mqtt-host mqtt-user mqtt-pass]
# Fake Supervisor reachable as http://supervisor (port 80), the default base
# URL of the App. mode: mqtt | none | error.
start_supervisor() {
  local mode="$1" token="$2"
  rm_containers "$C_SUP"
  docker run -d --name "$C_SUP" --network "$LMM_NET" --network-alias supervisor \
    -e FAKE_MODE="$mode" -e FAKE_TOKEN="$token" \
    -e FAKE_MQTT_HOST="${3:-}" -e FAKE_MQTT_USER="${4:-}" -e FAKE_MQTT_PASS="${5:-}" \
    -e FAKE_NETWORK="${FAKE_NETWORK:-}" \
    -v "$REPO_ROOT/tests/lib/fake-supervisor.mjs":/fake-supervisor.mjs:ro \
    "$NODE_IMAGE" node /fake-supervisor.mjs >/dev/null
  local i
  for i in $(seq 1 30); do
    if docker exec "$C_SUP" node -e 'fetch("http://127.0.0.1/__harness/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  log "FAIL: fake supervisor did not start"; return 1
}

supervisor_requests() {
  docker exec "$C_SUP" node -e 'fetch("http://127.0.0.1/__harness/requests").then(r=>r.text()).then(t=>console.log(t))' 2>/dev/null || echo '[]'
}

# start_app [extra docker run args...]   (SUPERVISOR_TOKEN is passed when set)
start_app() {
  rm_containers "$C_APP"
  local -a args=(-d --name "$C_APP" --network "$LMM_NET" --network-alias app -v "$V_DATA":/data)
  if [[ -n "${SUPERVISOR_TOKEN_VALUE:-}" ]]; then args+=(-e "SUPERVISOR_TOKEN=$SUPERVISOR_TOKEN_VALUE"); fi
  if [[ "$LMM_NONCANONICAL" == "1" ]]; then args+=(-e "LMM_INGRESS_ALLOW=$LMM_GATEWAY_IP"); fi
  docker run "${args[@]}" "$@" "$LMM_IMAGE" >/dev/null
}

app_running() { [[ "$(docker inspect -f '{{.State.Running}}' "$C_APP" 2>/dev/null)" == "true" ]]; }

# app_http <path>: GET on the upstream web port from inside the container.
# Prints "<status> <body>".
app_http() {
  docker exec -e P="$LMM_WEB_PORT" -e U="$1" "$C_APP" node -e '
    fetch("http://127.0.0.1:" + process.env.P + process.env.U, { signal: AbortSignal.timeout(5000) })
      .then(async (r) => { console.log(r.status + " " + (await r.text()).slice(0, 2000)); })
      .catch((e) => { console.log("000 " + e.message); process.exit(1); });' 2>/dev/null
}

# wait_healthy: waits for GET /sante to answer 200 {"ok":true,...}.
wait_healthy() {
  local deadline=$((SECONDS + LMM_START_TIMEOUT)) out
  while ((SECONDS < deadline)); do
    if ! app_running; then
      log "    app container exited while starting (exit code $(docker inspect -f '{{.State.ExitCode}}' "$C_APP" 2>/dev/null))"
      docker logs "$C_APP" 2>&1 | tail -15 | sed 's/^/      | /'
      return 1
    fi
    out="$(app_http /sante || true)"
    if [[ "$out" == 200\ *'"ok":true'* ]]; then return 0; fi
    sleep 1
  done
  log "    app not healthy after ${LMM_START_TIMEOUT}s (last answer: ${out:-none})"
  docker logs "$C_APP" 2>&1 | tail -15 | sed 's/^/      | /'
  return 1
}

# gateway_get <path>: GET on the simulated gateway from inside its container.
gateway_get() {
  docker exec -e U="http://127.0.0.1:8123$1" "$C_GW" node -e '
    fetch(process.env.U, { signal: AbortSignal.timeout(8000) })
      .then(async (r) => { process.stdout.write(await r.text()); process.exit(r.ok ? 0 : 1); })
      .catch(() => process.exit(1));' 2>/dev/null
}

# http_from <ip> <url> [header...]: GET from a throwaway container that has
# the given address on the test network. Prints "<status> <first 300 bytes>".
http_from() {
  local ip="$1" url="$2"; shift 2
  local -a hdr=()
  local h
  for h in "$@"; do hdr+=(-e "H_${#hdr[@]}=$h"); done
  docker run --rm --network "$LMM_NET" --ip "$ip" -e U="$url" "${hdr[@]}" "$NODE_IMAGE" node -e '
    const headers = {};
    for (const [k, v] of Object.entries(process.env)) if (/^H_\d+$/.test(k)) { const i = v.indexOf(":"); headers[v.slice(0, i)] = v.slice(i + 1).trim(); }
    fetch(process.env.U, { headers, redirect: "manual", signal: AbortSignal.timeout(8000) })
      .then(async (r) => console.log(r.status + " " + (await r.text()).slice(0, 300).replace(/\s+/g, " ")))
      .catch((e) => console.log("000 " + (e.cause && e.cause.code || e.message)));' 2>/dev/null
}

# listening_ports: "addr:port" for every listening TCP socket in the app container.
listening_ports() {
  docker exec "$C_APP" node -e '
    const fs = require("fs");
    const out = new Set();
    for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      let text = "";
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      for (const line of text.split("\n").slice(1)) {
        const c = line.trim().split(/\s+/);
        if (c[3] !== "0A") continue;
        const [addr, port] = c[1].split(":");
        let ip;
        if (addr.length === 8) ip = addr.match(/../g).reverse().map((h) => parseInt(h, 16)).join(".");
        else if (/^0+$/.test(addr)) ip = "[::]";
        else if (/^0{24}01000000$/.test(addr)) ip = "[::1]";
        else if (/^0{16}0000FFFF/i.test(addr)) ip = addr.slice(24).match(/../g).reverse().map((h) => parseInt(h, 16)).join(".");
        else ip = "[" + addr + "]";
        out.add(ip + ":" + parseInt(port, 16));
      }
    }
    console.log([...out].sort().join("\n"));'
}

# app_logs: everything the app container wrote to stdout/stderr.
app_logs() { docker logs "$C_APP" 2>&1; }

# assert_no_secret <label> <text-file> <secret...>: fails if any secret (or its
# URL-encoded or base64 form) occurs in the file. Never prints the secret.
assert_no_secret() {
  local label="$1" file="$2"; shift 2
  local s i=0 enc b64
  for s in "$@"; do
    i=$((i + 1))
    [[ -z "$s" ]] && continue
    enc="$(printf '%s' "$s" | jq -sRr @uri)"
    b64="$(printf '%s' "$s" | base64 | tr -d '=\n')"
    if grep -qF -e "$s" -e "$enc" -e "$b64" "$file"; then
      fail "$label: secret #$i (of $#) appears in the output ($(grep -cF -e "$s" -e "$enc" -e "$b64" "$file") line(s))"
    fi
  done
}
