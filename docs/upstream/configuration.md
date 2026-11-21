# Upstream configuration reference

Pinned: `v1.5.14`, commit `07bc1a7`. Labels (SOURCE / EMPIRICAL / UNVERIFIED)
are defined in [README.md](README.md). Paths are relative to the upstream
repository root.

## 1. Where configuration comes from, and precedence

Upstream has three layers. From weakest to strongest:

1. **Built-in defaults** in code. Several are French-specific (see section 5).
2. **Environment variables**.
3. **Settings saved from the web UI**, stored in `reglages.json` next to the
   database. They override the environment at the next start.

| Fact | Evidence |
| --- | --- |
| `reglages.json` lives in `dirname(FICHIER_BASE)`, i.e. `/data/reglages.json`. | SOURCE `carte-live/src/config.js:195`, `carte-live/src/variables.js:108-110` |
| At start, every key of `reglages.json` → `variables` that is in the catalogue is copied into `process.env` **before** the configuration is read. UI values therefore replace environment values. | SOURCE `carte-live/src/server.js:4-6`, `carte-live/src/variables.js:115-125`; EMPIRICAL (set `DOMOTIQUE_RACINE` in the UI, restarted, API reported origin `carte`) |
| The catalogue has 79 variables, including all `DOMOTIQUE_*` and `EXPORT_JETON`. | SOURCE `carte-live/src/variables.js:12-102`; EMPIRICAL (`GET /api/reglages/variables` returned 79) |
| Title, area, MQTT input URL/user/password/root, extra brokers, channels, registrations, retention and MeshCore settings are also UI-settable and override the environment. | SOURCE `carte-live/src/config.js:204-236` |
| The first-run wizard and the settings page only store values that differ from the environment. | SOURCE `carte-live/src/server.js:2305-2317`, `2238-2250` |
| Environment-only (never in the UI): `PORT`, `FICHIER_BASE`, `ADMIN_MOT_DE_PASSE`, `SECRET_SESSION`, `PROXY_CONFIANCE`. | SOURCE `carte-live/src/variables.js:5-6` |
| Saving any setting writes `reglages.json` and then calls `process.exit(0)` after about 1.2 s, expecting the container runtime to restart the process. | SOURCE `carte-live/src/server.js:2251-2258`; EMPIRICAL (container exited with code 0) |

Consequence for the App: an administrator of the web UI can override any
catalogue variable that the App sets through the environment, including
`DOMOTIQUE_ENVOI_LORA` and `DOMOTIQUE_MQTT_URL`. The App cannot enforce these
by environment alone.

## 2. Parsing rules

There is no single boolean parser. Use lowercase `oui` / `non` everywhere; it
is the only spelling that every site accepts.

### 2.1 `texte()` and `nombre()` (most variables read in `config.js`)

SOURCE `carte-live/src/config.js:8-30`. EMPIRICAL for the boolean table below.

- Unset or empty string returns the default. An empty variable cannot be used
  to mean "none" where a default exists (for example `MQTT_URL=` still gives
  `mqtt://localhost:1883`).
- The value is trimmed and lowercased **for matching only**. If it equals
  `yes`, `y`, `true`, `on` it becomes `oui`; `no`, `n`, `false`, `off` become
  `non`. Otherwise the original string is returned unchanged (not trimmed, not
  lowercased).
- `1` and `0` are **not** aliases. `OUI` and `Oui` are returned unchanged.
- The alias rule applies to every `texte()` variable, including
  `MQTT_UTILISATEUR`, `MQTT_MOT_DE_PASSE`, `EXPORT_JETON` and
  `ADMIN_MOT_DE_PASSE`. A credential whose whole value is one of the eight
  alias words (any case) is silently rewritten to `oui` or `non`.
- `nombre()` uses `Number()`; a non-numeric value falls back to the default.

### 2.2 Per-variable boolean behaviour

| Variable | Test in code | True for | False for | Default |
| --- | --- | --- | --- | --- |
| `DOMOTIQUE_DECOUVERTE` | raw `String(v).toLowerCase() === 'oui'` (no alias, no trim) | `oui`, `OUI`, `Oui` | everything else, including `true`, `1`, `yes`, `on`, ` oui` | **true** when unset or empty |
| `DOMOTIQUE_ENVOI_LORA` | same | `oui` (any case) | everything else | **false** when unset or empty |
| `MESHCORE`, `MESHCORE_REPUBLIER` | `texte(...) !== 'non'` | anything except the false set, including `0` | `non`, `no`, `n`, `false`, `off` (any case for the aliases; `non` must be lowercase) | true |
| `MQTT_TLS_NON_VERIFIE`, `CARTE_TUILES_SOMBRES` | `texte(...) === 'oui'` | `oui`, `yes`, `y`, `true`, `on` | everything else, including `1`, `OUI` | false |
| `PASSERELLE` | regex on `texte()` | `1`, `oui`, `true`, `on`, `yes` enable at first start | `0`, `non`, `false`, `off`, `no` forbid | neither (admin may enable) |
| `VERIFIER_MAJ` | regex `^(0\|non\|no\|false\|off)$`, case-insensitive | anything else, or unset | `0`, `non`, `no`, `false`, `off` | check enabled |
| `MDNS_MESHTASTIC`, `PASSERELLE_MEMBRES`, `STATS_FREQUENTATION`, `STATS_PAYS` | raw `toLowerCase() !== 'non'` | anything except `non` | `non` only (`false`, `no`, `0` do **not** disable) | true |
| `UDP_MESHTASTIC`, `LORAWAN`, `RIVIERES` | raw `toLowerCase() === 'oui'` | `oui` only | everything else | false |

