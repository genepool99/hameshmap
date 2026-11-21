# Upstream persistence, process lifecycle, updater and local hardware

Pinned: `v1.5.14`, commit `07bc1a7`. Labels are defined in
[README.md](README.md). File names are under `carte-live/src/` unless a
directory is given.

## 1. Data directory

Every state file is written to `dirname(FICHIER_BASE)`. With the image
default that is `/data` (SOURCE `Dockerfile:26,41,44`, `config.js:145,195`).
The names below assume that default.

### 1.1 Database

| Fact | Evidence |
| --- | --- |
| SQLite through `better-sqlite3`, file `/data/carte-live.db` | SOURCE `base.js:6-10` |
| `journal_mode = WAL`, `synchronous = NORMAL`; so `carte-live.db-wal` and `carte-live.db-shm` exist alongside while running | SOURCE `base.js:11-12`; EMPIRICAL |
| The WAL is checkpointed and truncated at each hourly purge and on a clean shutdown | SOURCE `base.js:197`, `server.js:4272-4279,4294` |
| A backup that copies only `carte-live.db` while the app runs can miss recent writes that are still in the WAL. Copy all three files, or stop the app first. | follows from WAL mode; not tested |
| Retention: traffic 7 days (`RETENTION_JOURS`), text messages 90 days, MeshCore packets 2 days; purge at start and every hour | SOURCE `config.js:65,67,158`, `server.js:4272-4280` |
| Accounts, audit log, visitor counters and MeshCore tables are in the same database | SOURCE `comptes.js:60`, `audit.js:8`, `frequentation.js:18`, `meshcore/reseau.js:16` |
| The directory is created if missing (`mkdir -p`) | SOURCE `base.js:9` |

### 1.2 Schema migration

There is no schema version and no migration framework. At every start each
module runs `CREATE TABLE IF NOT EXISTS …` and adds missing columns with
`ALTER TABLE … ADD COLUMN` after checking `PRAGMA table_info` (SOURCE
`base.js:13-76`, `comptes.js:60-74`, `meshcore/reseau.js:58-59`).

Consequences: upgrades are automatic and additive; there is no downgrade
path and no pre-upgrade backup of the database. Whether an older release
runs against a database touched by a newer one is UNVERIFIED.

### 1.3 Other files in `/data`

About 60 possible files, flat in the directory. Groups (SOURCE: every
`path.join(<data dir>, …)` under `carte-live/src`; EMPIRICAL for those marked
*seen*):

| File or directory | Content | Sensitive |
| --- | --- | --- |
| `reglages.json` (+ `.bak`) | Settings saved from the UI, including catalogue variables. Mode 0600. *seen* | **yes**: broker passwords, tokens, channel keys |
| `secret-session.txt` | Session signing key, mode 0600. *seen* | **yes** |
| `code-agents.txt` | Agent shared code, mode 0600. *seen* | **yes** |
| `code-installation.txt` | Setup code, deleted after the first admin is created. *seen* | **yes** while it exists |
| `maj-jeton.txt` | Updater token; created only by the updater process | **yes** |
| `cle-equipes.bin`, `equipes.json` | Team channel keys | **yes** |
| `blocages.json` | Login lockouts (addresses and account names) | personal data |
| `sauvegardes/` | Daily JSON backup of settings files **and the account table (with password hashes)**; taken about 1 min after start if none exists for the day and at 03:30; the last 14 are kept; directory mode 0700. *seen* | **yes** |
| `mnt.bin`, `mnt.json`, `sommets-osm.json`, `communes-sommets.json`, `realisme.json`, `relief-public.json` | Terrain grid and derived caches for the map area. *seen*: 1.1 MB + 1.4 MB for one French department | no |
| `geoip/dbip-country-lite.mmdb` | Country database, about 8 MB, refreshed monthly. *seen* | no |
| `fonds/fond.pmtiles`, `fonds/fond.json` | Offline base map, only if an admin downloads one. Size depends on the area; can be large. | no |
| `firmware/` | Downloaded Meshtastic firmware binaries. *seen* (empty) | no |
| `releves/`, `releves.json` | Field surveys with uploaded JPEG photos (5 MB request limit each). *seen* (empty) | location data, photos |
| `rapports/` | Generated HTML reports. *seen* | network data |
| `feux.json`, `alertes-officielles.json`, `sites-routiers.json` | Cached public feeds. *seen* (`feux.json`) | no |
| `modules-radio.json`, `modules-ecoute.json`, `relais-ip.json`, `meshcore-*.json`, `configs-noeuds.json`, `installations.json`, `passerelle.json`, `signalements.json`, `federation.json`, `adhesion.json`, `jeux-canaux.json`, `suivis.json`, `maj-auto.json`, `fonctions-masquees.json`, `postgres*.json`, and others | Feature state. Several hold node admin keys or remembered repeater passwords. | some **yes** |
| `restauration.tar.gz`, restore staging directory, `avant-restauration-<date>/` | Full-restore upload, staging, and the previous state kept aside after a restore | **yes** |
| `carte-live.sauvegarde.db` | Temporary `VACUUM INTO` copy during a full-backup download | **yes** |
| `courriels-essai/` | Test e-mails when SMTP is in test mode | maybe |

