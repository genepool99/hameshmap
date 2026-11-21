#!/usr/bin/env bash
# Prints repository files of one kind, space separated, relative to the root.
#   find-files.sh dockerfiles | shell
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

prune=(-path ./.git -o -name node_modules -o -path ./tests/manifest/fixtures)

case "${1:-}" in
  dockerfiles)
    find . \( "${prune[@]}" \) -prune -o -type f \
      \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.dockerfile' \) -print
    ;;
  shell)
    {
      find . \( "${prune[@]}" \) -prune -o -type f -name '*.sh' -print
      # Extensionless scripts (entrypoints, s6 run files) identified by shebang.
      find . \( "${prune[@]}" \) -prune -o -type f ! -name '*.*' -size -256k -print |
        while IFS= read -r f; do
          if head -c 64 "$f" 2>/dev/null | head -n 1 | grep -Eq '^#!.*\b(ba|da|a)?sh\b|^#!.*bashio'; then
            echo "$f"
          fi
        done
    } | sort -u
    ;;
  *)
    echo "usage: $0 dockerfiles|shell" >&2
    exit 2
    ;;
esac | sed 's|^\./||' | tr '\n' ' '
