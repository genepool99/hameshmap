# Integration contract with upstream

Pinned: `v1.5.14`, commit `07bc1a79205a6eae1d136c1261635ca7156c90f3`, image
index `sha256:4f2d4f0148ef6c5170b9fb86040322fda0f59f0f78ed8b113e193fd4ee77d237`.
Labels are defined in [README.md](README.md).

This is the list of upstream behaviours the App relies on. None of them is a
documented, versioned interface: upstream publishes no compatibility promise
and releases several times a day. Every item therefore has a suggested check
to run whenever the pinned version changes. The checks are proposals for the
quality role; none is implemented by this document.

## 1. Contract

### 1.1 Image

| # | Depended-on behaviour | Evidence | Suggested breakage check |
| --- | --- | --- | --- |
| I1 | Image `ghcr.io/sauveteur71/live-mesh-map-world`, tags without `v`, platforms `linux/amd64` and `linux/arm64` only | EMPIRICAL | Resolve the pinned digest; assert the index lists exactly the expected platforms |
| I2 | Version tags are mutable; the digest is the pin | SOURCE `.github/workflows/image-docker.yml:121-126` | Pin by digest; fail if the tag no longer resolves to the recorded digest (informational) |
| I3 | Label `org.opencontainers.image.revision` equals the upstream commit | EMPIRICAL | Compare the label with the recorded commit |
| I4 | Entrypoint `docker-entrypoint.sh`, command `node src/server.js`, workdir `/app`, Node 22 on Debian bookworm | SOURCE `Dockerfile:23,28,46`; EMPIRICAL | Inspect image config; `node --version` |
| I5 | Image user `node`, uid 1000, gid 1000 | SOURCE `Dockerfile:42`; EMPIRICAL | `docker run --entrypoint id` |
| I6 | Frontend files at `/app/public`, server at `/app/src`, version in `/app/package.json` | SOURCE `Dockerfile:29-35`; EMPIRICAL | Assert the files exist and `package.json` version equals the pin |

### 1.2 Environment

| # | Depended-on behaviour | Evidence | Suggested breakage check |
| --- | --- | --- | --- |
| E1 | Names and defaults of `PORT`, `FICHIER_BASE`, `MQTT_URL`, `MQTT_UTILISATEUR`, `MQTT_MOT_DE_PASSE`, `MQTT_RACINE`, `MESHCORE`, `MESHCORE_IATA`, `DEPARTEMENT`, `RADIO_FREQ_MHZ`, `EXPORT_JETON`, `ADMIN_MOT_DE_PASSE`, `LANGUE`, `PROXY_CONFIANCE`, `VERIFIER_MAJ`, `AGENTS_PORT`, `DOMOTIQUE_*` | [configuration.md](configuration.md) | In the image, `require('/app/src/config.js')` and `lireReglages()` from `/app/src/domotique.js` with a known environment and compare the parsed object with a recorded snapshot |
| E2 | Boolean spelling: lowercase `oui` / `non` is accepted by every boolean site; `DOMOTIQUE_DECOUVERTE` and `DOMOTIQUE_ENVOI_LORA` accept **only** `oui` as true | SOURCE `domotique.js:14`; EMPIRICAL | Same snapshot test, with the matrix `oui`, `non`, `true`, `1`, empty |
| E3 | `DOMOTIQUE_ENVOI_LORA` unset or empty means disabled | SOURCE `domotique.js:22`; EMPIRICAL | Snapshot test; plus publish to `<root>/envoyer` and expect `ok:false` |
| E4 | Empty `DOMOTIQUE_MQTT_URL` disables all home-automation output | SOURCE `domotique.js:32` | Start without it; assert no connection attempt to the test broker |
| E5 | `texte()` rewrites values equal to `yes`, `y`, `true`, `on`, `no`, `n`, `false`, `off`, including credentials | SOURCE `config.js:17,23-30` | App-side validation: reject or warn on such credential values |
| E6 | `/data/reglages.json` → `variables` overrides the environment for catalogue variables | SOURCE `variables.js:115-125`; EMPIRICAL | Write a `variables` entry, start, read `GET /api/reglages/variables` and expect `origine: "carte"` |
| E7 | `VERIFIER_MAJ=non` stops the GitHub release check | SOURCE `server.js:239` | Outbound-connection log (or DNS sink) shows no `api.github.com` lookup in the first minute |