Evidence: SOURCE `carte-live/src/domotique.js:13-24`,
`carte-live/src/config.js:52,105,125,148,152`,
`carte-live/src/server.js:239,1178,2887,3249`,
`carte-live/src/frequentation.js:17,69`, `carte-live/src/lorawan.js:27`,
`carte-live/src/rivieres.js:17`. EMPIRICAL: `DOMOTIQUE_*`, `MESHCORE`,
`MESHCORE_REPUBLIER`, `MQTT_TLS_NON_VERIFIE` and `PASSERELLE` were evaluated
inside the pinned image for 16 input values; results match the table.

Note: when a catalogue variable is saved from the UI, the UI only offers
`oui` / `non` (SOURCE `carte-live/src/variables.js:10`).

## 3. Variables relevant to the App

None is strictly required: the process starts with no environment at all
(EMPIRICAL). "Secret" means the value must not be logged.

| Variable | Default | Parsing | Secret | Notes | Evidence |
| --- | --- | --- | --- | --- | --- |
| `PORT` | `8095` | `nombre` | no | HTTP and WebSocket port. Binds all interfaces. Env-only. | SOURCE `config.js:46`, `server.js:4286`; `Dockerfile:25`; EMPIRICAL |
| `AGENTS_PORT` | `4404` | `Number(env \|\| 4404)` | no | Agent TCP listener. Cannot be disabled; see [network-and-http.md](network-and-http.md). Undocumented upstream. | SOURCE `agents.js:20,108`; EMPIRICAL |
| `FICHIER_BASE` | `/data/carte-live.db` | `texte` | no | SQLite path. Its directory is the data directory for every other state file. Env-only. | SOURCE `config.js:145`; `Dockerfile:26` |
| `TZ` | `Europe/Paris` (image `ENV`) | Node runtime | no | Not read by application code. Some displayed times are hard-coded to `Europe/Paris` regardless of `TZ` (login block messages, nightly auto-update hour). | SOURCE `Dockerfile:27`, `server.js:1914,3814` |
| `LANGUE` | `en` (from `package.json` `langueServeur`) | starts with `en` → English, else French | no | Language of the server log and of alert text sent to MQTT and radio. | SOURCE `server.js:17`, `package.json:30` |
| `PROXY_CONFIANCE` | `loopback, linklocal, uniquelocal` | passed to Express `trust proxy` | no | Which proxy addresses may supply `X-Forwarded-*`. Env-only. | SOURCE `config.js:48`, `server.js:149` |
| `ADMIN_MOT_DE_PASSE` | empty | `texte` | **yes** | Setup code required by the first-run wizard. If empty, a random code is generated and logged when the request does not look local. Env-only. | SOURCE `config.js:69`, `server.js:2260-2303` |
| `SECRET_SESSION` | empty | `texte` | **yes** | HMAC key for session cookies. If empty, generated and stored in `/data/secret-session.txt`. Env-only. | SOURCE `config.js:70`, `comptes.js:107-113` |
| `MQTT_URL` | `mqtt://localhost:1883` | `texte` | may embed credentials | Input broker. `mqtt://`, `mqtts://`, `ws://`, `wss://`. Cannot be emptied (see 2.1). UI-overridable. | SOURCE `config.js:50`, `server.js:3078` |
| `MQTT_UTILISATEUR` | empty | `texte` | no | UI-overridable. | SOURCE `config.js:53` |
| `MQTT_MOT_DE_PASSE` | empty | `texte` (alias caveat) | **yes** | UI-overridable. | SOURCE `config.js:54` |
| `MQTT_RACINE` | `msh/EU_868` | `texte`, trailing `/` and `/#` stripped | no | The app subscribes to `<root>/#`. | SOURCE `config.js:4,55`, `server.js:3086` |
| `MQTT_SUJETS_SUPPLEMENTAIRES` | empty | comma list | no | Extra subscriptions on the same broker. | SOURCE `config.js:57` |
| `MQTT_BROKERS_SUPPLEMENTAIRES` | empty | comma list of `url` or `url\|root`, max 5 | **yes** (credentials in URL) | Extra input brokers. | SOURCE `config.js:60` |
| `MQTT_TLS_NON_VERIFIE` | `non` | see 2.2 | no | Disables TLS certificate verification for all input brokers. | SOURCE `config.js:52`, `server.js:3084` |
| `CANAUX` | `LongFast=AQ==` | `name=base64key` separated by `;` or newline | **yes** (channel keys) | Meshtastic channels to decrypt. | SOURCE `config.js:33-43,62` |
| `MESHCORE` | `oui` | see 2.2 | no | Enables MeshCore handling and the `<MESHCORE_RACINE>/#` subscription. | SOURCE `config.js:148` |
| `MESHCORE_RACINE` | `meshcore` | `texte` | no | | SOURCE `config.js:149` |
| `MESHCORE_IATA` | `LPY` | `texte`, uppercased | no | UI accepts `[A-Z0-9]{2,8}`. | SOURCE `config.js:151,226` |
| `MESHCORE_REPUBLIER` | `oui` | see 2.2 | no | When a MeshCore companion radio is attached, its packets are **published to the input broker**. | SOURCE `config.js:152`, `meshcore/mqtt.js:40-51` |
| `MESHCORE_CANAUX` | `Public` | `;` or newline list | **yes** if it contains secrets | | SOURCE `config.js:154` |
| `DEPARTEMENT` | `43` | `texte`; world codes uppercased | no | Map area. French department number, or a 1° square such as `MN40W075`. With the default, the app downloads French IGN terrain at start. | SOURCE `config.js:183-193`; EMPIRICAL |
| `ZONE_NOM`, `ZONE_BBOX`, `CARTE_CENTRE_LAT`, `CARTE_CENTRE_LON`, `CARTE_ZOOM`, `CARTE_TITRE` | Haute-Loire values | `texte` / `nombre` | no | Derived from `DEPARTEMENT` when it is a world code and these are unset. | SOURCE `config.js:89-92,133-137,185-192` |
| `RADIO_FREQ_MHZ` | `869.525` | `Number(env) \|\| 869.525` (raw, three sites) | no | Frequency for coverage computations. | SOURCE `server.js:271`, `relief.js:14`, `analyse.js:261` |
| `RESEAU_PRESET` | `LONG_FAST` | `texte` | no | | SOURCE `config.js:144` |
| `EXPORT_JETON` | empty | `texte` (alias caveat) | **yes** | If set, export endpoints and `/metrics` require it. UI-overridable. | SOURCE `config.js:75`, `exports.js:7-12` |
| `INSCRIPTIONS` | `validation` | `texte` | no | `fermees`, `validation` or `ouvertes`. Controls public self-registration. | SOURCE `config.js:194`, `server.js:1954-1966` |
| `PRECISION_PUBLIQUE_DECIMALES` | `3` | `nombre` | no | Rounding of positions shown to anonymous visitors. | SOURCE `config.js:73` |
| `RETENTION_JOURS`, `MESSAGES_RETENTION_JOURS` | `7`, `90` | `nombre` | no | Database retention. | SOURCE `config.js:65,67` |
| `DOMOTIQUE_MQTT_URL` | empty | raw, trimmed | may embed credentials | Empty disables the whole home-automation output. UI-overridable. | SOURCE `domotique.js:16,32` |
| `DOMOTIQUE_MQTT_UTILISATEUR` | empty | raw, trimmed | no | | SOURCE `domotique.js:17` |
| `DOMOTIQUE_MQTT_MOT_DE_PASSE` | empty | raw, **not** trimmed, no alias | **yes** | | SOURCE `domotique.js:18` |
| `DOMOTIQUE_RACINE` | `carte-live` | raw, trimmed, leading and trailing `/` stripped | no | Root of state topics and source of every discovery identifier. | SOURCE `domotique.js:19,34` |
| `DOMOTIQUE_DECOUVERTE` | true | see 2.2 | no | | SOURCE `domotique.js:20` |
| `DOMOTIQUE_PREFIXE_DECOUVERTE` | `homeassistant` | raw, trimmed | no | Discovery prefix. **Not** in the UI catalogue and not documented upstream. | SOURCE `domotique.js:21` |
| `DOMOTIQUE_ENVOI_LORA` | false | see 2.2 | no | Enables MQTT-to-LoRa. | SOURCE `domotique.js:22` |
| `DOMOTIQUE_CANAL_ENVOI` | `0` | `Number`, clamped 0..7 | no | Default Meshtastic channel index for MQTT-to-LoRa. | SOURCE `domotique.js:23` |
| `VERIFIER_MAJ` | enabled | see 2.2 | no | Disables the hourly GitHub release check. Undocumented upstream. | SOURCE `server.js:238-251` |
| `DEPOT_GITHUB` | `sauveteur71/live-mesh-map-world` | raw | no | Repository queried by the release check. | SOURCE `server.js:235` |
| `MAJ_URL`, `MAJ_JETON` | `http://maj:4405`, empty | raw | `MAJ_JETON` **yes** | Updater service address and token. Leave unset. | SOURCE `server.js:3609-3613` |
| `MDNS_MESHTASTIC` | enabled | see 2.2 | no | Periodic mDNS query on the local network. | SOURCE `server.js:1178-1181` |
| `UDP_MESHTASTIC` | disabled | see 2.2 | no | UDP multicast listener on port 4403; needs host networking. | SOURCE `server.js:3249`, `udp-meshtastic.js:6,12-13` |
| `RADIO_HOTE`, `RADIO_PORT` | empty, `4403` | `texte`, `nombre` | no | Meshtastic node over TCP. | SOURCE `config.js:110-111` |
| `FONCTIONS_MASQUEES` | empty | list | no | Hides features; later overridden by `/data/fonctions-masquees.json`. | SOURCE `server.js:3831-3834` |
| `AGENTS_ADRESSES` | empty | comma list | no | Extra addresses embedded in downloadable pre-configured agents. | SOURCE `server.js:954` |
| `COPERNICUS_URL` | AWS open-data bucket | raw | no | Terrain mirror. | SOURCE `monde.js:40` |
| `POSTGRES_URL` | empty | raw | **yes** | Optional archive. | SOURCE `postgres.js:50` |
| `CLE_EQUIPES` | empty | raw | **yes** | Team key material; otherwise stored in `/data/cle-equipes.bin`. | SOURCE `equipes.js:26,34` |