State files are written atomically: temporary file, `fsync`, previous version
renamed to `.bak` when under 2 MB, then rename. Readers fall back to `.bak`
when the main file is missing or unparsable (SOURCE `fichiers.js:10-39`).

Growth: with defaults and no traffic the directory was 11 MB after 15 minutes
(EMPIRICAL). Under real traffic the database dominates and is bounded by the
retention settings; no size figure was measured (UNVERIFIED). Upstream's
Compose file sets no disk limit.

### 1.4 Writes outside `/data`

None found. Every write under `carte-live/src` targets the data directory
(SOURCE). The pinned image ran normally with a read-only root filesystem and
a writable `/data` (EMPIRICAL, 6 s observation, no error logged). Nothing is
written to `/tmp` or `/app`.

### 1.5 Failure behaviour

| Situation | Behaviour | Evidence |
| --- | --- | --- |
| `carte-live.db` is not a database | Process crashes at start with `SqliteError … SQLITE_NOTADB`, exit code 1. No automatic recovery and no rename of the bad file. | EMPIRICAL |
| `/data` not writable by the process user | Crashes at start with `SQLITE_CANTOPEN`, exit code 1 | EMPIRICAL |
| `reglages.json` unreadable | Logged; `reglages.json.bak` is used; if that also fails, environment values are used | SOURCE `config.js:237-250` |
| Disk full | No dedicated handling. Database errors inside the MQTT handler are caught and logged per message; an error thrown from a timer or request handler outside a `try` is not caught (there is an `unhandledRejection` logger but no `uncaughtException` handler). | SOURCE `server.js:3170-3173,4289`; behaviour UNVERIFIED |
| Input broker unreachable | Non-fatal; retry every 5 s with one log line each time (about 17 000 lines per day) | EMPIRICAL |
| Terrain source unreachable | Non-fatal; logged once | EMPIRICAL |

## 2. Process

| Fact | Evidence |
| --- | --- |
| Image user is `node`: uid 1000, gid 1000 | SOURCE `Dockerfile:42`; EMPIRICAL (`id`) |
| `/data` in the image is owned by `node:node` and declared as a volume | SOURCE `Dockerfile:41,44`; EMPIRICAL |
| A mounted `/data` must be writable by the user the process runs as. The app does not `chown` anything. | EMPIRICAL (root-owned `/data` → crash) |
| It also runs as another uid (tested 12345, and 0) provided `/data` is writable by that uid | EMPIRICAL |
| Entrypoint `docker-entrypoint.sh` execs `node src/server.js`; Node is PID 1 | EMPIRICAL (`/proc/1/cmdline`) |
| Working directory `/app`; application code is root-owned and read-only to the process | EMPIRICAL |
| `SIGTERM` and `SIGINT`: log `Stopping…`, close the MeshCore publisher and the input MQTT client, close the database, `exit(0)` | SOURCE `server.js:4290-4297` |
| `docker stop` returned in about 0.25 s with exit code 0 | EMPIRICAL |
| Not done on shutdown: the HTTP server is not drained, WebSockets are not closed politely, the home-automation MQTT client is not ended (its last will fires instead) | SOURCE `server.js:4290-4297`; EMPIRICAL (retained `offline` appeared) |
| The image `HEALTHCHECK` is a `node -e fetch(…/sante)` every 60 s, timeout 5 s, start period 20 s | SOURCE `Dockerfile:45` |
| Tools the app shells out to, present in the image: `tar` (full backup and restore, relief package), `stty` (server serial port), `pmtiles` (offline base map) | SOURCE `server.js:420-440,3756-3758`, `restauration.js:14-29`, `serie.js:24`, `fonds.js:28-29,80`; EMPIRICAL (`which`) |

### 2.1 The app restarts itself by exiting

Three code paths call `process.exit(0)` and rely on the container runtime to
start the process again (upstream uses `restart: unless-stopped`):

| Trigger | Evidence |
| --- | --- |
| Any settings save: first-run wizard with changed settings, settings page, advanced variables, MeshCore settings | SOURCE `server.js:2251-2258,2327,2830-2831,2855` |
| Restore of a settings backup | SOURCE `server.js:4256-4259` |
| Restore of a full backup (applied at the next start, before the database is opened) | SOURCE `server.js:3794`, `server.js:19-24`, `restauration.js:40-63` |

EMPIRICAL: after saving a variable through the API the container stopped
with exit code 0 and stayed stopped (no restart policy in the test). The page
then polls `/sante` and reloads when it answers (SOURCE
`carte-live/public/app.js:6124-6127`).

The App must therefore restart the process after a clean exit. How Home
Assistant Supervisor treats an App whose main process exits with code 0 is
UNVERIFIED here.

### 2.2 Resource hints

- Upstream's Compose file limits the container to 512 MB (SOURCE
  `docker-compose.yml:23`).
