#!/usr/bin/env bash
# LOCAL CONTAINER TESTS -- NOT Home Assistant acceptance tests.
#
# These tests start the App image with plain `docker run` next to a fake
# Supervisor API, real Mosquitto brokers and a network that imitates the
# Supervisor address plan. They prove how the container behaves given a
# /data/options.json and a Supervisor answer. They do NOT prove that the
# Supervisor accepts the manifest, that Home Assistant creates entities, that
# Ingress works in a browser, or anything about a real installation. See
# docs/testing/test-plan.md.
#
# Usage:
#   tests/integration/run.sh                 run every test
#   tests/integration/run.sh t05_... t11_... run selected tests
#   LMM_IMAGE=<ref> tests/integration/run.sh test an existing image
#   LMM_KEEP=1 ...                           keep containers after the run
#
# Option names used below are those of live-mesh-map/config.yaml; they are
# declared once in options_json() so a rename is a one-place change.
set -uo pipefail
# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../lib/harness.sh"

HA_ROOT="live-mesh-map"   # default of option ha_mqtt_root_topic
DISCOVERY_PREFIX="homeassistant"

# Random per run: nothing secret is stored in the repository.
SUP_USER="addons";   SUP_PASS="sup$(random_token)"
MAN_USER="manual";   MAN_PASS="man$(random_token)"
MESH_PASS="$MAN_PASS"
EXPORT_TOKEN="exp$(random_token)"
SETUP_CODE="set$(random_token)"
SUPERVISOR_TOKEN_VALUE="tok$(random_token)"
ALL_SECRETS=("$SUP_PASS" "$MAN_PASS" "$EXPORT_TOKEN" "$SETUP_CODE" "$SUPERVISOR_TOKEN_VALUE")

# options_json <jq-filter>: sample options with overrides applied.
# The base object is what a user would plausibly save from the options form.
options_json() {
  jq -cn \
    --arg mesh_pass "$MESH_PASS" --arg export "$EXPORT_TOKEN" --arg setup "$SETUP_CODE" \
    --arg man_user "$MAN_USER" --arg man_pass "$MAN_PASS" '
    {
      log_language: "en",
      mesh_mqtt_url: "mqtt://mq-manual:1883",
      mesh_mqtt_username: $man_user,
      mesh_mqtt_password: $mesh_pass,
      mesh_mqtt_root_topic: "msh/EU_868",
      meshcore_enabled: true,
      ha_mqtt_enabled: true,
      ha_mqtt_url: "",
      ha_mqtt_username: "",
      ha_mqtt_password: "",
      ha_mqtt_discovery: true,
      ha_mqtt_lora_send: false,
      export_token: $export,
      setup_code: $setup
    } | '"${1:-.}"
}

# Fails early, with a pointer, when the option names above drifted from the
# App's schema.
check_option_names() {
  local config="$REPO_ROOT/live-mesh-map/config.yaml"
  [[ -f "$config" ]] || { log "note: $config not found; option names cannot be cross-checked"; return 0; }
  local missing
  missing="$(options_json . | "$REPO_ROOT/tests/manifest/run.sh" python3 -c '
import json, sys, yaml
schema = yaml.safe_load(open("live-mesh-map/config.yaml"))["schema"]
print(" ".join(k for k in json.load(sys.stdin) if k not in schema))')"
  if [[ -n "$missing" ]]; then
    log "FAIL: tests/integration/run.sh uses option(s) not in the App schema: $missing"
    log "      Update options_json() to match live-mesh-map/config.yaml."
    return 1
  fi
}

start_stack() { # <options-json> [extra app args...]
  local options="$1"; shift
  start_broker "$C_MQ_SUP" mq-supervisor "$SUP_USER" "$SUP_PASS" || return 1
  start_broker "$C_MQ_MAN" mq-manual "$MAN_USER" "$MAN_PASS" || return 1
  start_supervisor mqtt "$SUPERVISOR_TOKEN_VALUE" mq-supervisor "$SUP_USER" "$SUP_PASS" || return 1
  fresh_volume
  write_options "$options"
  start_app "$@"
}

sup_dump() { mq_dump "$C_MQ_SUP" "$SUP_USER" "$SUP_PASS" "$@"; }
man_dump() { mq_dump "$C_MQ_MAN" "$MAN_USER" "$MAN_PASS" "$@"; }

