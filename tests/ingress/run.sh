#!/usr/bin/env bash
# Browser tests of the web UI below an Ingress-style path prefix.
#
#   Playwright container
#        |  http://ha:8123/api/hassio_ingress/<token>/...
#   proxy.mjs at 172.30.32.2: strips the prefix, adds X-Ingress-Path
#        |
#   App container, port 8099
#
# Usage:
#   tests/ingress/run.sh                 tests the image local/live-mesh-map:dev
#   LMM_IMAGE=<ref> tests/ingress/run.sh tests another App image
#   LMM_MODE=baseline tests/ingress/run.sh
#       runs against the unmodified upstream image and lists the requests that
#       leave the prefix instead of failing
#
# Needs docker and a free 172.30.32.0/23 range. Output: tests/.artifacts/.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../.artifacts"

NODE_IMAGE=node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579
# Upstream image pinned in the Dockerfile: <image>:<version>@<digest>
dockerfile_arg() { sed -n "s/^ARG $1=//p" "$HERE/../../live-mesh-map/Dockerfile" | head -1; }
UPSTREAM_IMAGE="$(dockerfile_arg UPSTREAM_IMAGE):$(dockerfile_arg UPSTREAM_VERSION)@$(dockerfile_arg UPSTREAM_DIGEST)"

MODE="${LMM_MODE:-strict}"
NET=lmm-test
TOKEN="sim$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
SETUP_CODE="set$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"

cleanup() {
  docker rm -f -v lmm-test-app lmm-test-gateway lmm-test-playwright >/dev/null 2>&1
  docker volume rm -f lmm-test-data >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
}
cleanup
trap cleanup EXIT
docker run --rm -v "$HERE/..":/t --entrypoint rm "$NODE_IMAGE" -rf /t/.artifacts
mkdir -p "$OUT"

docker network create --subnet 172.30.32.0/23 --ip-range 172.30.33.128/25 "$NET" >/dev/null || exit 1
docker volume create lmm-test-data >/dev/null

if [[ "$MODE" == "baseline" ]]; then
  port=8095
  docker run -d --name lmm-test-app --network "$NET" --network-alias app -v lmm-test-data:/data \
    -e VERIFIER_MAJ=non -e LANGUE=en -e "ADMIN_MOT_DE_PASSE=$SETUP_CODE" -e MQTT_URL=mqtt://127.0.0.1:1 \
    "$UPSTREAM_IMAGE" >/dev/null || exit 1
else
  port=8099
  printf '{"log_language":"en","ha_mqtt_enabled":false,"setup_code":"%s"}' "$SETUP_CODE" |
    docker run --rm -i -v lmm-test-data:/data --entrypoint sh "$NODE_IMAGE" -c 'cat > /data/options.json && chmod 600 /data/options.json'
  docker run -d --init --name lmm-test-app --network "$NET" --network-alias app -v lmm-test-data:/data \
    "${LMM_IMAGE:-local/live-mesh-map:dev}" >/dev/null || exit 1
fi

docker run -d --name lmm-test-gateway --network "$NET" --ip 172.30.32.2 --network-alias ha \
  -e TARGET_HOST=app -e TARGET_PORT="$port" -e INGRESS_TOKEN="$TOKEN" \
  -v "$HERE/proxy.mjs":/proxy.mjs:ro "$NODE_IMAGE" node /proxy.mjs >/dev/null || exit 1

healthy=0
for _ in $(seq 1 90); do
  if docker exec lmm-test-gateway node -e "fetch('http://127.0.0.1:8123/api/hassio_ingress/$TOKEN/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then healthy=1; break; fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  echo "FAIL: the App did not answer /sante through the gateway"
  docker logs lmm-test-app 2>&1 | tail -20
  exit 1
fi

docker run --name lmm-test-playwright --network "$NET" --ipc=host --init \
  -v "$HERE":/tests:ro -v "$OUT":/artifacts/playwright \
  -e CI=1 -e GATEWAY_URL=http://ha:8123 -e INGRESS_PREFIX="/api/hassio_ingress/$TOKEN" \
  -e SETUP_CODE="$SETUP_CODE" -e LMM_MODE="$MODE" -e PW_OUTPUT_DIR=/artifacts/playwright \
  "$PLAYWRIGHT_IMAGE" bash -c '
    set -e
    mkdir /work && cp /tests/package.json /tests/package-lock.json /tests/playwright.config.mjs /tests/ingress.spec.mjs /work/
    cd /work
    npm ci --no-audit --no-fund --ignore-scripts >/dev/null
    exec npx --no-install playwright test'
status=$?

docker logs lmm-test-app >"$OUT/app.log" 2>&1
if grep -qF "$SETUP_CODE" "$OUT/app.log"; then
  echo "FAIL: the setup code appears in the App log"
  status=1
fi
exit "$status"
