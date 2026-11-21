# Upstream network interfaces, HTTP surface and authentication

Pinned: `v1.5.14`, commit `07bc1a7`. Labels are defined in
[README.md](README.md). Unless a directory is given, file names are under
`carte-live/src/`.

## 1. Listening sockets

| Socket | Default | Bind | Purpose | Can be disabled | Evidence |
| --- | --- | --- | --- | --- | --- |
| TCP `PORT` | 8095 | all interfaces (`::`, dual stack) | HTTP and WebSocket | no | SOURCE `server.js:2875,4286`; EMPIRICAL (`/proc/net/tcp6` shows `:::` listener) |
| TCP `AGENTS_PORT` | 4404 | all interfaces | Agent protocol | **no** | SOURCE `agents.js:20,38,108`; EMPIRICAL |
| UDP 4403 multicast | off | all interfaces | Meshtastic LAN UDP listener, only if `UDP_MESHTASTIC=oui` | yes (default off) | SOURCE `udp-meshtastic.js:12-13,41`, `server.js:3249` |
| UDP ephemeral | on | each non-internal IPv4 address | mDNS **query** sender (not a service) every 15 min, unless `MDNS_MESHTASTIC=non` | yes | SOURCE `mdns.js:109-117`, `server.js:1178-1181`; EMPIRICAL (`udp.send` to `224.0.0.251:5353`) |
| TCP 4405 | not in the main process | all interfaces | Updater HTTP API; exists only in the separate `majeur.js` process | n/a | SOURCE `majeur.js:20,146-158` |

### The agent listener (port 4404)

- It is created unconditionally at start. There is no option to disable it
  and no bind-address option; `listen(port)` binds every interface
  (SOURCE `agents.js:107-108`, `server.js:3324`).
- `AGENTS_PORT` only changes the port number. `AGENTS_PORT=0` would make Node
  pick a random port; this is not a supported way to disable it (SOURCE
  `agents.js:20`; UNVERIFIED at runtime).
- The practical control for the App is to **not publish the port** from the
  container. The listener then stays reachable only inside the container
  network namespace. A listen failure is logged and non-fatal (SOURCE
  `agents.js:107`).
- Protocol: plain TCP, **no TLS**. The client sends one JSON line (at most
  2048 bytes, 15 s timeout) containing `code`, `nom`, and optional fields. The
  server answers `OK`, `OK direct` or `ERREUR ...`, then exchanges line
  commands (`PING`, `OUVRIR`, `RELAIS <ip:port>`, `TCP <port>`,
  `SONDER <ip>`) and relays a raw radio byte stream (SOURCE
  `agents.js:38-105,122-150,174-194`).
- Authentication: a shared code of 12 characters from a 32-symbol alphabet,
  generated at first start, stored in `/data/code-agents.txt` (mode 0600),
  compared in constant time. Three wrong codes from one address within 15 min
  block that address for 15 min, in memory only (SOURCE
  `agents.js:14-15,21-24,54-64`). The code is shown to administrators and
  embedded in downloadable pre-configured agents (SOURCE `server.js:934-936,
  945-958`).
- An authenticated agent with `relais` set can be asked by the server to open
  TCP connections on its own LAN. Upstream documents that the port must never
  be exposed to the internet (SOURCE `README.md:50`,
  `docker-compose.yml:17-19`, `wiki/en/Agent.md:50`).

## 2. Outbound connections

### 2.1 Made automatically with default configuration

EMPIRICAL: observed in about 15 minutes of running the pinned image with no
environment, by logging DNS lookups and socket connects from inside the
process. SOURCE references show where each call is made.