discovery_topics() { # <dump-function>: sorted discovery config topics
  "$1" "$DISCOVERY_PREFIX/#" 3 | awk '{print $1}' | sort -u
}
discovery_unique_ids() { # <dump-function>: sorted unique_id values
  "$1" "$DISCOVERY_PREFIX/#" 3 | sed -n 's/^[^ ]* //p' | jq -r '.unique_id // empty' 2>/dev/null | sort -u
}

# ---- tests ------------------------------------------------------------------

t01_starts_healthy_on_fresh_volume() {
  start_stack "$(options_json .)" || { fail "stack did not start"; return; }
  wait_healthy || { fail "App not healthy on a fresh volume with sample options"; return; }
  ok "GET /sante answers 200 ok:true"
  local sante; sante="$(app_http /sante)"
  note "health answer: $sante"
  [[ "$sante" == *'"mqtt":true'* ]] || fail "mesh broker not connected according to /sante"
  local health; health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$C_APP")"
  note "docker HEALTHCHECK state: $health"
  [[ "$health" == "none" ]] && note "image defines no HEALTHCHECK (Supervisor uses config.yaml watchdog instead)"
  return 0
}

t02_processes_do_not_run_as_root() {
  app_running || { skip "needs the container from t01"; return; }
  local top; top="$(docker top "$C_APP" -eo uid,pid,args | tail -n +2)"
  local server; server="$(grep 'src/server.js' <<<"$top" || true)"
  [[ -n "$server" ]] || { fail "no 'src/server.js' process found"; return; }
  if awk '{print $1}' <<<"$server" | grep -qx 0; then fail "upstream server runs as uid 0"; else ok "upstream server uid: $(awk '{print $1}' <<<"$server" | sort -u | tr '\n' ' ')"; fi
  local roots; roots="$(awk '$1 == 0' <<<"$top")"
  if [[ -n "$roots" ]]; then
    fail "process(es) still running as root after startup: $(awk '{$1="";$2=""; print}' <<<"$roots" | tr '\n' '|')"
  else ok "no process in the container runs as root"; fi
  local caps; caps="$(docker exec "$C_APP" sh -c 'grep -E "^Cap(Eff|Prm)" /proc/1/status' | tr '\n\t' '  ')"
  note "PID 1 capabilities: $caps"
  [[ "$caps" == *"CapEff: 0000000000000000"* ]] || fail "PID 1 keeps effective capabilities after dropping root"
}

t03_listening_ports_are_as_expected() {
  app_running || { skip "needs the container from t01"; return; }
  local ports expected
  ports="$(listening_ports | tr '\n' ' ' | sed 's/ $//')"
  # Default: no optional port mapped -> upstream ports on loopback only, the
  # Ingress port on all interfaces (source address filtered by the App).
  expected="${LMM_EXPECT_PORTS:-0.0.0.0:8099 127.0.0.1:4404 127.0.0.1:8095}"
  if [[ "$ports" == "$expected" ]]; then ok "listening sockets: $ports"
  else fail "listening sockets are '$ports', expected '$expected'"; fi
  local published; published="$(docker port "$C_APP")"
  [[ -z "$published" ]] || fail "container publishes host ports: $published"
}

t04_ingress_port_accepts_only_the_gateway_address() {
  app_running || { skip "needs the container from t01"; return; }
  local gw peer
  gw="$(http_from "$LMM_GATEWAY_IP" "http://app:$LMM_APP_PORT/sante")"
  peer="$(http_from "$LMM_PEER_IP" "http://app:$LMM_APP_PORT/sante")"
  note "from gateway $LMM_GATEWAY_IP: ${gw:0:60}"
  note "from peer $LMM_PEER_IP: ${peer:0:60}"
  [[ "$gw" == 200\ * ]] || fail "Ingress port does not serve the gateway address"
  [[ "$peer" == 403\ * || "$peer" == 000\ * ]] || fail "Ingress port serves a non-gateway address (answer: ${peer:0:40})"
  local p out
  for p in 8095 4404; do
    out="$(http_from "$LMM_PEER_IP" "http://app:$p/api/installation")"
    if [[ "$out" == 000\ * ]]; then ok "port $p unreachable from another container (${out#000 })"
    else fail "port $p answers another container on the App network: ${out:0:80}"; fi
  done
  # A peer must not be able to pose as the gateway with headers.
  out="$(http_from "$LMM_PEER_IP" "http://app:$LMM_APP_PORT/sante" "X-Forwarded-For: $LMM_GATEWAY_IP" "X-Ingress-Path: /api/hassio_ingress/x")"
  [[ "$out" == 403\ * || "$out" == 000\ * ]] || fail "forged proxy headers let a peer through the Ingress port"
}