### 1.3 Network and HTTP

| # | Depended-on behaviour | Evidence | Suggested breakage check |
| --- | --- | --- | --- |
| N1 | HTTP and WebSocket on `PORT` (8095), all interfaces | EMPIRICAL | `GET /sante` on the mapped port |
| N2 | `GET /sante` → 200 `{"ok":true,"mqtt":<bool>}` without authentication | SOURCE `server.js:2858`; EMPIRICAL | Assert status, JSON keys and types |
| N3 | Agent listener on 4404 always starts and cannot be disabled; not publishing the port is the only control | SOURCE `agents.js:20,108` | Assert the log line and that the App manifest does not map the port by default |
| N4 | Pages live one level below the root: `/`, `/index.html`, `/publique`, `/publique.html`, `/rejoindre`, `/rejoindre.html`, `/topologie.html`, `/relief3d.html`, `/rapport` | SOURCE `server.js:230-232,1468,3206,4193` | Route list diff against a recorded list; a new page at depth 2 breaks relative URLs |
| N5 | WebSocket paths `/ws`, `/ws/module`, `/ws/meshcore` | SOURCE `server.js:2903-2912` | Upgrade request to `/ws` returns 101 through the prefix proxy |
| N6 | No redirects, no `X-Frame-Options`, no CSP | SOURCE; EMPIRICAL | Assert headers of `GET /` |
| N7 | Cookie `gaulix_session`, `HttpOnly; SameSite=Lax; Path=/`, `Secure` only with trusted `X-Forwarded-Proto: https` | SOURCE `server.js:121`; EMPIRICAL | Log in to a throwaway instance and assert the `Set-Cookie` attributes |
| N8 | `trust proxy` default covers private ranges; `req.ip` then comes from `X-Forwarded-For` | SOURCE `config.js:48`, `server.js:149` | Send `X-Forwarded-For` and assert `GET /api/installation` reports `reseauLocal:false` |
| N9 | First-run rule: with forwarding headers present a setup code is always required; `ADMIN_MOT_DE_PASSE` is that code when set | SOURCE `server.js:123-130,2290-2303`; EMPIRICAL | `GET /api/installation` → `codeRequis:true`; `POST` without code → 403 |
| N10 | Frontend URL shapes that the relative-URL transform matches (root-absolute literals, five WebSocket builders, four `location.origin` builders, one CSS `url()`, one module import, the server's `?v=` regex) | [ingress-audit.md](ingress-audit.md) | After the transform: zero residual root-absolute references; `node --check` on each script; headless page load under a stripped prefix with no request outside it |
| N11 | Exports and `/metrics` are public unless `EXPORT_JETON` is set; then `?jeton=` or `Authorization: Bearer` | SOURCE `exports.js:7-12` | `GET /metrics` with and without the token |

### 1.4 MQTT

| # | Depended-on behaviour | Evidence | Suggested breakage check |
| --- | --- | --- | --- |
| M1 | Input subscriptions `<MQTT_RACINE>/#` (+ `<MESHCORE_RACINE>/#`), QoS 0, protobuf `ServiceEnvelope` on `…/2/e/…` | SOURCE `server.js:3086,3122`, `decodeur.js:311-323`; EMPIRICAL | Publish a synthetic envelope; assert the node appears in `GET /api/noeuds` |
| M2 | Discovery topic `<prefix>/<component>/<uid>/<object>/config`, retained, with `<uid>` derived from `DOMOTIQUE_RACINE` | SOURCE `domotique.js:27,34,53`; EMPIRICAL | Golden-file comparison of the captured map-level discovery payloads (9 topics with LoRa enabled, 8 without) |
| M3 | `unique_id` scheme `<uid>_<object>` and `<uid>_noeud_<node>_<suffix>`; device identifiers `<uid>_carte`, `<uid>_noeud_<node>`; stable across restarts | SOURCE `domotique.js:50,61,83-90`; EMPIRICAL | Restart the instance and assert identical `unique_id` and `identifiers` sets |
| M4 | Availability `<root>/disponibilite` = `online` / `offline`, retained, with last will | SOURCE `domotique.js:35,137,142`; EMPIRICAL | Stop the container; assert a retained `offline` |
| M5 | State topics `<root>/etat`, `<root>/alertes`, `<root>/noeud/<node>` and their JSON keys | SOURCE `domotique.js:96-112`; EMPIRICAL | JSON-key snapshot |
| M6 | Command topic `<root>/envoyer`, gated by `DOMOTIQUE_ENVOI_LORA`, reply on `<root>/envoyer/resultat` | SOURCE `domotique.js:117-132`; EMPIRICAL | With the gate closed, publish and assert `ok:false` and the error text mentions `DOMOTIQUE_ENVOI_LORA` |
| M7 | Upstream never deletes retained discovery configs | SOURCE; EMPIRICAL | Restart with discovery off; assert the configs are still retained (so the App knows it must clean up itself if it wants to) |
| M8 | The `text` entity is advertised only when the LoRa gate is open | SOURCE `domotique.js:74-79` | With the gate closed, assert no `…/text/…/config` topic |

### 1.5 Persistence and lifecycle

| # | Depended-on behaviour | Evidence | Suggested breakage check |
| --- | --- | --- | --- |
| P1 | All state under `dirname(FICHIER_BASE)`; nothing written elsewhere | SOURCE; EMPIRICAL (read-only root filesystem) | Run with `--read-only` and a writable `/data`; assert healthy after 30 s |
| P2 | `/data` must be writable by the process uid; otherwise exit code 1 | EMPIRICAL | Start with an unwritable `/data`; assert a non-zero exit |
| P3 | SQLite in WAL mode; schema created and extended automatically at start | SOURCE `base.js:11-12,62-76` | Start the new version on a data directory created by the previous pin; assert `/sante` and that the node count is preserved |
| P4 | `SIGTERM` → exit code 0 within a second | SOURCE `server.js:4290-4297`; EMPIRICAL | `docker stop -t 10`; assert exit code 0 and duration |
| P5 | Settings changes and restores end the process with exit code 0 and expect an external restart | SOURCE `server.js:2257,3794,4258`; EMPIRICAL | Save a variable through the API; assert the process exits 0 and that the App's supervisor restarts it |
| P6 | Without `maj-jeton.txt` / `MAJ_JETON` the updater is inert | SOURCE `server.js:3610-3616`; EMPIRICAL | `GET /api/maj` as admin → `installe:false` |
| P7 | Files holding secrets: `reglages.json`, `secret-session.txt`, `code-agents.txt`, `code-installation.txt`, `sauvegardes/*`, `cle-equipes.bin` | [persistence-and-lifecycle.md](persistence-and-lifecycle.md) | Review the list of `path.join(<data dir>, …)` call sites for new names |

### 1.6 A cheap first-line check for every bump

Diff these upstream files between the old and new pin; a non-empty diff in
any of them means the matching contract rows must be re-run, not assumed:
`Dockerfile`, `carte-live/src/config.js`, `carte-live/src/variables.js`,
`carte-live/src/domotique.js`, `carte-live/src/agents.js`,
`carte-live/src/comptes.js`, `carte-live/src/base.js`, the session, proxy,
setup and shutdown parts of `carte-live/src/server.js`, and everything in
`carte-live/public` except `i18n-*.json`.

## 2. Risks and unknowns

Severity is the impact on the App if the risk materialises.

| # | Risk or unknown | Severity | Basis | Recommendation |
| --- | --- | --- | --- | --- |
| R1 | **No path-prefix support.** Unmodified upstream is blank under Ingress. | High (blocker for Ingress) | EMPIRICAL | Build-time relative-URL transform with CI gates; see [ingress-audit.md](ingress-audit.md). Offer the change upstream. |
| R2 | **Upstream churn.** 26 releases in 9 days; no stable interface; repository created 2026-11-12. Any contract row can change in any release. | High | GitHub API | Pin by digest; bump deliberately; run the contract checks on every bump; do not auto-track. |
| R3 | **UI settings override App options.** A web-UI admin can set any catalogue variable, including `DOMOTIQUE_ENVOI_LORA=oui`, `DOMOTIQUE_MQTT_URL`, `EXPORT_JETON`, and the input broker. The override persists in `/data/reglages.json`. | High for the "LoRa off by default" rule | SOURCE; EMPIRICAL | Decide and record (ADR) who wins. Options: accept and document; or have the App's start-up reconcile specific keys in `reglages.json`, which touches user data and needs an explicit decision. |
| R4 | **Restart by exit.** Saving settings, finishing the wizard with changes, and restores all exit with code 0. | High | SOURCE; EMPIRICAL | Run the server under a supervisor loop inside the App that restarts on exit code 0 and propagates real stop requests. Supervisor's own handling of a clean exit is UNVERIFIED. |
| R5 | **Data directory ownership.** Upstream runs as uid 1000 and needs a writable `/data`. How Home Assistant mounts and owns `/data` was not checked. | High | EMPIRICAL (crash when unwritable); HA side UNVERIFIED | App start-up must ensure ownership or run the server as a uid that can write. Verify on a real Supervisor. |
| R6 | **Boolean parsing is inconsistent.** `true` / `1` silently mean *false* for `DOMOTIQUE_DECOUVERTE` and `DOMOTIQUE_ENVOI_LORA`, and `false` / `0` do not disable several `!== 'non'` switches. | Medium (safe direction for LoRa, wrong direction for discovery) | EMPIRICAL | The App must translate its own booleans to literal `oui` / `non`. Test the translation. |
| R7 | **First-run takeover window.** Before the first admin exists, a LAN host reaching port 8095 directly (no forwarding headers) can create the admin (if `ADMIN_MOT_DE_PASSE` is unset) or restore a full backup (even if it is set). | Medium to high if the port is published | SOURCE `server.js:2290-2303,3765-3773`; partly EMPIRICAL | Always set `ADMIN_MOT_DE_PASSE` (generated, shown to the owner); do not publish 8095 by default; ensure the Ingress proxy always sends `X-Forwarded-For`. |
| R8 | **Two logins.** Home Assistant authentication does not log the user in to the app; there is no SSO or trusted-header mode. Anyone who can open the panel sees the public view and can self-register (default `INSCRIPTIONS=validation`). | Medium (usability and expectations) | SOURCE | Document it. Consider defaulting `INSCRIPTIONS=fermees`. |
| R9 | **Shared client address.** Lockouts and rate limits key on `req.ip`. If the proxy in front does not pass a per-user `X-Forwarded-For`, three bad passwords lock out every user. | Medium | SOURCE `blocages.js`, `server.js:132-143` | Verify which address Ingress forwards; test lockout behaviour end to end. |
| R10 | **Agent port.** Cannot be disabled or bound to loopback; protocol is unencrypted with a shared code. | Medium | SOURCE | Do not map 4404 by default; if offered as an option, document LAN-only use. |
| R11 | **Outbound calls by default**: GitHub version check, terrain downloads, Overpass, NASA FIRMS, MeteoAlarm (French feed), DB-IP, mDNS. Browser loads third-party tiles (Esri by default). | Medium (privacy, offline installs) | EMPIRICAL | Set `VERIFIER_MAJ=non`; consider `STATS_PAYS=non`, `MDNS_MESHTASTIC=non`; document the rest. Some cannot be disabled. |
| R12 | **Discovery leftovers.** Retained configs are never removed; identifiers have no per-install part; device name is always "Carte live"; entity names are French. Two instances with the same root collide. | Medium | SOURCE; EMPIRICAL | Choose and freeze `DOMOTIQUE_RACINE` in the App; never change it afterwards; decide whether the App cleans up retained topics on disable or uninstall. |
| R13 | **`object_id` in discovery payloads** and a hyphen in the discovery node id. Acceptance by the Home Assistant version in use was not checked. | Low to medium | UNVERIFIED | Test discovery against a real Home Assistant; watch its log for deprecation warnings. |
| R14 | **Home-automation client ignores `MQTT_TLS_NON_VERIFIE`** and offers no CA option. | Low (the internal broker is normally plain `mqtt://`) | SOURCE `domotique.js:134-138` | Use the unencrypted internal listener, or a certificate the Node trust store accepts. |
| R15 | **MeshCore republish** publishes radio data to the input broker when a companion radio is attached (`MESHCORE_REPUBLIER` defaults to on). | Low to medium | SOURCE `meshcore/mqtt.js:40-51` | Consider `MESHCORE_REPUBLIER=non` by default; document. |
| R16 | **Credential rewriting** by `texte()` for eight alias words. | Low | SOURCE; EMPIRICAL (alias table) | Validate in the App. |
| R17 | **French defaults** (area, frequency, MQTT root, IATA, time zone, alert features). | Low | SOURCE; EMPIRICAL | The App must always pass `DEPARTEMENT`, `RADIO_FREQ_MHZ`, `MQTT_RACINE`, `MESHCORE_IATA`, `TZ`, `FONCTIONS_MASQUEES`. |
| R18 | **Log noise.** One line every 5 s while the input broker is unreachable; no log-level control; node names appear in logs. | Low | EMPIRICAL | Document; make sure the broker address is valid before starting. |
| R19 | **Corrupt database** stops the app at start with no recovery. | Low probability, high impact | EMPIRICAL | Document recovery from `/data/sauvegardes` and Home Assistant backups; take backups with the app stopped or include `-wal` and `-shm`. |
| R20 | **Images are unsigned**; only unsigned BuildKit provenance is attached. | Low to medium (supply chain) | EMPIRICAL | Pin by digest; record the digest and the commit label; scan the image in CI. |
| R21 | **No 32-bit ARM image.** | Low | EMPIRICAL | Declare only `amd64` and `aarch64`. |
| R22 | **Update UI cannot be hidden**; with the version check on, admins are told to update through a mechanism the App does not provide. | Low | SOURCE | `VERIFIER_MAJ=non`; explain in the App documentation how updates arrive. |
| R23 | **Browser radio links, PWA install and share links do not work through Ingress.** | Low (optional features) | SOURCE; iframe policy UNVERIFIED | Document; offer direct access as an opt-in. |
| R24 | **Demo read mode** (`X-Demo: 1`) exposes a masked subset of member and admin screens to anonymous visitors and cannot be turned off. | Low to medium | SOURCE `server.js:165-200`; not exercised | Review the masked output on a throwaway instance before recommending direct exposure. |
| R25 | **Licence hygiene.** Upstream's image omits its own `LICENSE`; `donnees-ref` has no stated source. | Low | EMPIRICAL; SOURCE | See [licensing.md](licensing.md). |
| R26 | **arm64 and real Supervisor untested** in this analysis. | Unknown | — | Run the contract checks on arm64 and on a real Home Assistant before calling anything tested. |

## 3. Upstream contribution opportunities

State of the tracker on 2026-11-20 (GitHub API): one open and eight closed
pull requests, **all from Dependabot**; no human-filed issue or pull request;
nothing about path prefixes, reverse-proxy sub-paths or a Home Assistant
add-on. The sibling repository `sauveteur71/carte-live-meshtastic` (French
edition) is where the relief package is released from, which suggests it is
the primary code line (SOURCE `carte-live/src/server.js:410`); which
repository the author prefers for contributions is UNVERIFIED.

Conventions observed (SOURCE): no `CONTRIBUTING` file, no issue or pull
request template, no CLA; identifiers, comments and commit subjects are in
French; UI strings are French in source with English supplied through
`carte-live/public/i18n-en.json` and a server-side translation table
(`carte-live/src/traduction.js`); CI runs syntax checks, a decoding test and
a browser test (`.github/workflows/verifications.yml`); Dependabot proposals
are merged by hand (`.github/dependabot.yml:1-2`).

Candidate contributions, most valuable first:

| # | Proposal | Why upstream might accept |
| --- | --- | --- |
| C1 | Relative URLs in the frontend (the change in [ingress-audit.md](ingress-audit.md) section 6b) | Behaviour at `/` is unchanged; enables any sub-path reverse proxy, not just Home Assistant |
| C2 | One shared boolean parser for every `oui` / `non` variable, used by `domotique.js` and the raw `process.env` sites | The world edition already documents `yes` / `no`; today they silently do not work for several variables |
| C3 | `AGENTS_PORT=0` (or `AGENTS=non`) to disable the agent listener, and an optional bind address | Matches upstream's own security advice about port 4404 |
| C4 | Remove retained discovery configs when discovery is disabled or a node is no longer watched; pass the real map title as device name | Small, fixes a visible bug (`config.titre`) |
| C5 | An option to make environment values win over UI values, or to lock selected variables | Needed by any managed deployment |
| C6 | Include `LICENSE` in the image | One line in the `Dockerfile` |
| C7 | An option to hide the one-click update UI | Useful to every packaged distribution |
| C8 | Apply `MQTT_TLS_NON_VERIFIE` (or a CA option) to the home-automation client | Consistency |

None of these has been proposed. Contact with upstream is the owner's
decision.