| Destination | Purpose | Suppressed by | Evidence |
| --- | --- | --- | --- |
| `MQTT_URL` (default `localhost:1883`) | Input broker; retried every 5 s, one log line per failure | cannot be disabled | SOURCE `server.js:3078-3085`; EMPIRICAL |
| `api.github.com` | Latest-release check 15 s after start, then hourly. Sends `User-Agent: carte-live/<version>`. | `VERIFIER_MAJ=non` | SOURCE `server.js:238-251`; EMPIRICAL |
| `data.geopf.fr` | French IGN elevation, when the area is a French department (the default) | set a world `DEPARTEMENT` | SOURCE `relief.js:201`; EMPIRICAL |
| Copernicus DEM bucket on AWS (`COPERNICUS_URL`) | Terrain for world areas | none found | SOURCE `monde.js:40,55`; EMPIRICAL (attempted and failed on an isolated network, non-fatal) |
| `overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee` | OpenStreetMap summits and places for the map area | none found | SOURCE `relief.js:287`, `monde.js:100`; EMPIRICAL |
| `geo.api.gouv.fr` | French commune names | French areas only | SOURCE `relief.js:320`; EMPIRICAL |
| `firms.modaps.eosdis.nasa.gov` | Active-fire data | hide feature `feux` (UNVERIFIED that hiding stops the fetch) | SOURCE `feux.js:117`; EMPIRICAL |
| `feeds.meteoalarm.org` | Weather warnings (French feed by default) | none found | SOURCE `alertes-officielles.js:10,101`; EMPIRICAL |
| `download.db-ip.com` | Monthly country database (about 8 MB) for visitor statistics | `STATS_PAYS=non` | SOURCE `frequentation.js:53,69`; EMPIRICAL |
| `224.0.0.251:5353` (UDP) | mDNS query for Meshtastic nodes | `MDNS_MESHTASTIC=non` | SOURCE `server.js:1178-1181`; EMPIRICAL |

There is no dedicated telemetry or analytics endpoint in the code (SOURCE:
every `fetch`, `net.connect` and `mqtt.connect` call under `carte-live/src`
was listed). The GitHub check does disclose the instance's IP address and
version to GitHub.

### 2.2 Made on demand or when configured (SOURCE only)

Home-automation broker (`domotique.js:134`), extra input brokers
(`server.js:3140-3149`), MeshCore republish to the input broker
(`meshcore/mqtt.js:40-51`), Meshtastic node over TCP (`radio.js:122`),
MeshCore companion over TCP (`meshcore/companion.js:350`), PostgreSQL, SMTP,
APRS-IS, LoRaWAN broker, Hub'Eau, MeshMonitor, LSA SAF, federation partners
(`federation.js:34`), geocoding at `photon.komoot.io` and `data.geopf.fr`
(`server.js:892-893`), `api.open-meteo.com` elevation (`analyse.js:232`),
firmware lists and binaries from `api.github.com` and GitHub
(`maintenance.js:105`, `meshcore/maintenance.js:60`, `ota.js:25,41`),
Protomaps offline base map through the `pmtiles` binary (`fonds.js:13-14,56,
80`), a relief package from the sibling repository's GitHub release
(`server.js:410,429`), and the updater at `MAJ_URL` only when a token exists
(`server.js:3609-3620`).

### 2.3 Made by the browser

Map tiles come from third parties directly to the user's browser. The default
base map is Esri ArcGIS Online (SOURCE `config.js:101-104`). The frontend also
references IGN, OpenTopoMap, RainViewer and Open-Meteo (SOURCE
`carte-live/public/app.js:7953,7969`, and host list extracted from
`carte-live/public/*.js`). Leaflet, MapLibre, Protomaps-Leaflet and D3 are
served locally, not from a CDN (SOURCE `server.js:207-209`,
`carte-live/public/topologie.html:148`).

## 3. HTTP surface

Server: Express 5 with `compression`; `x-powered-by` disabled (SOURCE
`server.js:146-151`). JSON bodies limited to 10 kB, except photo upload (5 MB)
and settings restore (30 MB) (SOURCE `server.js:153-155`).

### 3.1 Response headers

EMPIRICAL (`GET /` on the pinned image) and SOURCE `server.js:202-206`:

