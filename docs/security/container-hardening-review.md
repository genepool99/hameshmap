# Container hardening review

Checklist to re-run **before every release** and after any change to
`live-mesh-map/config.yaml`, the Dockerfile, the startup code or the pinned
upstream version. Fill in a dated copy of the result table (do not overwrite
earlier results). "Automated" items are checked by the named gate; the
reviewer confirms the gate ran and passed. "Manual" items need a person and,
where stated, a real Home Assistant host.

Status of the last review: **2026-11-20, development snapshot, incomplete**
(see the right-hand column). Results come from a local linux/amd64 Docker
host on a non-canonical test network; nothing was checked on Home Assistant.

## A. Manifest (`config.yaml`)

| # | Item | How | 2026-11-20 |
| --- | --- | --- | --- |
| A1 | No `host_network`, `host_pid`, `host_ipc`, `host_dbus`, `host_uts` | automated: `make validate-manifest` | pass |
| A2 | No `privileged` capabilities, no `full_access` | automated | pass |
| A3 | No `docker_api`; `hassio_role` default; `hassio_api`, `homeassistant_api`, `auth_api` absent | automated | pass |
| A4 | No `devices`, `usb`, `uart`, `gpio`, `udev`, `video`, `audio`, `kernel_modules`, `devicetree` | automated | pass |
| A5 | `map` empty or `data`/`app_config` only | automated | pass (none) |
| A6 | Every `ports` entry is `null`; ingress port not listed | automated | pass |
| A7 | `ingress: true`, `ingress_port: 8099`, `panel_admin` not false | automated | pass |
| A8 | `apparmor` not disabled; custom `apparmor.txt` present | automated (WARN when missing) | **open**: no profile |
| A9 | Secrets use `password` type and have no default | automated | pass |
| A10 | LoRa transmit option defaults to false | automated | pass |
| A11 | `backup: cold` or a tested `backup_pre` hook | automated (WARN) | pass (`cold`) |
| A12 | `stage` honest (`experimental` until section A of the acceptance criteria passes) | automated (WARN) | pass |
| A13 | `timeout` not shorter than the startup code's stop grace period | manual: compare `timeout` with `LMM_STOP_GRACE_MS` default in `run.mjs` | pass (30 s vs 20 s) |
| A14 | Security rating shown by Home Assistant is as expected | manual, real host | not checked |

## B. Image

| # | Item | How | 2026-11-20 |
| --- | --- | --- | --- |
| B1 | Upstream pinned by version **and** digest; no floating tag | automated: validator; `make validate-manifest MANIFEST_FLAGS=--strict` | pass |
| B2 | Digest equals what the registry serves for that tag today | manual: `docker buildx imagetools inspect <image>:<tag>` | pass (`sha256:4f2d4f01…d237`) |
| B3 | Upstream revision label equals the reviewed commit | manual: `docker image inspect` label `org.opencontainers.image.revision` | pass (`07bc1a79…`), self-declared label |
| B4 | Upstream provenance attestation verified | manual: `gh attestation verify` or `cosign verify-attestation` | **open**: not done |
| B5 | Vulnerability scan of the final image reviewed | manual: pinned scanner | **open**: not done |
| B6 | hadolint clean | automated: `make lint-docker` | see latest `make check` |
| B7 | No Docker socket, no updater entrypoint, no pipe-to-shell, no remote `ADD` | automated: validator | pass |
| B8 | Application files are root-owned and not writable by uid 1000 | manual: `docker run --rm --network none --user 1000:1000 --entrypoint sh <image> -c 'find /opt/lmm /app -path /app/node_modules -prune -o -writable -print'` prints nothing | pass (local image `local/lmm-c-app:dev`) |
| B9 | No secret baked into the image or its history | manual: `docker history --no-trunc`; automated: `make scan-secrets` on the tree | scan pass; `docker history` of the local image shows no secret-like build argument |
| B10 | Labels `io.hass.version`, `io.hass.type`, `io.hass.arch` set | automated (WARN) | pass |
| B11 | Builds for `linux/amd64` and `linux/arm64` | CI `build` job; locally `make build PLATFORM=linux/arm64` | amd64 built locally; arm64 not built |

## C. Runtime (local container tests)

| # | Item | How | 2026-11-20 |
| --- | --- | --- | --- |
| C1 | No process runs as root after startup; no effective capabilities | `t02` | pass |
| C2 | Listening sockets: `0.0.0.0:8099`, `127.0.0.1:8095`, `127.0.0.1:4404` only | `t03` | pass |
| C3 | Ingress port refuses every source except the gateway address | `t04` | pass with `LMM_INGRESS_ALLOW` override; **default address not exercised** |
| C4 | Upstream ports unreachable from other containers by default | `t04` | pass |
| C5 | Setup wizard requires a code through Ingress | `t05`, ingress tests | pass |
| C6 | No secret in logs, command lines, or (options) container metadata | `t06`, `t12`, `t13` | pass |
| C7 | LoRa transmit refused by default | `t08` | pass |
| C8 | No Docker socket, no updater, only `/data` mounted, Supervisor token not passed to upstream | `t09` | pass |
| C9 | Stops on SIGTERM within the Supervisor timeout | `t10` | pass |
| C10 | `/data` content and ownership preserved across recreation; `options.json` untouched | `t11` | pass |
| C11 | Invalid options stop the container with a secret-free message | `t12` | pass |
| C12 | Session cookie scoped to the ingress path | ingress tests | pass (simulated) |
| C13 | No request outside the ingress prefix | ingress tests | pass (simulated, pages listed in the test plan) |

## D. Real host (owner-authorized only)

| # | Item | How | 2026-11-20 |
| --- | --- | --- | --- |
| D1 | AppArmor profile loads and the App works in enforce mode | Supervisor log, `aa-status` on the host | not checked |
| D2 | Effective capability set and seccomp as started by Supervisor | `docker inspect` on the host (read-only) | not checked |
| D3 | Ports 8095, 4404, 8099 closed from the LAN with default options | `nc -zv` from another machine | not checked |
| D4 | Ingress source address is really `172.30.32.2` on this Supervisor version | App log line "ingress listening… allowed source", no refusals logged | not checked |
| D5 | Watchdog URL works and does not trip the source-address filter | Supervisor log over 10 minutes | not checked |
| D6 | Backup contains what is expected and restores | acceptance check 10 | not checked |

## E. Decisions to record with the owner

- Mapping port 8095 or 4404: wording of the warning in DOCS.md; behaviour when
  8095 is mapped without `setup_code` (threat P2).
- Enabling LoRa transmission (threat R1, R2).
- Publishing positions to the home broker (threat D1).
- Outbound connections made by upstream (threat O1).
