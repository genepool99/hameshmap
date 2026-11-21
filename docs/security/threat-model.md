# Threat model

Owner: Agent C (quality and security). Last updated 2026-11-20.

Scope: the Home Assistant App in `live-mesh-map/`, which packages Live Mesh
Map World 1.5.14 (upstream commit `07bc1a79205a6eae1d136c1261635ca7156c90f3`).
Upstream statements cite `path:line` in that commit, under `carte-live/`
unless the path starts elsewhere. Statements about Home Assistant cite the
sources listed in `docs/testing/ci-notes.md`.

How to read the status column:

- **implemented**: present in the App's files today.
- **tested (local)**: also covered by a local container or simulated-Ingress
  test; the test name is given. This is not a Home Assistant result.
- **planned**: not done; needed before a public release unless accepted.
- **accepted**: a known residual risk the owner should confirm.
- **not verified**: stated from reading code or documentation only.

Nothing in this document has been verified on a real Home Assistant
installation.

## 1. Assets

| Asset | Where | Why it matters |
| --- | --- | --- |
| A1 Mesh broker credentials | App options (`mesh_mqtt_*`), process environment | Access to mesh traffic; often shared community credentials |
| A2 Home Assistant MQTT credentials | Supervisor service answer, or `ha_mqtt_*` options | Publish/subscribe on the home broker: can create entities and trigger automations |
| A3 Supervisor token | container environment (`SUPERVISOR_TOKEN`) | Supervisor API with the App's role |
| A4 Application accounts and session secret | `/data/carte-live.db`, `/data/secret-session.txt` | Administrator can change settings, read messages, drive radios |
| A5 Agent pairing code | `/data/code-agents.txt` | Lets a remote agent attach a radio |
| A6 Setup code | option `setup_code`, or `/data/code-installation.txt` and the log | Creates the first administrator |
| A7 Export token | option `export_token` | Read access to exports without an account |
| A8 Location data and message content | database, MQTT topics, Home Assistant `device_tracker` entities, backups | Precise positions of people's devices; private text messages |
| A9 Radio spectrum / the mesh | LoRa transmit path | Messages sent on air are public, irreversible and duty-cycle limited |
| A10 The Home Assistant host | container boundary | Everything else the user automates |

## 2. Trust boundaries

```text
 Browser ──(B1)── Home Assistant Core ──(B2)── Supervisor ingress ──(B3)── App :8099 ── loopback ── upstream :8095
                                                    172.30.32.2            ingress.mjs
 LAN / internet ──(B4, only if the user maps a port)── upstream :8095 (web)  /  :4404 (agents)
 Other Apps on the 172.30.32.0/23 network ──(B5)── App container
 App ──(B6)── mesh MQTT broker(s)          App ──(B7)── Home Assistant MQTT broker
 App ──(B8)── internet services (tiles are fetched by the browser; terrain, alerts, firmware lists by the server)
 Supervisor ──(B9)── App: options.json, SUPERVISOR_TOKEN, lifecycle, backups
 Build machine ──(B10)── ghcr.io upstream image
```

## 3. Threats and mitigations