t05_setup_wizard_is_not_open_to_ingress_users() {
  app_running || { skip "needs the container from t01"; return; }
  local out
  out="$(http_from "$LMM_GATEWAY_IP" "http://app:$LMM_APP_PORT/api/installation" "X-Ingress-Path: /api/hassio_ingress/x" "X-Forwarded-For: 203.0.113.9")"
  note "GET /api/installation through the Ingress port: ${out:0:120}"
  [[ "$out" == 200\ * ]] || { fail "unexpected answer from /api/installation"; return; }
  local body="${out#200 }"
  [[ "$(jq -r .requise <<<"$body")" == "true" ]] || fail "fresh volume should require installation"
  [[ "$(jq -r .codeRequis <<<"$body")" == "true" ]] || fail "setup code not required: anyone reaching the UI could create the administrator"
  [[ "$(jq -r .reseauLocal <<<"$body")" == "false" ]] || fail "Ingress request is treated as a local-network visitor"
  # Without the X-Forwarded-For a real gateway always adds, the App itself must add one.
  out="$(http_from "$LMM_GATEWAY_IP" "http://app:$LMM_APP_PORT/api/installation")"
  [[ "$(jq -r .codeRequis <<<"${out#200 }" 2>/dev/null)" == "true" ]] || fail "setup code not required when the gateway sends no X-Forwarded-For"
}

t06_secrets_do_not_appear_in_logs() {
  app_running || { skip "needs the container from t01"; return; }
  # Let the home-automation client connect and publish before reading logs.
  wait_topic "$C_MQ_SUP" "$SUP_USER" "$SUP_PASS" "$HA_ROOT/etat" 30 || note "no $HA_ROOT/etat on the Supervisor broker within 30 s"
  mkdir -p "$ARTIFACTS"; local f="$ARTIFACTS/t06.app.log"
  app_logs >"$f"
  note "log lines inspected: $(wc -l <"$f")"
  assert_no_secret "docker logs" "$f" "${ALL_SECRETS[@]}"
  docker inspect "$C_APP" >"$ARTIFACTS/t06.inspect.json"
  # SUPERVISOR_TOKEN is passed by `docker run -e` here, exactly as Supervisor
  # does, so it is expected in `docker inspect`; the option secrets are not.
  assert_no_secret "docker inspect" "$ARTIFACTS/t06.inspect.json" "$SUP_PASS" "$MAN_PASS" "$EXPORT_TOKEN" "$SETUP_CODE"
  docker exec "$C_APP" sh -c 'cat /proc/[0-9]*/cmdline 2>/dev/null | tr "\0" " "' >"$ARTIFACTS/t06.cmdline.txt" 2>/dev/null || true
  assert_no_secret "process command lines" "$ARTIFACTS/t06.cmdline.txt" "${ALL_SECRETS[@]}"
  if grep -Eiq 'setup code [A-Z0-9]{4}-[A-Z0-9]{4}|code d.installation [A-Z0-9]{4}-' "$f"; then
    fail "upstream printed an automatic setup code although the setup_code option is set"
  fi
  rm -f "$ARTIFACTS/t06.inspect.json" "$ARTIFACTS/t06.cmdline.txt" "$f"
}

t07_discovery_topics_on_supervisor_broker_and_stable_across_restart() {
  app_running || { skip "needs the container from t01"; return; }
  wait_topic "$C_MQ_SUP" "$SUP_USER" "$SUP_PASS" "$DISCOVERY_PREFIX/#" 30 || { fail "no discovery message under $DISCOVERY_PREFIX/ on the Supervisor-provided broker"; return; }
  local topics1 ids1 topics2 ids2
  topics1="$(discovery_topics sup_dump)"; ids1="$(discovery_unique_ids sup_dump)"
  note "discovery config topics: $(wc -l <<<"$topics1"), unique_ids: $(wc -l <<<"$ids1")"
  [[ "$(wc -l <<<"$topics1")" -ge 8 ]] || fail "expected at least the 8 map-level entities, got: $(tr '\n' ' ' <<<"$topics1")"
  grep -q "^$DISCOVERY_PREFIX/sensor/$HA_ROOT/noeuds_actifs/config$" <<<"$topics1" || fail "expected topic $DISCOVERY_PREFIX/sensor/$HA_ROOT/noeuds_actifs/config"
  [[ "$(sup_dump "$HA_ROOT/disponibilite" 2 | awk '{print $2}')" == "online" ]] || fail "availability topic is not 'online'"
  [[ "$(wc -l <<<"$ids1")" -eq "$(wc -l <<<"$topics1")" ]] || fail "unique_id count differs from topic count (duplicate or missing unique_id)"
  local manual; manual="$(man_dump "$DISCOVERY_PREFIX/#" 2)$(man_dump "$HA_ROOT/#" 2)"
  [[ -z "$manual" ]] || fail "home-automation topics also appeared on the other broker"

  docker restart -t "$LMM_STOP_TIMEOUT" "$C_APP" >/dev/null
  wait_healthy || { fail "App not healthy after restart"; return; }
  # The broker keeps retained messages across the App restart, so any topic or
  # unique_id that changed would show up as an addition here.
  local i
  for i in $(seq 1 20); do
    [[ "$(sup_dump "$HA_ROOT/disponibilite" 2 | awk '{print $2}')" == "online" ]] && break
    sleep 1
  done
  [[ "$(sup_dump "$HA_ROOT/disponibilite" 2 | awk '{print $2}')" == "online" ]] || fail "availability not 'online' again after restart"
  sleep 3
  topics2="$(discovery_topics sup_dump)"; ids2="$(discovery_unique_ids sup_dump)"
  [[ "$topics1" == "$topics2" ]] || fail "discovery topic set changed across restart: $(diff <(echo "$topics1") <(echo "$topics2") | tr '\n' ' ')"
  [[ "$ids1" == "$ids2" ]] || fail "unique_id set changed across restart"
  ok "same $(wc -l <<<"$topics2") topics and unique_ids after restart"
  local requests; requests="$(supervisor_requests)"
  note "Supervisor API calls made by the App: $(jq -c '[.[] | .method + " " + .url] | unique' <<<"$requests")"
  [[ "$(jq '[.[] | select(.authorized | not)] | length' <<<"$requests")" == "0" ]] || fail "App called the Supervisor without the expected bearer token"
}

t08_lora_send_is_off_by_default() {
  app_running || { skip "needs the container from t01"; return; }
  local topics; topics="$(discovery_topics sup_dump)"
  if grep -q 'message_lora' <<<"$topics"; then fail "a 'message_lora' text entity is announced although ha_mqtt_lora_send is false"; fi
  # Publishing to the command topic must be refused by the application.
  local result
  result="$( (docker exec "$C_MQ_SUP" mosquitto_sub -h 127.0.0.1 -u "$SUP_USER" -P "$SUP_PASS" -t "$HA_ROOT/envoyer/resultat" -C 1 -W 10 2>/dev/null) &
    sleep 1
    docker exec "$C_MQ_SUP" mosquitto_pub -h 127.0.0.1 -u "$SUP_USER" -P "$SUP_PASS" -t "$HA_ROOT/envoyer" -m "lmm-c integration test, must not be transmitted"
    wait)"
  note "answer on $HA_ROOT/envoyer/resultat: ${result:0:140}"
  [[ -n "$result" ]] || { fail "no answer on $HA_ROOT/envoyer/resultat within 10 s (cannot show the request was refused)"; return; }
  [[ "$(jq -r .ok <<<"$result")" == "false" ]] || fail "transmit request was not refused"
  grep -q 'DOMOTIQUE_ENVOI_LORA' <<<"$result" || note "refusal text does not name DOMOTIQUE_ENVOI_LORA (upstream wording changed?)"
  local env; env="$(docker exec "$C_APP" sh -c 'for p in /proc/[0-9]*; do if grep -q server.js "$p/cmdline" 2>/dev/null; then tr "\0" "\n" < "$p/environ" | grep "^DOMOTIQUE_ENVOI_LORA="; fi; done' 2>/dev/null || true)"
  note "server environment: ${env:-DOMOTIQUE_ENVOI_LORA not set}"
  [[ "$env" != *"=oui"* ]] || fail "server process has DOMOTIQUE_ENVOI_LORA=oui"
}

t09_no_docker_socket_and_no_updater() {
  app_running || { skip "needs the container from t01"; return; }
  if docker exec "$C_APP" sh -c 'test -e /var/run/docker.sock || test -e /run/docker.sock'; then fail "a Docker socket exists in the container"; fi
  if docker top "$C_APP" -eo args | grep -q majeur; then fail "the upstream updater (majeur.js) is running"; fi
  local mounts; mounts="$(docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$C_APP")"
  [[ "$mounts" == "/data " ]] || fail "unexpected mounts: $mounts"
  local env; env="$(docker exec "$C_APP" sh -c 'for p in /proc/[0-9]*; do if grep -q server.js "$p/cmdline" 2>/dev/null; then tr "\0" "\n" < "$p/environ" | cut -d= -f1; fi; done' | sort -u | tr '\n' ' ')"
  note "server environment variable names: $env"
  local v
  for v in MAJ_URL MAJ_JETON MAJ_SERVICE DOCKER_SOCKET SUPERVISOR_TOKEN; do
    grep -qw "$v" <<<"$env" && fail "server process environment contains $v"
  done
  return 0
}

t10_sigterm_stops_within_supervisor_timeout() {
  app_running || { skip "needs the container from t01"; return; }
  local start=$SECONDS
  docker stop -t 60 "$C_APP" >/dev/null
  local took=$((SECONDS - start))
  local code oom; code="$(docker inspect -f '{{.State.ExitCode}}' "$C_APP")"; oom="$(docker inspect -f '{{.State.OOMKilled}}' "$C_APP")"
  note "stopped in ${took}s, exit code $code"
  ((took <= LMM_STOP_TIMEOUT)) || fail "took ${took}s to stop; Supervisor kills after ${LMM_STOP_TIMEOUT}s unless config.yaml 'timeout' is raised"
  [[ "$code" != "137" ]] || fail "container was killed (137) instead of stopping on SIGTERM"
  [[ "$oom" == "false" ]] || fail "container was OOM-killed"
  local tail; tail="$(app_logs | tail -5)"
  grep -qi 'SIGTERM' <<<"$tail" || note "no SIGTERM line in the last log lines"
  [[ "$(sup_dump "$HA_ROOT/disponibilite" 2 | awk '{print $2}')" == "offline" ]] || fail "availability topic not 'offline' after stop (entities would stay available in Home Assistant)"
}

t11_data_persists_across_container_recreation() {
  docker inspect "$C_APP" >/dev/null 2>&1 || { skip "needs the container from t01"; return; }
  start_app
  wait_healthy || { fail "App not healthy on second start"; return; }
  # Create the administrator through the Ingress port with the setup code.
  local body out
  body="$(jq -cn --arg c "$SETUP_CODE" --arg p "Pw-$(random_token)" '{code:$c, compte:{identifiant:"lmmtest", indicatif:"", motDePasse:$p}}')"
  out="$(docker run --rm --network "$LMM_NET" --ip "$LMM_GATEWAY_IP" -e B="$body" -e U="http://app:$LMM_APP_PORT/api/installation" "$NODE_IMAGE" node -e '
    fetch(process.env.U, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: process.env.B })
      .then(async (r) => console.log(r.status + " " + (await r.text()).slice(0, 200))).catch((e) => console.log("000 " + e.message));')"
  note "administrator creation with the setup_code option: ${out:0:80}"
  [[ "$out" == 200\ * ]] || { fail "could not create the administrator with the configured setup code"; return; }
  local before after
  before="$(docker exec "$C_APP" sh -c 'cd /data && sha256sum secret-session.txt code-agents.txt options.json 2>&1; stat -c "%u:%g %a %n" options.json carte-live.db')"
  docker stop -t "$LMM_STOP_TIMEOUT" "$C_APP" >/dev/null
  start_app   # removes the container and creates a new one on the same volume
  wait_healthy || { fail "App not healthy after recreation"; return; }
  after="$(docker exec "$C_APP" sh -c 'cd /data && sha256sum secret-session.txt code-agents.txt options.json 2>&1; stat -c "%u:%g %a %n" options.json carte-live.db')"
  [[ "$before" == "$after" ]] || fail "files under /data changed across recreation: $(diff <(echo "$before") <(echo "$after") | grep '^[<>]' | awk '{print $NF}' | sort -u | tr '\n' ' ')"
  note "ownership: $(grep -E 'options.json|carte-live.db' <<<"$after" | grep -v '  ' | tr '\n' ' ')"
  out="$(http_from "$LMM_GATEWAY_IP" "http://app:$LMM_APP_PORT/api/installation" "X-Forwarded-For: 203.0.113.9")"
  [[ "$(jq -r .requise <<<"${out#200 }" 2>/dev/null)" == "false" ]] || fail "administrator account lost after recreation (installation required again)"
  ok "account, session secret, agent code and options survive recreation"
}

t12_invalid_options_exit_nonzero_without_leaking() {
  rm_containers "$C_APP"
  local canary="bad$(random_token)" out code name
  mkdir -p "$ARTIFACTS"
  run_invalid() { # <name> <options-json or raw text> <expected-fragment>
    name="$1"
    fresh_volume; write_options "$2"
    out="$ARTIFACTS/t12.$name.log"
    timeout 60 docker run --name "$C_APP" --network "$LMM_NET" -v "$V_DATA":/data \
      -e "SUPERVISOR_TOKEN=$SUPERVISOR_TOKEN_VALUE" "$LMM_IMAGE" >"$out" 2>&1 </dev/null
    code=$?
    rm_containers "$C_APP"
    if [[ "$code" -eq 0 ]]; then fail "$name: exit code 0"
    elif [[ "$code" -eq 124 ]]; then fail "$name: container kept running with invalid options"
    else ok "$name: exit code $code"; fi
    [[ -s "$out" ]] || fail "$name: no message printed"
    grep -qi -- "$3" "$out" || fail "$name: message does not mention '$3' (got: $(tail -2 "$out" | cut -c1-160 | tr '\n' ' '))"
    assert_no_secret "$name output" "$out" "$canary" "${ALL_SECRETS[@]}"
    grep -q 'src/server.js\|listening on port' "$out" && fail "$name: upstream was started despite invalid options"
    rm -f "$out"
  }
  run_invalid url_with_credentials "$(options_json ".mesh_mqtt_url = \"mqtt://someone:$canary@mq-manual:1883\"")" mesh_mqtt_url
  run_invalid wrong_scheme "$(options_json ".ha_mqtt_url = \"https://$canary.invalid/\"")" ha_mqtt_url
  run_invalid wrong_type "$(options_json ".ha_mqtt_lora_send = \"$canary\"")" ha_mqtt_lora_send
  run_invalid multiline_secret "$(options_json ".export_token = \"$canary\\nX\"")" export_token
  run_invalid not_json "{ \"mesh_mqtt_password\": \"$canary\", broken" "options"
}