File names above are under `carte-live/src/` unless a directory is given.

Other optional groups, all in the UI catalogue (SOURCE
`carte-live/src/variables.js:12-102`): map display (`CARTE_FOND`,
`CARTE_RESEAUX`, `CARTE_COUCHES_MASQUEES`, `CARTE_TUILES_*`,
`URL_CLIENT_MESHTASTIC`, `URL_FLASHER`), alert thresholds (`SEUIL_*`,
`NOEUDS_SURVEILLES`, `LIEN_DISTANCE_MAX_KM`), `LORAWAN_*`, `RIVIERES_*`,
`APRS_*`, `MESHMONITOR_*`, `SMTP_*` and `CARTE_ADRESSE`, `LSASAF_*`,
`METEOALARM_URL`, `RELIEF_FRANCE_URL`, traceroute tuning. Secrets among them:
`LORAWAN_MOT_DE_PASSE`, `MESHMONITOR_JETON`, `LSASAF_MOT_DE_PASSE`,
`SMTP_MOT_DE_PASSE`.

Build and test hooks, not for production: `PROTOBUFS_DIR`
(`decodeur.js:10`), `PMTILES_BIN`, `PROTOMAPS_BUILDS`, `PROTOMAPS_BASE`
(`fonds.js:13-14,28`). Updater-only: `DOCKER_SOCKET`, `MAJ_PORT`,
`MAJ_SERVICE` (`majeur.js:19-21`).