### 3.1 Ingress authentication versus the application's own authorization

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| I1 | Ingress users are treated as "local network" visitors. Upstream skips the setup code for private source addresses (`src/server.js:126-130`, `:2298`); behind Ingress every request comes from a private address. | `ingress.mjs` always appends `X-Forwarded-For`; upstream then never treats the request as local (`src/server.js:127`). | implemented; tested (local): integration `t05`, ingress "setup wizard is protected" |
| I2 | The first person to open the UI creates the administrator (first-run wizard, `src/server.js:2290-2327`). | Wizard requires the `setup_code` option (mapped to `ADMIN_MOT_DE_PASSE`, `src/server.js:2295-2297`) or, if unset, a random code upstream prints to the App log (`src/server.js:2263-2276`). Only Home Assistant admins can read options and logs, and `panel_admin: true` limits the panel to admins. | implemented; tested (local) with `setup_code`. Residual: see L2. |
| I3 | Home Assistant login is assumed to equal application login. | It does not: upstream ignores `X-Remote-User-*`; its own accounts and roles apply (`src/server.js:104-106`). Users sign in twice. No auto-login is implemented, deliberately. | implemented; tested (local): ingress "identity headers alone do not log anyone in" |
| I4 | Another container on the App network connects to the ingress port directly, bypassing Home Assistant authentication. | `ingress.mjs` accepts only `172.30.32.2` (Home Assistant guidance, `docs/apps/presentation.md`). | implemented; tested (local): integration `t04`. **Not exercised with the built-in default address on this machine** (non-canonical test network; override `LMM_INGRESS_ALLOW` used). |
| I5 | Another container reaches upstream's own port 8095 on the App network (upstream listens on all interfaces, `src/server.js:4286`) and gets the "local network" wizard. | `bind-guard.cjs` binds 8095 and 4404 to loopback unless the user mapped the port. | implemented; tested (local): integration `t03`, `t04` |
| I6 | Session cookie issued with `Path=/` (`src/server.js:120-121`) is sent to Home Assistant itself and to every other ingress App on the same origin. | `ingress.mjs` rewrites `Path=/` to the ingress path. | implemented; tested (local): ingress session test |
| I7 | Scripts from the same origin (Home Assistant frontend, other ingress Apps) can call this App's ingress URLs with the user's cookies. Path scoping is not an isolation boundary. | Inherent to Ingress: all Apps share the Home Assistant origin. Upstream's `SameSite=Lax`, `HttpOnly` cookie stops cross-site requests only. | accepted |
| I8 | A client forges `X-Forwarded-For` to dodge upstream's login rate limit (`src/server.js:133-139`, `:1922`). | Upstream trusts forwarded headers only from `PROXY_CONFIANCE` (`src/config.js:48`, `src/server.js:149`), set by the App to loopback and the two Supervisor addresses; Core and Supervisor append the real peer. | implemented; not verified on a real installation. If Home Assistant sits behind another reverse proxy, all users share one rate-limit bucket (lockout nuisance): accepted. |
| I9 | Requests leave the ingress prefix and hit Home Assistant's own API with the user's Home Assistant session. | Build-time rewrite of upstream's root-absolute URLs (`build/relativize.mjs`), which fails the build if an unreviewed absolute reference remains. | implemented; tested (simulated Ingress): no escape on map, secondary pages, login, reload. Baseline without the rewrite: 10 escaping URLs on the first page. Pages not opened by the tests are not covered. |
| I10 | Upstream's "demonstration" read mode (`X-Demo: 1`, `src/server.js:164-200`) exposes member and admin read endpoints, with secrets masked, to anonymous visitors. | Upstream feature; under Ingress the visitor is at least a Home Assistant admin. With port 8095 mapped it is reachable by the LAN. | accepted (document in DOCS.md); not verified which data remains visible |

### 3.2 Direct exposure of 8095 and 4404

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| P1 | Ports published to the LAN by default. | `ports: {8095/tcp: null, 4404/tcp: null}`; validator fails on any non-null default. | implemented; tested (static) |
| P2 | User maps 8095 before creating the administrator and without `setup_code`: LAN clients have private addresses and no forwarded header, so upstream asks for **no** code (`src/server.js:2280`, `:2298`). Any LAN device can become administrator, or replace all data through the first-run "restore a full backup" upload, which uses the same rule (`src/server.js:3765-3773`). | None in the App today. Options: refuse to open 8095 while no administrator exists and `setup_code` is empty; or always set a generated `ADMIN_MOT_DE_PASSE`. | **planned** (finding for App engineering); probe: integration `t16` |
| P3 | Port 4404 (agents) reachable from the LAN or internet. An agent that knows the pairing code can attach a radio stream to the map (`src/agents.js:1-5`, `:39-60`). | Closed by default; code compared in constant time; 3 wrong codes per address per 15 minutes (`src/agents.js:54-58`); 2 kB handshake limit, 15 s timeout (`src/agents.js:41-45`). Upstream warns never to forward it from the internet (`docker-compose.yml:17-19`). The protocol is plain TCP: the code and radio traffic are not encrypted. | implemented (closed by default); mapped-port use: accepted with documentation ("LAN or VPN only") |
| P4 | Direct port 8095 is plain HTTP: credentials and session cookie in clear on the LAN. | Use Ingress; documented in `ports_description`. | accepted when the user opts in |

