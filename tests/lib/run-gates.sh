#!/usr/bin/env bash
# Runs each named make target, keeps going on failure, and prints a summary.
# PASS = exit 0 and no SKIP line; SKIP = exit 0 and a line starting with
# "SKIP"; FAIL = non-zero exit. Exits non-zero if anything failed.
set -uo pipefail

declare -a names=() results=()
failed=0
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

for target in "$@"; do
  echo
  echo "==== ${target} ===="
  if make --no-print-directory "$target" 2>&1 | tee "$tmp"; then
    if grep -q '^SKIP' "$tmp"; then
      # A gate may both run something and skip the rest (validate-manifest).
      if grep -q '^SKIP.*(.*ran)' "$tmp"; then result="PARTIAL (see SKIP line)"; else result="SKIP"; fi
    else
      result="PASS"
    fi
  else
    result="FAIL"
    failed=1
  fi
  names+=("$target")
  results+=("$result")
done

echo
echo "==== summary ===="
for i in "${!names[@]}"; do
  printf '%-20s %s\n' "${names[$i]}" "${results[$i]}"
done
if [[ "$failed" -ne 0 ]]; then
  echo "check: FAILED"
  exit 1
fi
echo "check: no failures (SKIP/PARTIAL gates did not validate anything and are not passes)"
