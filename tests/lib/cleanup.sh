#!/usr/bin/env bash
# Removes everything the local tests may have left behind.
#   cleanup.sh        containers, network, data volume
#   cleanup.sh all    also the locally built images and the Playwright cache volume
set -uo pipefail
# shellcheck source=harness.sh
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"

harness_cleanup
# Anything else that carries the reserved prefix.
leftover="$(docker ps -aq --filter 'name=^lmm-c-')"
if [[ -n "$leftover" ]]; then
  # shellcheck disable=SC2086
  docker rm -f -v $leftover >/dev/null 2>&1 || true
fi
if [[ "${1:-}" == "all" ]]; then
  docker volume rm -f lmm-c-playwright-deps >/dev/null 2>&1 || true
  images="$(docker images --format '{{.Repository}}:{{.Tag}}' 'local/lmm-c-*')"
  if [[ -n "$images" ]]; then
    # shellcheck disable=SC2086
    docker rmi -f $images >/dev/null 2>&1 || true
  fi
  rm -rf "$ARTIFACTS"
fi
echo "cleanup done"