- Observed resident memory, idle, amd64: 58 MB (MeshCore off, isolated
  network) to 128 MB (after loading terrain) (EMPIRICAL, `docker stats`).
  The app's own health sample reported 108 to 114 MB RSS (EMPIRICAL).
- Terrain and coverage computations are CPU-bound in the main process; one
  run showed 13 % CPU while downloading and preparing terrain (EMPIRICAL).
  Peak memory under real traffic or large areas is UNVERIFIED.
- The app reads the cgroup memory limit and raises its own alert when close
  to it (SOURCE `sante-carte.js:8-13`).

## 3. Updater

| Fact | Evidence |
| --- | --- |
| The updater is a separate process, `node src/majeur.js`, run by upstream as a second container as root with the Docker socket mounted. It pulls the image and recreates the app container. | SOURCE `docker-compose.yml:35-53`, `majeur.js:1-12,99-143` |
| The main app never touches the Docker socket. It only calls `MAJ_URL` (default `http://maj:4405`) with a bearer token from `MAJ_JETON` or `/data/maj-jeton.txt`. | SOURCE `server.js:3609-3620` |
| Without a token, no network call is made: `GET /api/maj` answers `installe:false, raison:"service de mise à jour non installé"`, and `POST /api/maj` answers 400. | SOURCE `server.js:3614-3616,3652-3668`; EMPIRICAL (`GET /api/maj`) |
| The token file is created only by the updater process. With no updater the file never appears. | SOURCE `majeur.js:26-35` |
| Nightly auto-update is off by default and can only do something if the updater answers | SOURCE `server.js:3799-3820` |
| The update UI cannot be hidden by configuration. Admins always have a "Mettre à jour la carte" entry and a version badge; with no updater the dialog explains that the one-click service is not installed and points to the Compose instructions. | SOURCE `carte-live/public/app.js:574-583,1873`, `server.js:3652-3657`; EMPIRICAL (`/api/diagnostic` item "Mise à jour en un clic non installée") |
| Version check: `GET https://api.github.com/repos/<DEPOT_GITHUB>/releases/latest` 15 s after start and hourly, and again when an admin opens the update dialog. Disabled by `VERIFIER_MAJ` set to `0`, `non`, `no`, `false` or `off`. | SOURCE `server.js:235-251,3655` |
| With the check disabled, `majDisponible` stays false and the "new version available" hint never shows | SOURCE `server.js:239,252` |
| With the check enabled, the badge will tell admins that a newer upstream release exists and invite them to update, which the App cannot do from inside the UI | SOURCE `carte-live/public/app.js:574-583` |

For the App: do not run `majeur.js`, do not set `MAJ_URL` or `MAJ_JETON`, do
not create `maj-jeton.txt`, and consider `VERIFIER_MAJ=non` so that the UI
does not advertise upstream releases that the App has not packaged.

## 4. USB, serial, Bluetooth and other radio links

All of these are optional. With none of them the app runs from MQTT alone
(EMPIRICAL: every test here ran without a radio; log line `No active radio
module`).

| Link | How | Needs | Evidence |
| --- | --- | --- | --- |
| MQTT only | default | nothing | EMPIRICAL |
| Meshtastic node over TCP | `RADIO_HOTE` / `RADIO_PORT` (4403) or chosen in the UI; outbound TCP | network reachability | SOURCE `config.js:110-111`, `radio.js:122` |
| MeshCore companion over TCP | chosen in the UI; outbound TCP | network reachability | SOURCE `meshcore/companion.js:350` |
| USB serial on the server | Admin picks `/dev/ttyACM*`, `/dev/ttyUSB*`, `/dev/ttyAMA*`, `/dev/ttyS*`, `/dev/ttyTHS*` or `/dev/serial/by-id/*`; configured with `stty`, 115200 baud | the device mapped into the container and group access (`dialout`) | SOURCE `serie.js:1-24`, `server.js:1062-1085`, `docker-compose.yml:24-28` |
| Browser-attached radio | Web Serial or Web Bluetooth in the user's browser, relayed over `/ws/module` or `/ws/meshcore` | secure context; not expected to work inside the Ingress iframe | SOURCE `carte-live/public/app.js:6871,6909,6955`; see [ingress-audit.md](ingress-audit.md) |
| Agent | Remote helper program connecting to TCP 4404 | port 4404 reachable from the agent | SOURCE `agents.js:1-5` |
| Meshtastic UDP multicast | `UDP_MESHTASTIC=oui` | host networking | SOURCE `udp-meshtastic.js:1-6` |
| mDNS discovery of Wi-Fi nodes | on by default; multicast queries | same L2 network; ineffective on a bridged container network | SOURCE `server.js:1178-1181`, `mdns.js:109-117` |

There is no server-side Bluetooth code: Bluetooth exists only through the
browser (SOURCE: no BLE library in `carte-live/package.json:11-28`).

Transmitting over LoRa (messages, remote administration, traceroutes) is
only possible when one of the radio links above is connected.