t13_manual_broker_takes_precedence_over_supervisor() {
  start_stack "$(options_json ".ha_mqtt_url = \"mqtt://mq-manual:1883\" | .ha_mqtt_username = \"$MAN_USER\" | .ha_mqtt_password = \"$MAN_PASS\"")" || { fail "stack did not start"; return; }
  wait_healthy || { fail "App not healthy"; return; }
  wait_topic "$C_MQ_MAN" "$MAN_USER" "$MAN_PASS" "$DISCOVERY_PREFIX/#" 30 || { fail "no discovery on the manually configured broker"; return; }
  ok "discovery published on the manual broker ($(discovery_topics man_dump | wc -l) topics)"
  sleep 3
  local leaked; leaked="$(sup_dump '#' 3 | awk '{print $1}' | grep -v '^lmm-c/' | sort -u | tr '\n' ' ')"
  [[ -z "$leaked" ]] || fail "App also published to the Supervisor-provided broker: $leaked"
  local clients; clients="$(docker logs "$C_MQ_SUP" 2>&1 | grep -c 'New client connected.*domotique' || true)"
  [[ "$clients" == "0" ]] || fail "home-automation client connected to the Supervisor broker ($clients connection(s))"
  note "Supervisor API calls: $(supervisor_requests | jq -c '[.[] | .url] | unique')"
  mkdir -p "$ARTIFACTS"; app_logs >"$ARTIFACTS/t13.log"
  assert_no_secret "docker logs (manual broker)" "$ARTIFACTS/t13.log" "${ALL_SECRETS[@]}"
  rm -f "$ARTIFACTS/t13.log"
}

