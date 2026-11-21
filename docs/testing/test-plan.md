# Test plan

Owner: Agent C (quality and security). Last updated 2026-11-20.

This document says what each test layer proves, what it does **not** prove,
and how to run it. The status vocabulary is the one from `AGENTS.md`:
**implemented**, **tested**, **partially tested**, **planned**. A layer that
could not run (missing input) reports `SKIP`, never `PASS`.

## Layers

| # | Layer | Where | Runs in `make check` | Needs |
| --- | --- | --- | --- | --- |
| 1 | Static lint | `Makefile`, root lint configs | yes | docker |
| 2 | Manifest validation | `tests/manifest/` | yes | docker or python3 + PyYAML |
| 3 | Unit tests (config adapter) | `tests/unit/` (owned by App engineering) | yes | node >= 20 |
| 4 | Secret scan | `.gitleaks.toml` | yes | docker |
| 5 | Container integration | `tests/integration/` | no (`make test-integration`) | docker |
| 6 | Simulated Ingress, browser | `tests/ingress/` | no (`make test-ingress`) | docker |
| 7 | Real Home Assistant acceptance | `deployment-and-regression.md` | no, manual, owner-authorized | a Home Assistant OS/Supervised host |

Layers 1 to 6 are synthetic. Only layer 7 is evidence that the App works in
Home Assistant, and none of it has been executed yet (see
`acceptance-criteria.md`).

### 1. Static lint

| Target | Tool (pinned in `tests/images.env`) | Scope |
| --- | --- | --- |
| `lint-yaml` | yamllint 1.38.0 | all YAML; errors fail, long lines warn |
| `lint-docker` | hadolint 2.15.1 | every Dockerfile; warnings fail |
| `lint-shell` | shellcheck 0.11.0 | `*.sh` and extensionless scripts with a shell shebang; warnings fail |
| `lint-actions` | actionlint 1.7.12 | `.github/workflows/` |
| `lint-markdown` | markdownlint-cli2 0.24.2 | all Markdown, lenient rule set |

Proves: files parse and follow tool conventions. Does not prove: that
Supervisor accepts the manifest or that a script does the right thing.

### 2. Manifest validation

`tests/manifest/validate.py` checks `live-mesh-map/config.yaml`,
`translations/en.yaml`, `Dockerfile`, `CHANGELOG.md`, optional `build.yaml`
and `repository.yaml`:

- required keys, version and slug format, architecture list (`amd64` and
  `aarch64` only, both required);
- every option has a schema entry; every mandatory schema key has a default;
  defaults satisfy their schema type; secret-looking options use `password`;
- every schema key (including nested fields) and every port has an English
  name and description;
- security posture: forbidden keys absent or false (`host_network`,
  `full_access`, `docker_api`, `privileged`, `devices`, `usb`, `uart`, ...),
  no broad `map` entries, every `ports` entry `null` by default,
  `ingress: true` on port 8099, `services: [mqtt:want]`;
- LoRa transmit not enabled by an option default, `environment` or the
  Dockerfile;
- Dockerfile derives from the pinned upstream image by version, no floating
  tag, no Docker socket, no updater, no pipe-to-shell;
- version consistency between `config.yaml`, `CHANGELOG.md` and (if present)
  `build.yaml`.

`WARN` findings are decisions or release blockers (missing digest pin,
missing AppArmor profile, hot backup of SQLite, placeholder repository
metadata). `make validate-manifest MANIFEST_FLAGS=--strict` turns them into
failures and is the release gate.

The validator has its own tests (`tests/manifest/test_validate.py`, 72 cases):
a known-good fixture plus one mutation per rule. Fixture manifests are stored
as `config.fixture.yaml` on purpose: Supervisor searches a repository
recursively for `config.yaml` and would offer a fixture as an installable App.

Proves: the manifest matches the documented schema and this project's
security posture, statically. Does not prove: Supervisor's own validation
(the authoritative check is installing on a real host; CI additionally runs
`frenck/action-addon-linter`, which is not run locally).

### 3. Unit tests

`node --test tests/unit/*.test.mjs` (through `make test-unit`, with a timeout) runs the dependency-free tests of the option
adapter (`live-mesh-map/rootfs/opt/lmm/config.mjs`). Written and owned by App
engineering; this plan only runs them.

### 4. Secret scan

`gitleaks dir` scans the working tree as files, so it works before the first
commit. Findings are redacted in output. It complements, and does not replace,
review: test secrets are generated at run time and never stored.

### 5. Container integration tests (local, not Home Assistant)

`tests/integration/run.sh` starts the image with plain `docker run` beside:

- a **fake Supervisor** (`tests/lib/fake-supervisor.mjs`) answering
  `GET /services/mqtt` and `GET /addons/self/info` at `http://supervisor`;