## 4. Things that do not exist

Checked by listing every `process.env` read under `carte-live/src` (SOURCE).

| Wanted | Result |
| --- | --- |
| Base URL, path prefix or sub-path setting | None. See [ingress-audit.md](ingress-audit.md). |
| Log level or verbosity setting | None. Only `LANGUE`. All logging is `console.log` / `console.error` with an ISO timestamp. |
| A switch to disable or loopback-bind the agent listener | None. Only `AGENTS_PORT`. |
| A bind address for the web server | None. |
| A switch to hide the updater UI | None. `VERIFIER_MAJ=non` stops the version check and so hides the "new version" hint. |
| Trusted-header, SSO or no-authentication mode | None. |
| `AGENTS_PORT_HOTE`, `CARTE_PORT`, `CLIENT_PORT`, `FLASHER_PORT`, `POSTGRES_MOT_DE_PASSE` | Docker Compose interpolation only; the application never reads them (SOURCE `docker-compose.yml:16,19`). |

## 5. Defaults that are wrong for a non-French deployment

If the App passes no value, upstream assumes Haute-Loire, France:
`DEPARTEMENT=43`, `ZONE_NOM=Haute-Loire`, `MQTT_RACINE=msh/EU_868`,
`RADIO_FREQ_MHZ=869.525`, `MESHCORE_IATA=LPY`, `TZ=Europe/Paris`, and
French-only features (`vigipirate`, `fr-alert`, `bipper`) visible. With these
defaults the pinned image started downloading French IGN terrain within
5 seconds of start (EMPIRICAL). `.env.exemple` shows the values upstream
recommends for the world edition (SOURCE `.env.exemple:16-22,36-39,53-56,99,108`).