t14_broker_down_at_start_then_reconnects() {
  start_stack "$(options_json .)" || { fail "stack did not start"; return; }
  # Take the home-automation broker away before the App can use it.
  rm_containers "$C_MQ_SUP"
  start_app
  wait_healthy || { fail "App is not healthy while the home-automation broker is down"; return; }
  ok "App healthy with the home-automation broker down"
  sleep 5
  app_running || { fail "App exited while the broker was down"; return; }
  start_broker "$C_MQ_SUP" mq-supervisor "$SUP_USER" "$SUP_PASS" || return 1
  if wait_topic "$C_MQ_SUP" "$SUP_USER" "$SUP_PASS" "$DISCOVERY_PREFIX/#" 60; then
    ok "discovery published after the broker came up"
  else
    fail "no discovery within 60 s after the broker became available"
  fi
  [[ "$(sup_dump "$HA_ROOT/disponibilite" 2 | awk '{print $2}')" == "online" ]] || fail "availability not 'online' after reconnect"
}

t15_starts_without_supervisor_or_mqtt_service() {
  start_broker "$C_MQ_MAN" mq-manual "$MAN_USER" "$MAN_PASS" || return 1
  rm_containers "$C_MQ_SUP"
  # (a) Supervisor reachable but no MQTT service installed.
  start_supervisor none "$SUPERVISOR_TOKEN_VALUE" || return 1
  fresh_volume; write_options "$(options_json .)"
  start_app
  if wait_healthy; then ok "healthy when the Supervisor offers no MQTT service"; else fail "not healthy when the Supervisor offers no MQTT service"; fi
  # (b) Supervisor answering errors.
  start_supervisor error "$SUPERVISOR_TOKEN_VALUE" || return 1
  start_app
  if wait_healthy; then ok "healthy when the Supervisor API returns errors"; else fail "not healthy when the Supervisor API returns errors"; fi
  # (c) No Supervisor at all and no options file (plain docker run).
  rm_containers "$C_SUP"
  fresh_volume
  local saved="$SUPERVISOR_TOKEN_VALUE"; SUPERVISOR_TOKEN_VALUE=""
  start_app
  if wait_healthy; then ok "healthy with no Supervisor and no options file"; else fail "not healthy with no Supervisor and no options file"; fi
  SUPERVISOR_TOKEN_VALUE="$saved"
  if app_logs | grep -Eiq 'setup code [A-Z0-9]{4}-[A-Z0-9]{4}'; then
    note "FINDING (upstream behaviour): with no setup_code option the one-time administrator setup code is printed in the App log"
  fi
}