### 3.3 MQTT to LoRa transmission

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| R1 | Anything able to publish on the Home Assistant broker sends text over the radio via `<root>/envoyer` (`src/domotique.js:117-132`). Other Apps, integrations and IoT devices usually share that broker. | Off by default: option `ha_mqtt_lora_send: false` -> `DOMOTIQUE_ENVOI_LORA=non`; upstream refuses the request (`src/domotique.js:127`). The adapter logs a warning when enabled. | implemented; tested (local): integration `t08`; tested (static): validator |
| R2 | When enabled: flooding or abusive content on a shared band. | Upstream limit of one message per 20 s (`src/domotique.js:11`, `:122`), 200-character entity limit (`src/domotique.js:77`). No allow-list of senders, channels or destinations; the payload may choose channel and destination (`src/domotique.js:127`). | accepted only as an explicit opt-in; DOCS.md must state that broker write access equals transmit access. Broker ACL guidance: planned |
| R3 | Upstream subscribes to `<root>/envoyer` even when sending is off (`src/domotique.js:143`). | Requests are answered with a refusal; nothing is transmitted. | tested (local): `t08` |
| R4 | Automatic radio activity not triggered by the user (traceroutes, `src/config.js:115-120`). | Only with a radio configured in the application; none is reachable by default (no USB, no host network, mDNS/UDP discovery disabled by the adapter). | implemented (adapter); not verified with a radio |