- two real Mosquitto brokers with password authentication (one "offered by
  Supervisor", one "manual");
- a docker network with the Supervisor address plan (`172.30.32.0/23`), so the
  gateway address `172.30.32.2` and "another container" can both be played.
  If that range is taken on the host, a fallback range is used, the App gets
  `LMM_INGRESS_ALLOW`, and the run is labelled **NON-CANONICAL**.

| Test | Proves |
| --- | --- |
| `t01` | fresh volume + sample options -> `GET /sante` 200, mesh broker connected |
| `t02` | no process runs as root after startup; PID 1 has no effective capabilities |
| `t03` | listening sockets are exactly `0.0.0.0:8099`, `127.0.0.1:8095`, `127.0.0.1:4404`; nothing published |
| `t04` | port 8099 answers the gateway address only; 8095 and 4404 are unreachable from another container; forged proxy headers do not help |
| `t05` | the first-run wizard requires a setup code for requests arriving through the Ingress port |
| `t06` | none of the configured secrets (or the Supervisor token) appear in `docker logs`, process command lines, or (option secrets) `docker inspect` |
| `t07` | discovery topics appear under `homeassistant/` on the Supervisor-provided broker; topic set and `unique_id` set identical after a restart; Supervisor calls carry the bearer token |
| `t08` | no `message_lora` entity; a publish to `<root>/envoyer` is refused by the application |
| `t09` | no Docker socket, no updater process, only `/data` mounted, server environment free of updater variables and of `SUPERVISOR_TOKEN` |
| `t10` | SIGTERM -> exit within 10 s, not killed, availability topic `offline` |
| `t11` | administrator account, session secret, agent code and `options.json` survive container recreation |
| `t12` | invalid options -> non-zero exit, message names the option, no secret in output, upstream not started |
| `t13` | a manual broker is used and nothing is published to the Supervisor-provided broker |
| `t14` | App healthy with the broker down; discovery appears after the broker starts |
| `t15` | App starts when Supervisor has no MQTT service, when the Supervisor API fails, and with no Supervisor and no options file |

Does not prove: that Supervisor starts the container the same way (AppArmor,
capability set, network, `/data` ownership, watchdog), that Home Assistant
creates the entities, that the real Mosquitto App's credentials work, upgrade
or backup/restore through Supervisor, behaviour on `aarch64` beyond the CI
smoke test, or anything involving radio hardware.

### 6. Simulated Ingress browser tests (not Home Assistant)

`tests/ingress/run.sh` puts `tests/ingress/proxy.mjs` in front of the App. The
proxy serves it below `/api/hassio_ingress/<token>/`, strips the prefix, adds
`X-Ingress-Path`, `X-Forwarded-*`, `X-Remote-User-*`, removes
`Accept-Encoding` and tunnels WebSocket upgrades, as Home Assistant Core and
Supervisor do (sources and commits are cited in the file header). Playwright
1.65.1 from its official image drives Chromium with a desktop and a mobile
(Pixel 7) profile. External requests (map tiles) are recorded and blocked.

| Test | Proves |
| --- | --- |
| initial map load | page 200, map container rendered, no uncaught exception, no request (page or gateway view) outside the prefix, no external host off the allow-list |
| API calls | API responses below the prefix, none 404 or 5xx |
| WebSocket | `<prefix>/ws` connects and stays open; none outside the prefix |
| reload | reload stays below the prefix and works |
| secondary pages, manifest | `topologie.html`, `publique`, `relief3d.html` load; web manifest URLs and service worker scopes stay below the prefix |
| setup, login, session | wizard refuses a wrong code and accepts the configured one; session cookie is `HttpOnly` with `Path=<prefix>/` and invisible outside; survives reload; logout and login work |
| identity headers | `X-Remote-User-*` headers alone do not authenticate anybody |

Known differences from real Ingress: no Home Assistant login or ingress
session cookie, no frontend iframe (so no third-party-cookie, CSP or
`frame-ancestors` effects), HTTP instead of HTTPS (`Secure` cookies,
`wss://`, mixed content are not exercised), WebSockets tunnelled as raw TCP
rather than re-framed, no response re-compression, Chromium only.

`make test-ingress-baseline` runs the same session against the unmodified
upstream image and **reports** escapes instead of failing; results are
labelled `RAN`, not `PASS`. Baseline recorded on 2026-11-20 with upstream
1.5.14: every script and stylesheet of the map page is requested outside the
prefix (`/app.js`, `/langue.js`, `/style.css`, `/vendor/leaflet/...`, 10
distinct URLs), so the application never starts (0 API calls, no WebSocket);
secondary pages additionally request `/api/config`, `/api/topologie`,
`/publique.js`, `/vendor/maplibre/...` and open `ws://<host>/ws`; the web
manifest points at `/`; the session cookie has `Path=/`.

### 7. Real Home Assistant acceptance

Manual, on the owner's test host, only after explicit authorization. Procedure
and regression steps: `deployment-and-regression.md`. Results table:
`acceptance-criteria.md`.

## How to run

```sh
make check                  # layers 1-4; prints PASS / FAIL / SKIP per gate
make test-integration       # layer 5; builds live-mesh-map/ first
make test-ingress           # layer 6; builds live-mesh-map/ first
make test-ingress-baseline  # layer 6 harness against unmodified upstream
make clean                  # remove lmm-c-* containers, network, volumes, images

LMM_IMAGE=<ref> make test-integration        # test an existing image
tests/integration/run.sh t12_invalid_options_exit_nonzero_without_leaking
LMM_KEEP=1 LMM_GATEWAY_HOST_PORT=18123 tests/ingress/run.sh   # keep it up for manual browsing
```

Artifacts (logs of failed tests, Playwright report, evidence JSON,
screenshots) are written to `tests/.artifacts/` (git-ignored).

## CI

`.github/workflows/ci.yaml` runs `make check`, the Home Assistant App linter,
a no-push image build with a start-up smoke test on `amd64` and `aarch64`
(native runners), and layers 5 and 6 on `amd64`. It has
`permissions: contents: read`, uses no secrets, and contains no step that
commits, pushes, tags, releases or publishes. Third-party actions are pinned
by commit SHA. See `ci-notes.md` for what was verified and why the Home
Assistant builder actions are not used.

## Gaps (planned, not implemented)

- No test of an upgrade from a previous App version (there is none yet).
- No Firefox/WebKit run; no HTTPS run of the simulated gateway.
- No load, soak or disk-growth test.
- No test with real mesh traffic (packets on the mesh broker), so per-node
  entities, device trackers and message handling are untested.
- `frenck/action-addon-linter` runs only in CI.