ALL_TESTS=(
  t01_starts_healthy_on_fresh_volume
  t02_processes_do_not_run_as_root
  t03_listening_ports_are_as_expected
  t04_ingress_port_accepts_only_the_gateway_address
  t05_setup_wizard_is_not_open_to_ingress_users
  t06_secrets_do_not_appear_in_logs
  t07_discovery_topics_on_supervisor_broker_and_stable_across_restart
  t08_lora_send_is_off_by_default
  t09_no_docker_socket_and_no_updater
  t10_sigterm_stops_within_supervisor_timeout
  t11_data_persists_across_container_recreation
  t12_invalid_options_exit_nonzero_without_leaking
  t13_manual_broker_takes_precedence_over_supervisor
  t14_broker_down_at_start_then_reconnects
  t15_starts_without_supervisor_or_mqtt_service
)

main() {
  log "LOCAL CONTAINER TESTS (not Home Assistant acceptance tests)"
  require_image || exit 1
  harness_cleanup
  ensure_network || exit 1
  check_option_names || exit 1
  [[ "${LMM_KEEP:-0}" == "1" ]] || trap harness_cleanup EXIT
  local -a selected=("$@")
  [[ ${#selected[@]} -gt 0 ]] || selected=("${ALL_TESTS[@]}")
  local t
  for t in "${selected[@]}"; do
    if declare -F "$t" >/dev/null; then run_test "$t"; else log "unknown test: $t"; exit 2; fi
  done
  local title="integration summary (local container tests)"
  [[ "$LMM_NONCANONICAL" == "1" ]] && title="$title [NON-CANONICAL NETWORK: default ingress allow-list not exercised]"
  print_summary "$title"
}

main "$@"
