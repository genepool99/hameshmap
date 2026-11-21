# Local quality gates for the Live Mesh Map World Home Assistant App.
#
#   make check             default gate: lint, manifest validation, unit tests, secret scan
#   make test-integration  local container tests (builds the image; not part of `check`)
#   make test-ingress      simulated-Ingress browser tests (builds the image; not part of `check`)
#
# Every tool runs from a container image pinned by tag and digest in
# tests/images.env; nothing is installed on the host. Requirements: docker,
# node (>= 20, for test-unit), bash.
#
# Nothing here commits, pushes, tags or publishes. Keep it that way (AGENTS.md).

SHELL := /usr/bin/env bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help

include tests/images.env

APP_DIR      ?= live-mesh-map
LOCAL_IMAGE  ?= local/lmm-c-app:dev
PLATFORM     ?= linux/amd64
DOCKER_RUN   := docker run --rm --network none -v "$(CURDIR)":/work:ro -w /work

CHECK_TARGETS := lint-yaml lint-docker lint-shell lint-actions lint-markdown \
                 validate-manifest test-unit scan-secrets

.PHONY: help check $(CHECK_TARGETS) build test-integration test-ingress \
        test-ingress-baseline clean pull-tools

help:
	@echo "Targets:"
	@echo "  check                  run: $(CHECK_TARGETS)"
	@echo "  build                  docker build $(APP_DIR) -> $(LOCAL_IMAGE) (never pushed)"
	@echo "  test-integration       local container tests against LMM_IMAGE (default: build)"
	@echo "  test-ingress           simulated-Ingress browser tests against LMM_IMAGE (default: build)"
	@echo "  test-ingress-baseline  same harness against the unmodified upstream image"
	@echo "  clean                  remove test containers, networks, volumes and local images"

# Runs every gate even if an earlier one fails, then prints one summary line
# per gate. A gate that prints a line starting with "SKIP" and exits 0 is
# reported as SKIP, never as PASS.
check:
	@tests/lib/run-gates.sh $(CHECK_TARGETS)

lint-yaml:
	$(DOCKER_RUN) $(YAMLLINT_IMAGE) yamllint --strict .

lint-docker:
	@files="$$(tests/lib/find-files.sh dockerfiles)"; \
	if [[ -z "$$files" ]]; then echo "SKIP lint-docker: no Dockerfile in the repository yet"; exit 0; fi; \
	echo "hadolint: $$files"; \
	$(DOCKER_RUN) --entrypoint hadolint $(HADOLINT_IMAGE) --config .hadolint.yaml $$files

lint-shell:
	@files="$$(tests/lib/find-files.sh shell)"; \
	if [[ -z "$$files" ]]; then echo "SKIP lint-shell: no shell scripts in the repository"; exit 0; fi; \
	echo "shellcheck: $$files"; \
	$(DOCKER_RUN) $(SHELLCHECK_IMAGE) --external-sources $$files

lint-actions:
	@if ! compgen -G ".github/workflows/*.y*ml" >/dev/null; then echo "SKIP lint-actions: no workflows"; exit 0; fi; \
	$(DOCKER_RUN) $(ACTIONLINT_IMAGE) -color

lint-markdown:
	$(DOCKER_RUN) $(MARKDOWNLINT_IMAGE) "**/*.md"

# The validator's own tests always run. Validation of the real manifests is
# skipped (explicitly) only while Agent B's files do not exist.
validate-manifest:
	tests/manifest/run.sh python3 -m unittest discover -s tests/manifest -p 'test_*.py'
	@if [[ ! -f "$(APP_DIR)/config.yaml" ]]; then echo "SKIP validate-manifest: $(APP_DIR)/config.yaml does not exist yet (validator self-tests ran)"; exit 0; fi; \
	tests/manifest/run.sh python3 tests/manifest/validate.py --repo . --app "$(APP_DIR)" $(MANIFEST_FLAGS)

test-unit:
	@if ! compgen -G "tests/unit/*.mjs" >/dev/null && ! compgen -G "tests/unit/*.js" >/dev/null; then \
	  echo "SKIP test-unit: no test files in tests/unit/ yet"; exit 0; fi; \
	node --test tests/unit/

# Directory mode: scans the working tree as files, so it works with an empty
# git history. --redact keeps any finding out of terminal and CI logs.
scan-secrets:
	$(DOCKER_RUN) $(GITLEAKS_IMAGE) dir --no-banner --redact --config .gitleaks.toml .

build:
	@if [[ ! -f "$(APP_DIR)/Dockerfile" ]]; then echo "FAIL build: $(APP_DIR)/Dockerfile does not exist"; exit 1; fi
	docker build --platform "$(PLATFORM)" -t "$(LOCAL_IMAGE)" "$(APP_DIR)"

# LMM_IMAGE=<ref> tests an existing image instead of building one.
test-integration:
	@if [[ -z "$${LMM_IMAGE:-}" ]]; then $(MAKE) --no-print-directory build; fi
	LMM_IMAGE="$${LMM_IMAGE:-$(LOCAL_IMAGE)}" tests/integration/run.sh $(TESTS)

test-ingress:
	@if [[ -z "$${LMM_IMAGE:-}" ]]; then $(MAKE) --no-print-directory build; fi
	LMM_IMAGE="$${LMM_IMAGE:-$(LOCAL_IMAGE)}" tests/ingress/run.sh

# Evidence run: the unmodified upstream image has no Ingress support, so this
# is EXPECTED to report prefix escapes. It proves the harness detects them.
test-ingress-baseline:
	LMM_IMAGE="$(UPSTREAM_IMAGE)" LMM_APP_PORT=8095 LMM_MODE=baseline tests/ingress/run.sh

pull-tools:
	@for i in $(YAMLLINT_IMAGE) $(HADOLINT_IMAGE) $(SHELLCHECK_IMAGE) $(ACTIONLINT_IMAGE) \
	  $(MARKDOWNLINT_IMAGE) $(GITLEAKS_IMAGE); do docker pull -q "$$i"; done

clean:
	@tests/lib/cleanup.sh all