### 3.4 Credentials in logs, options and backups

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| L1 | Secrets printed in the App log (readable in the Home Assistant UI, included in diagnostics). | Adapter prints a redacted environment; broker URLs with embedded credentials are rejected without echoing them; upstream strips credentials from the broker URL it logs (`src/domotique.js:144`). | implemented; tested (local): integration `t06`, `t12`, `t13` (all option secrets, Supervisor MQTT password, Supervisor token) |
| L2 | Without `setup_code`, upstream prints the one-time setup code in the log (`src/server.js:2272-2275`). | By upstream design: reading the log is the proof of control. Readable by Home Assistant admins only; deleted after use (`src/server.js:2323`). | accepted; observed in integration `t15`. DOCS.md should say so. |
| L3 | Secrets stored in clear in options (`/data/options.json`, Supervisor's App configuration) and in the server process environment. | `password` schema type masks them in the UI; `options.json` stays root-owned 0600 and the server runs as uid 1000 (integration `t11` shows `0:0 600`). Environment of the server process is readable only by that uid/root. The Supervisor token is not passed to upstream (integration `t09`). | implemented; tested (local) |
| L4 | Backups contain everything: options, database (accounts with scrypt hashes, `src/comptes.js:15-17`), session secret, agent code, positions, messages. | Supervisor backup encryption is the user's choice. `backup: cold` gives a consistent SQLite copy. | accepted; DOCS.md must warn that backups are sensitive. Restore: not tested |
| L5 | Settings saved in the application's own screens (`/data/reglages.json`) may hold broker passwords and override options. | Same protection as the database (uid 1000, `/data`). | accepted; not verified |
| L6 | Home Assistant MQTT user name and broker URLs appear in the redacted startup line. | Not secrets; kept for diagnosis. | accepted |

### 3.5 Location data and message content

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| D1 | Positions of monitored nodes are published retained to the home broker (`src/domotique.js:112`) and become `device_tracker` entities (`src/domotique.js:90`). Every broker client and every Home Assistant user sees them; retained messages outlive the App. | Only "monitored" nodes are published (`src/server.js:4215`). `ha_mqtt_enabled` / `ha_mqtt_discovery` can turn the output off. No option to drop coordinates. | accepted, must be documented; coordinate-free mode: planned (would need upstream support) |
| D2 | Anonymous visitors see node positions. | Upstream rounds public positions (`PRECISION_PUBLIQUE_DECIMALES`, default 3 decimals, about 100 m, `src/config.js:72-73`); exact positions and text messages are for accounts (`src/server.js:101-104`). Under Ingress "anonymous" still means a Home Assistant admin. | implemented upstream; not verified by test |
| D3 | Text messages retained 90 days, other traffic 7 days by default (`src/config.js:65-67`). | Upstream settings; not exposed as App options. | accepted; documentation planned |
| D4 | Test fixtures or logs leak real positions or messages. | Fixtures contain no real hosts, positions or messages; test secrets are random per run; artifacts are git-ignored and scrubbed of the run's tokens. | implemented |

### 3.6 Export token

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| E1 | Exports (GeoJSON, KML, Prometheus, summary) are readable without an account when no token is set (`src/exports.js:4-12`). | Reachable only through Ingress (Home Assistant admin) unless 8095 is mapped. Option `export_token` sets `EXPORT_JETON`. | implemented (option); "set a token when mapping 8095": documentation planned |
| E2 | Token passed as `?jeton=` in URLs (`src/exports.js:11`) ends up in browser history and proxy logs; comparison is not constant-time. | Upstream behaviour; `Authorization: Bearer` is also accepted. | accepted; not verified whether Home Assistant logs ingress query strings |
| E3 | Token leaks into generated KML network links (`src/server.js:4205`). | By design (the link must authenticate). Treat exported files as secrets. | accepted |

### 3.7 Supply chain

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| S1 | Upstream tag is re-pushed with different content. | Dockerfile pins `ghcr.io/sauveteur71/live-mesh-map-world:1.5.14@sha256:4f2d4f01...d237` (multi-arch index); the build fails if the image's `package.json` version differs. Validator fails on floating tags and warns on a missing digest. | implemented; tested (static, and by building) |
| S2 | The pinned image is not what the source says. | Recorded on 2026-11-20: image label `org.opencontainers.image.revision=07bc1a79205a6eae1d136c1261635ca7156c90f3` equals the reviewed commit; the index carries `amd64`, `arm64` and two attestation manifests. The attestations have **not** been verified (no `cosign`/`gh attestation verify` run) and labels are self-declared. | partially done; verification of provenance: **planned, release-blocking** |
| S3 | Vulnerable dependencies in the upstream image (Node 22 base, npm packages, Go tools). | None automated. | planned: image scan (for example Trivy or Grype, pinned) before each release, with a recorded decision per finding |
| S4 | Build-time rewrite of upstream JavaScript introduces a defect or hides a change. | Deterministic, counted replacements; residual scan; `node --check`; simulated-Ingress tests. The rewrite script is shipped in the image for inspection. | implemented; tested (simulated) |
| S5 | CI or tooling compromise publishes a malicious image. | CI has `contents: read`, no secrets, no publish step; actions pinned by commit SHA; tool images pinned by digest. | implemented (workflow not yet run on GitHub) |
| S6 | Published App image unsigned. | No image is published. When it is: Home Assistant builder actions with Cosign. | planned (owner decision) |
| S7 | Licence non-compliance when redistributing a GPL-3.0 image. | `NOTICE.md` in the image; source references in labels. | implemented by App engineering; legal review: owner |

### 3.8 The omitted Docker-socket updater

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| U1 | Upstream's one-click updater runs a root container with `/var/run/docker.sock` (`docker-compose.yml:36-53`, `src/majeur.js:19`, `:105-126`): full control of the host. | Not shipped as a service: the App has one container, no socket, no `docker_api`. The file `src/majeur.js` remains in the image but is never started. Validator fails on `docker.sock`, `majeur` in the Dockerfile, `docker_api`, and updater variables in `environment`. | implemented; tested (static + integration `t09`) |
| U2 | The map still calls the updater service (`MAJ_URL` default `http://maj:4405`, `src/server.js:3609-3617`) and offers an "update" button. | `VERIFIER_MAJ=non` stops the version check (`src/server.js:239`). The host name `maj` does not resolve on the Supervisor network unless another App is named so. | implemented (adapter); the button's behaviour under the App: not verified. If another container answered as `maj` it would only receive a bearer token it already needs to know; residual risk low: accepted |
| U3 | Upstream restarts itself by exiting (settings change, restore). | `run.mjs` restarts the child, with a limit of 10 restarts in 10 minutes. | implemented; not tested |

### 3.9 Container privileges and AppArmor

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| C1 | Excess privileges. | No `privileged`, `full_access`, `host_network`, `docker_api`, devices, USB/UART, host mounts; default API role. | implemented; tested (static) |
| C2 | Process runs as root. | Starts as root only to `chown` `/data`, then `setuid(1000)` before listening. | implemented; tested (local): integration `t02` (all processes uid 1000, no effective capabilities) |
| C3 | No App-specific AppArmor profile: the generic Docker profile applies. | Home Assistant recommends a custom profile (`docs/apps/security.md`). | **planned**; validator WARN `apparmor-profile`. A profile cannot be validated without a real Supervisor host. |
| C4 | Writable root filesystem; upstream writes only under `/data`. | Supervisor does not offer a read-only root option. App files are root-owned, so uid 1000 cannot modify them. | implemented (ownership); not tested |
| C5 | Supervisor token misuse. | Used for two read-only calls that need no extra role; not passed to upstream. | implemented; tested (local): `t07`, `t09` |

### 3.10 Denial of service and disk exhaustion

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| X1 | Database growth from a busy public mesh broker fills the Home Assistant disk. | Upstream retention (7 days traffic, 90 days messages, `src/config.js:65-67`, `src/base.js:192-195`). No size cap. Not exposed as options. | accepted; disk-growth measurement: planned |
| X2 | Terrain, map and firmware caches under `/data` (upstream downloads terrain on first start, observed in logs). | Upstream-managed; size not measured. Excluding caches from backups (`backup_exclude`): planned. | planned |
| X3 | Large uploads fill the disk: full-backup restore accepts up to 8 GB into `/data` (`src/server.js:3765-3785`) for an administrator, or during first-run setup for anyone holding the setup code (sent as `?code=`); settings restore 30 MB, photos 5 MB (`src/server.js:153-155`). | Through Ingress the caller is a Home Assistant admin who also knows the setup code. `ingress_stream: true` avoids buffering in Supervisor. Archive extraction safety (`src/restauration.js`) was not reviewed. | accepted for Ingress; see P2 for a mapped port; extraction: not verified |
| X4 | Log flooding. With no mesh broker configured upstream retries `mqtt://localhost:1883` every 5 s and logs each failure (observed: one line per 5 s). | None. | **planned** (finding for App engineering): either do not start the mesh client without a broker, or document it |
| X5 | Memory exhaustion. Upstream recommends a 512 MB limit (`docker-compose.yml:23`); Supervisor sets none. | None available in `config.yaml`. | accepted |
| X6 | WebSocket abuse. | Upstream limits listener payloads to 4 kB (`src/server.js:2878`) and gateway sockets by account and rate (`src/server.js:2895-2901`). | implemented upstream; not tested |
| X7 | Malformed MQTT payloads crash the decoder. | Upstream's concern; not assessed. | not verified |

### 3.11 Outbound connections

The server contacts third parties on its own initiative. Hosts found in the
source (not all exercised; several are France-specific features): IGN
(`data.geopf.fr`, `geo.api.gouv.fr`), Overpass servers, `api.open-meteo.com`,
`feeds.meteoalarm.org`, `download.db-ip.com`, `build.protomaps.com`,
`copernicus-dem-30m.s3.amazonaws.com`, `api.github.com` (update check,
disabled by the adapter), `api.meshtastic.org`, `raw.githubusercontent.com`,
NASA FIRMS, `photon.komoot.io`, `hubeau.eaufrance.fr`. The browser fetches
map tiles from `server.arcgisonline.com` by default (`src/config.js:101-102`).

| ID | Threat | Mitigation | Status |
| --- | --- | --- | --- |
| O1 | The user's IP address and map area are disclosed to these services; a hostile or compromised service feeds data the server parses. | Update check, mDNS and UDP discovery are disabled by the adapter; French alert features hidden by default. No egress allow-list exists in Supervisor. | accepted; DOCS.md should list the services. Observed locally: terrain download from IGN and DB-IP database download at first start |
| O2 | TLS verification disabled for brokers. | Adapter always sets `MQTT_TLS_NON_VERIFIE=non` (`src/config.js:52`). | implemented (unit-tested by App engineering) |

## 4. Findings to resolve before a public release

1. **P2**: mapping port 8095 without `setup_code` leaves the first-run wizard
   open to the LAN.
2. **S2/S3**: verify upstream image provenance; add an image vulnerability
   scan.
3. **C3**: AppArmor profile, validated on a real host.
4. **X4**: mesh client log noise when no mesh broker is configured.
5. **I4**: run the integration and Ingress tests on the canonical
   `172.30.32.0/23` network so the built-in allow-list is exercised.
6. Documentation items marked "planned" above (R2, L2, L4, D1, D3, E1, O1).
7. Everything in `docs/testing/acceptance-criteria.md` section A.