- Sent: `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `Cache-Control: no-cache` on HTML pages.
- **Not sent**: `X-Frame-Options`, `Content-Security-Policy` (so no
  `frame-ancestors`), `Strict-Transport-Security`, `Permissions-Policy`.
- `Access-Control-Allow-Origin: *` on `/api/federation` and on all export
  endpoints (SOURCE `server.js:4173,4186`).
- There are no HTTP redirects anywhere in the server (SOURCE: no
  `res.redirect` or `Location` header under `carte-live/src`).

### 3.2 Health endpoint

`GET /sante` returns `200` and `{"ok":true,"mqtt":<bool>}`. It needs no
authentication and is always `ok:true` while the process serves HTTP; `mqtt`
reports whether the input broker is connected (SOURCE `server.js:2858`;
EMPIRICAL). The image `HEALTHCHECK` calls it every 60 s (SOURCE
`Dockerfile:45`). A richer `GET /api/sante-carte` needs a logged-in member
(SOURCE `server.js:2870-2873`).

### 3.3 WebSocket endpoints

All on the HTTP port, handled in the `upgrade` event (SOURCE
`server.js:2903-2912`). There is no SSE endpoint.

| Path | Who | Purpose | Evidence |
| --- | --- | --- | --- |
| `/ws` | anyone | Live event stream, server to browser only (4 kB max inbound). Anonymous clients get a redacted view. Server pings every 30 s. | SOURCE `server.js:2878,3010-3023,3050-3057`; EMPIRICAL (101 without a cookie) |
| `/ws/module` | logged-in account | Browser relays a Meshtastic radio opened with Web Serial or Web Bluetooth | SOURCE `server.js:2890-2912,2945-2961`; EMPIRICAL (403 `X-Refus: connexion requise` without a cookie) |
| `/ws/meshcore` | logged-in account, only if MeshCore is enabled | Same for a MeshCore companion | SOURCE `server.js:2907,2988-3002` |

Any other upgrade path is answered `403`.

### 3.4 Static content and pages

| Path | Content | Evidence |
| --- | --- | --- |
| `/`, `/index.html` | Main application | SOURCE `server.js:230` |
| `/publique`, `/publique.html` | Public read-only map | SOURCE `server.js:231,4193` |
| `/rejoindre` | "Join the network" page (server-rendered) | SOURCE `server.js:3206` |
| `/topologie.html`, `/relief3d.html`, `/rejoindre.html`, scripts, CSS, icons, `i18n-*.json`, `sw.js`, `manifest.webmanifest` | `express.static` on `carte-live/public`, `max-age` 5 min | SOURCE `server.js:232` |
| `/vendor/leaflet`, `/vendor/maplibre`, `/vendor/protomaps-leaflet` | From `node_modules`, `max-age` 7 days | SOURCE `server.js:207-209` |
| `/agent/live-mesh-agent-*` | Agent executables, **public** | SOURCE `Dockerfile:37`; EMPIRICAL (200, 3.7 MB, no cookie) |
| `/rapport`, `/rapports/:nom` | Reports, members only | SOURCE `server.js:1468,1476-1481`; EMPIRICAL (401) |
| `/fonds/fond.pmtiles` | Offline base map if one was downloaded, public, range requests | SOURCE `server.js:2131-2135` |

HTML pages are rewritten when served: `href="/x.css"` and `src="/x.js"` get
`?v=<version>` appended (SOURCE `server.js:213-221`).

### 3.5 Route inventory by access level

Counts come from a script that classifies each of the 281 `app.<verb>()`
routes in `server.js` by the first guard in its handler (wrappers
`routeEquipe`, `routeCompte` and `exporter` included). It is a heuristic, so
the counts are indicative; the "public" bin can contain routes whose guard is
nested deeper. Rows marked EMPIRICAL were requested without a cookie.

| Level | Guard | Approx. routes | Examples |
| --- | --- | --- | --- |
| Public | none | about 80 | `/api/config`, `/api/version`, `/api/noeuds`, `/api/liens`, `/api/etat`, `/api/paquets`, `/api/topologie`, `/api/historique`, `/api/rejeu`, `/api/aide/:page`, `/api/federation`, `/api/relief/*` (terrain, coverage, planning, including `POST /api/relief/simulation`), `/api/mc/noeuds`, `/api/installation`, `/api/connexion`, `/api/inscription`, `/api/mot-de-passe/*`, `/sante` (EMPIRICAL 200 for the first nine and `/sante`) |
| Export token | `EXPORT_JETON` if set, else public | 7 | `/metrics`, `/api/export/noeuds.geojson`, `/api/export/liens.geojson`, `/api/export/resume.json`, `/api/export/relais.gpx`, `/api/export/reseau.kml`, `/api/export/reseau-direct.kml` (SOURCE `server.js:4183-4197`; EMPIRICAL 200 with no token configured) |
| Member | any active account (`estMembre`, or `utilisateur(req)`) | about 35 | `/api/messages`, `/api/notifications`, `/api/sante-carte`, `/api/releves`, `/api/compte/*`, `/api/suivis`, `/api/envoi`, `/api/signalements` (EMPIRICAL 401 for these) |
| Manager | role `admin` or `gestionnaire`, plus per-node scope (`estGestion`, `peutGerer`) | about 45 | `/api/admin-noeuds/*`, `/api/noeuds/:num/installation`, `/api/mc/admin/*` (SOURCE `server.js:106-119,324-326`) |
| Admin | role `admin` (`estAdmin`, `exigerAdmin`) | about 115 | `/api/reglages`, `/api/reglages/variables`, `/api/comptes`, `/api/audit`, `/api/maj`, `/api/diagnostic`, `/api/sauvegardes*`, `/api/sauvegarde-complete`, `/api/radio/*`, `/api/equipes*`, `/api/passerelle*`, `/api/frequentation` (EMPIRICAL 401 for the first eight) |

Public data is redacted rather than hidden: anonymous visitors get no message
text and positions of non-infrastructure nodes rounded to
`PRECISION_PUBLIQUE_DECIMALES` (SOURCE `reseau.js:245-248`,
`server.js:3050-3057`).

### 3.6 Export endpoints and `EXPORT_JETON`

- If `EXPORT_JETON` is empty, exports are open to everyone. If set, the
  request must carry `?jeton=<token>` or `Authorization: Bearer <token>`;
  otherwise `401` (SOURCE `exports.js:7-12`, `server.js:4184-4185`).
- The comparison is a plain string equality, not constant-time (SOURCE
  `exports.js:11`).
- A logged-in session does **not** bypass the token.
- `/metrics` is Prometheus text format `0.0.4` (SOURCE `server.js:4188,4194`).
- `/api/export/reseau-direct.kml` builds an absolute URL from the request
  `Host` and protocol (SOURCE `server.js:4197-4206`).

### 3.7 Downloads

`/api/sauvegarde-complete` (admin, tar.gz of the database and state),
`/api/sauvegardes/:nom` (admin, JSON), `/api/agent/pret/:fichier` (admin,
agent with embedded server address and agent code), node configuration YAML,
sensor CSV, export files, report HTML, field-survey photos (SOURCE
`server.js:945-958,1434,3432,3747-3760,4166,4252-4255`).

## 4. Authentication model

### 4.1 Accounts and roles

- Accounts are local, in the SQLite table `comptes`. Passwords use scrypt
  with a random salt; optional TOTP second factor (SOURCE
  `comptes.js:14-25,39-57,60-74`).
- Roles: `admin`, `gestionnaire` (manager of listed nodes), `membre` (SOURCE
  `comptes.js:11-12`).
- There is **no** trusted-header, SSO, API-key or "no authentication" mode.
  Home Assistant's own login does not log the user in to the app.
- A read-only demo mode exists: any anonymous visitor who sends `X-Demo: 1`
  (the page does this when opened with `?consultation`) may `GET` a fixed
  list of member and admin screens, with secrets masked by key name. It is
  always on and cannot be disabled by configuration (SOURCE
  `server.js:101-119,165-200`). EMPIRICAL: not exercised.

### 4.2 First run

- While no account exists, `GET /api/config` reports `installation: true` and
  the page shows the setup wizard (SOURCE `server.js:285`,
  `comptes.js:152`).
- `POST /api/installation` creates the first admin account. If
  `ADMIN_MOT_DE_PASSE` is set, that value is required as `code`. Otherwise a
  code is required only when the request is **not local** (SOURCE
  `server.js:2290-2303`).
- "Local" (`ipPrivee`) means: the TCP peer is loopback or RFC 1918 / ULA,
  **and** the request has none of `X-Forwarded-For`, `X-Real-IP`,
  `Forwarded`, `CF-Connecting-IP` (SOURCE `server.js:123-130`).
- Without `ADMIN_MOT_DE_PASSE`, a random code such as `Y3EF-4LM2` is written
  to `/data/code-installation.txt` and printed in the log 1.5 s after start;
  it is deleted once the admin exists (SOURCE `server.js:2262-2277,2323`).
- EMPIRICAL: direct request from the Docker bridge: `codeRequis:false`. Same
  request with `X-Forwarded-For`: `codeRequis:true`; missing or wrong code is
  rejected with `403`; the logged code is accepted.
- During this window, `POST /api/mqtt/tester` and
  `POST /api/restauration-complete` (restore a full backup, replacing the
  database) are also allowed to "local" requests **without any code, even when
  `ADMIN_MOT_DE_PASSE` is set** (SOURCE `server.js:2382-2391,3765-3773`).
  Not exercised empirically.

Consequence: through Ingress, which adds forwarding headers (UNVERIFIED here;
Home Assistant behaviour), the wizard will always ask for the setup code. If
the web port is also published on the LAN before setup is finished, any LAN
host can create the admin account (when `ADMIN_MOT_DE_PASSE` is unset) or
restore a backup.

### 4.3 Sessions

| Property | Value | Evidence |
| --- | --- | --- |
| Cookie name | `gaulix_session` | SOURCE `server.js:92-94,121` |
| Attributes | `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`, plus `Secure` only when `req.secure` | SOURCE `server.js:119-122`; EMPIRICAL |
| `Secure` decision | `req.secure` follows `X-Forwarded-Proto` from a trusted proxy | EMPIRICAL (`Secure` present with `X-Forwarded-Proto: https`, absent without) |
| Token format | `<account id>.<account version>.<expiry ms>.<HMAC-SHA256 hex>`; stateless | SOURCE `comptes.js:174-189` |
| Signing key | `SECRET_SESSION`, else `/data/secret-session.txt` (generated, mode 0600) | SOURCE `comptes.js:107-114` |
| Lifetime | 30 days, fixed at login, not refreshed | SOURCE `comptes.js:10,176` |
| Revocation | Changing password, role, status or TOTP increments the account version and invalidates all its sessions | SOURCE `comptes.js:96-103,186` |
| Logout | Clears the cookie client-side only; the token stays valid until expiry | SOURCE `server.js:1948-1952` |

The cookie `Path` is always `/`. Under Ingress the cookie is therefore set
for the whole Home Assistant origin, not for the Ingress path.

### 4.4 CSRF and origin checks

- There is no CSRF token and no `Origin` or `Referer` check (SOURCE: none
  under `carte-live/src`; EMPIRICAL: an authenticated `POST` with
  `Origin: https://evil.example` succeeded).
- The only mitigation is `SameSite=Lax` plus JSON bodies being parsed only for
  `Content-Type: application/json` (Express default).
- WebSocket upgrades do not check `Origin` (SOURCE `server.js:2903-2912`).
- Inside Home Assistant, every Ingress app shares the Home Assistant origin,
  so `SameSite` gives no isolation between apps on that origin (UNVERIFIED;
  general property of same-origin iframes).

### 4.5 Rate limiting and lockout

| Mechanism | Rule | Evidence |
| --- | --- | --- |
| Generic limiter | More than 8 attempts per key in 15 min → `429`. Keys: `req.ip` for login, registration, setup; `mdp:<ip>` and `reinit:<ip>` for password reset. In memory. | SOURCE `server.js:132-143,1921,1956,1975,1997,2292` |
| Login lockout by address | 3 failed logins in 15 min → address blocked 15 min, doubling up to 24 h. Persisted in `/data/blocages.json`. | SOURCE `blocages.js:4-12,18-21,24,59` |
| Login lockout by account | 3 failures in 15 min → account suspended 15 min, except from local or Tailscale addresses | SOURCE `blocages.js:6-11,34,42-45` |

All of these key on `req.ip`. See 4.6.

### 4.6 Reverse-proxy awareness

- `trust proxy` is `PROXY_CONFIANCE`, default `loopback, linklocal,
  uniquelocal`. In Express these names cover `127.0.0.1/8`, `::1`,
  `169.254.0.0/16`, `fe80::/10`, `10.0.0.0/8`, `172.16.0.0/12`,
  `192.168.0.0/16`, `fc00::/7` (SOURCE `config.js:48`, `server.js:147-149`;
  the CIDR expansion is Express documentation, UNVERIFIED here).
- With a trusted proxy, `req.ip` comes from `X-Forwarded-For`, `req.protocol`
  and `req.secure` from `X-Forwarded-Proto`. `X-Forwarded-Host` is not used by
  Express 5 for `req.hostname` unless trusted; upstream reads it explicitly
  in one place (SOURCE `server.js:4202`).
- `X-Forwarded-Prefix`, `X-Ingress-Path` and similar are never read (SOURCE).
- If the proxy in front does **not** send `X-Forwarded-For`, every user shares
  the proxy's address: three wrong passwords by anyone lock out everyone for
  15 min or more, and the first-run wizard treats the proxy as "local" and
  asks for no code.

### 4.7 What an unauthenticated visitor can do

EMPIRICAL on the pinned image unless marked.

- Read: the full map page, node list (redacted), links, packets (no text),
  network state and alerts (public subset), history, topology, terrain and
  coverage data, help pages, the app version, and whether setup is pending.
- Read exports and `/metrics` when `EXPORT_JETON` is unset.
- Download agent executables.
- Open the `/ws` live stream.
- Trigger server-side terrain and coverage computations
  (`POST /api/relief/simulation` returned 200).
- Self-register an account unless `INSCRIPTIONS=fermees`. With the default
  `validation` the account waits for admin approval (SOURCE
  `server.js:1954-1966`).
- Cannot: read message text, send over radio, change settings, read accounts,
  download backups (all 401).
