#!/usr/bin/env bash
# Runs a python3 command with PyYAML available: on the host when it has
# PyYAML, otherwise inside the pinned yamllint image (which ships Python and
# PyYAML). Usage: tests/manifest/run.sh python3 <args...>
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../images.env
source "$root/tests/images.env"

if [[ "${LMM_MANIFEST_RUNNER:-auto}" != "container" ]] &&
  python3 -c 'import yaml' 2>/dev/null; then
  cd "$root"
  exec "$@"
fi
if [[ "${LMM_MANIFEST_RUNNER:-auto}" == "host" ]]; then
  echo "FAIL: host python3 has no PyYAML and LMM_MANIFEST_RUNNER=host" >&2
  exit 1
fi
shift # drop the leading "python3"; the image's python is the entrypoint
exec docker run --rm --network none -v "$root":/work:ro -w /work \
  -e PYTHONDONTWRITEBYTECODE=1 --entrypoint python3 "$YAMLLINT_IMAGE" "$@"
