# Upstream MQTT behaviour

Pinned: `v1.5.14`, commit `07bc1a7`. Labels are defined in
[README.md](README.md). File names are under `carte-live/src/` unless a
directory is given.

EMPIRICAL results in this document come from the pinned image connected to a
local Mosquitto 2 broker on an isolated Docker network, with one synthetic
Meshtastic node (`!0a0b0c0d`, role `ROUTER`, fake position and telemetry)
published as protobuf `ServiceEnvelope` messages. A subscriber on `#` with
MQTT 5 "retain as published" recorded topic, payload and retain flag.

## 1. Input side

### 1.1 Connections

| Property | Value | Evidence |
| --- | --- | --- |
| Library | `mqtt` (MQTT.js) 5.x | SOURCE `carte-live/package.json:21` |
| Primary broker | `MQTT_URL`, with `MQTT_UTILISATEUR` / `MQTT_MOT_DE_PASSE` | SOURCE `server.js:3078-3080` |
| Schemes | `mqtt://`, `mqtts://`, `ws://`, `wss://` | SOURCE `server.js:2197,2396` |
| Client id | `carte-live-` + 6 random hex characters, new at every start | SOURCE `server.js:3081` |
| Session | MQTT.js defaults (clean session); nothing is persisted across restarts | SOURCE (no option set) |
| Reconnect | every 5 s, forever; each failure logs `MQTT error: …` | SOURCE `server.js:3082,3127`; EMPIRICAL (one log line every 5 s with no broker) |
| TLS | Server certificate verified unless `MQTT_TLS_NON_VERIFIE` is true. No option for a custom CA file or a client certificate. | SOURCE `server.js:3083-3084` |
| QoS | 0 for all subscriptions | SOURCE `server.js:3122` |
| Extra brokers | up to 5 from `MQTT_BROKERS_SUPPLEMENTAIRES` or the UI; credentials only inside the URL; reconnect every 10 s; duplicate packets seen within 2 min are dropped | SOURCE `config.js:60`, `server.js:3129-3149,3151` |
| Unset or empty `MQTT_URL` | Falls back to `mqtt://localhost:1883`; the input client cannot be turned off | SOURCE `config.js:50`; EMPIRICAL |

### 1.2 Subscriptions

On every (re)connect the app subscribes to (SOURCE `server.js:3086,3119-3124`;
EMPIRICAL log line `subscribed to msh/US/#`):

1. `<MQTT_RACINE>/#`
2. each entry of `MQTT_SUJETS_SUPPLEMENTAIRES`
3. `<MESHCORE_RACINE>/#` when MeshCore is enabled

A root entered with a trailing `/` or `/#` is cleaned (SOURCE `config.js:4`).

### 1.3 Meshtastic format

- The topic must contain `…/2/<type>/…`. Types `e` and `map` are decoded as
  protobuf `ServiceEnvelope`; `stat` is read as a gateway status string;
  `json` and `c` are ignored (SOURCE `decodeur.js:311-323`).
- Packets already decoded by the gateway are used as is; encrypted packets
  are decrypted with the keys from `CANAUX` (SOURCE `decodeur.js:367-372`,
  `config.js:62`).
- EMPIRICAL: three synthetic envelopes (node info, position, telemetry) on
  `msh/US/2/e/LongFast/!0a0b0c0e` produced a node with name, role, position,
  battery and voltage.

### 1.4 MeshCore format

Topics `<root>/<IATA>/<64-hex public key>/(packets|status|internal)` with
JSON payloads in the `meshcoretomqtt` format. Only `direction: rx` packets
with a hex `raw` field are used. Observers outside the configured perimeter
are dropped (SOURCE `meshcore/mqtt.js:2-4,10-31`, `server.js:3089-3098`). Not
exercised empirically.

### 1.5 The app also publishes to the input broker

When `MESHCORE_REPUBLIER` is true (default) **and** a MeshCore companion
radio is attached, a second client (`carte-live-mc-<hex>`) publishes that
radio's packets to `<MESHCORE_RACINE>/<MESHCORE_IATA>/<key>/packets` and a
retained status with a last-will `offline` on `…/status` (SOURCE
`meshcore/mqtt.js:32-55`). Without a companion radio nothing is published.
If the input broker is a public one, this is outbound radio data. Not
exercised empirically.

## 2. Home-automation output (`domotique.js`)

### 2.1 Connection

| Property | Value | Evidence |
| --- | --- | --- |
| Enabled when | `DOMOTIQUE_MQTT_URL` is non-empty. Otherwise the module does nothing at all. | SOURCE `domotique.js:31-32` |
| Independence | A separate client and connection from the input side. It may point to the same broker or a different one. | SOURCE `domotique.js:134-138`, `server.js:4209` |
| Credentials | `DOMOTIQUE_MQTT_UTILISATEUR`, `DOMOTIQUE_MQTT_MOT_DE_PASSE` | SOURCE `domotique.js:135` |
| Client id | `<uid>-domotique-<6 random hex>` | SOURCE `domotique.js:136` |
| Reconnect | every 10 s | SOURCE `domotique.js:136` |
| TLS | MQTT.js defaults. `MQTT_TLS_NON_VERIFIE` is **not** applied here; a self-signed home broker over `mqtts://` cannot be accepted. | SOURCE `domotique.js:134-138` |
| Last will | topic `<root>/disponibilite`, payload `offline`, retained, QoS 0 | SOURCE `domotique.js:35,137` |
| On connect | publishes `online` (retained) to `<root>/disponibilite`, subscribes to `<root>/envoyer`, clears its de-duplication caches, runs one cycle | SOURCE `domotique.js:139-146` |
| Settings read | once at process start; a change needs a restart | SOURCE `domotique.js:29`, `server.js:4209` |
| Log | `[Domotique] connected to <url without credentials> (topics <root>/…)` | SOURCE `domotique.js:144`; EMPIRICAL |

`<root>` is `DOMOTIQUE_RACINE` (default `carte-live`). `<uid>` is `<root>`
lowercased with every run of characters outside `[a-z0-9_-]` replaced by `_`
and leading or trailing `_` removed (SOURCE `domotique.js:27,34`). With the
default root, `<uid>` is `carte-live`.

### 2.2 State topics

All QoS 0. A retained payload is re-published only when its text changes
(SOURCE `domotique.js:41-48`).

| Topic | Retained | Cadence | Payload | Evidence |
| --- | --- | --- | --- | --- |
| `<root>/disponibilite` | yes | on connect; last will on unclean disconnect | `online` / `offline` | SOURCE `domotique.js:137,142`; EMPIRICAL |
| `<root>/etat` | yes | every 60 s in practice (it contains a timestamp, so it always changes) | JSON summary, see below | SOURCE `domotique.js:10,96,150`; EMPIRICAL |
| `<root>/alertes` | yes | on change | `{"nombre","critiques","liste":[{type,niveau,nom,message,depuis}]}`, at most 50 alerts | SOURCE `domotique.js:97-98`; EMPIRICAL |
| `<root>/alerte` | **no** | once per new alert, not during the first 90 s after connect | `{type,niveau,nom,message,heure}` | SOURCE `domotique.js:99-106` |
| `<root>/noeud/<node>` | yes | on change, checked every 60 s | `{id,nom,reseau,role,enLigne,vu,batterie,tension,lat,lon}` | SOURCE `domotique.js:108-113`; EMPIRICAL |
| `<root>/envoyer/resultat` | no | reply to a command | `{ok,id?}` or `{ok:false,erreur}` plus `heure` | SOURCE `domotique.js:120`; EMPIRICAL |

`<root>/etat` as observed (EMPIRICAL): `heure`, `noeudsActifs`,
`passerellesEnLigne`, `paquetsMinute`, `canalMoyen`, `canalMax`,
`couverturePct`, `alertes`, `alertesCritiques`, `meshcoreActifs`,
`carte{niveau,processeurPct,memoireMo,mqttConnecte}`, and `relais{<node name>:
{emission,canal,emission24h,tension,joursSansSoleil,etatBatterie}}`.

`<node>` is the Meshtastic id without `!` (for example `0a0b0c0d`) or, for
MeshCore, `mc-` plus the first 12 hex characters of the public key, passed
through the same sanitiser as `<uid>` (SOURCE `domotique.js:83,85`,
`server.js:4217,4221`).

Which nodes: Meshtastic nodes with an infrastructure role (`ROUTER`,
`ROUTER_LATE`, `REPEATER`, `ROUTER_CLIENT`, `CLIENT_BASE`), nodes seen as MQTT
gateways, and nodes listed in `NOEUDS_SURVEILLES`; plus watched MeshCore
repeaters. At most 300 (SOURCE `reseau.js:6,39-43`, `server.js:4213-4225`).
EMPIRICAL: the synthetic router and the synthetic gateway `!0a0b0c0e` both
appeared.

Positions of these nodes are published at full precision; the public
rounding does not apply to watched nodes (SOURCE `reseau.js:246-247`,
`server.js:4217`). Node names, positions and alert text are user data on the
home-automation broker.

### 2.3 Discovery

Published only when `DOMOTIQUE_DECOUVERTE` is true. Topic form (SOURCE
`domotique.js:51-57`):

```text
<prefix>/<component>/<uid>/<object>/config
```

`<prefix>` is `DOMOTIQUE_PREFIXE_DECOUVERTE` (default `homeassistant`). Each
config is published retained, QoS 0, once per connection, and again after
every reconnect. Every payload contains
`availability_topic: <root>/disponibilite`.

Map-level device (SOURCE `domotique.js:50,59-80`; EMPIRICAL, payloads
captured):

```json
{"identifiers":["<uid>_carte"],"name":"Carte live",
 "manufacturer":"carte-live-meshtastic","model":"Carte live","sw_version":"1.5.14"}
```

| Component | `<object>` | `unique_id` | Name (French, fixed) | Notes |
| --- | --- | --- | --- | --- |
| `sensor` | `noeuds_actifs` | `<uid>_noeuds_actifs` | Nœuds actifs | `state_class: measurement` |
| `sensor` | `passerelles` | `<uid>_passerelles` | Passerelles en ligne | |
| `sensor` | `paquets_minute` | `<uid>_paquets_minute` | Paquets par minute | unit `paquets/min` |
| `sensor` | `canal_moyen` | `<uid>_canal_moyen` | Occupation du canal | unit `%` |
| `sensor` | `couverture` | `<uid>_couverture` | Couverture calculée | unit `%` |
| `sensor` | `alertes` | `<uid>_alertes` | Alertes actives | `json_attributes_topic: <root>/alertes` |
| `sensor` | `meshcore_actifs` | `<uid>_meshcore_actifs` | Nœuds MeshCore actifs | published even when MeshCore is disabled (value `null`) |
| `binary_sensor` | `alerte_critique` | `<uid>_alerte_critique` | Alerte critique | `device_class: problem` |
| `text` | `message_lora` | `<uid>_message_lora` | Message LoRa | only when `DOMOTIQUE_ENVOI_LORA` is true; `command_topic: <root>/envoyer`, `max: 200` |

All map-level entities read `<root>/etat` through a `value_template`, and set
`object_id` equal to `unique_id`.

Per watched node, device (SOURCE `domotique.js:82-91`; EMPIRICAL):

```json
{"identifiers":["<uid>_noeud_<node>"],"name":"<node name>","model":"<role or network>",
 "manufacturer":"Meshtastic" | "MeshCore","via_device":"<uid>_carte"}
```

| Component | `<object>` | `unique_id` | Condition |
| --- | --- | --- | --- |
| `binary_sensor` | `noeud_<node>_en_ligne` | `<uid>_noeud_<node>_en_ligne` | always; `device_class: connectivity`; node JSON as attributes |
| `sensor` | `noeud_<node>_vu` | `<uid>_noeud_<node>_vu` | always; `device_class: timestamp` |
| `sensor` | `noeud_<node>_batterie` | `<uid>_noeud_<node>_batterie` | when a battery level is known |
| `sensor` | `noeud_<node>_tension` | `<uid>_noeud_<node>_tension` | when a voltage is known |
| `device_tracker` | `noeud_<node>` | `<uid>_noeud_<node>_position` | when a position is known; attributes template only, **no `state_topic`** |

Per-node entities do not set `object_id`.

Observations that matter to the App:

- **Identifier stability.** Every identifier derives only from
  `DOMOTIQUE_RACINE` and the node's own id. Nothing is random or
  time-dependent, so identifiers survive restarts, upgrades and database
  loss (SOURCE `domotique.js:27,34,50,61,83-84`). Changing
  `DOMOTIQUE_RACINE` changes every `unique_id` and creates duplicate devices.
- **Two installs with the same root collide** on the same broker (same
  topics, same `unique_id`s). There is no per-install component.
- **Device name is always `Carte live`.** The code passes `config.titre`,
  which does not exist (the title is `config.carte.titre`), so the fallback is
  always used (SOURCE `server.js:4210`, `config.js:89`; EMPIRICAL).
- **Entity names are French and fixed**; `LANGUE` does not change them
  (SOURCE `domotique.js:63-90`; EMPIRICAL with `LANGUE=en`).
- **`object_id` in discovery payloads.** Whether the Home Assistant version in
  use still honours, ignores or warns about this key was not checked
  (UNVERIFIED).
- **Discovery topic node id contains a hyphen** with the default root
  (`homeassistant/sensor/carte-live/…`). Accepted by Home Assistant's topic
  grammar as far as is known (UNVERIFIED).
- **No configs are ever removed.** The code never publishes an empty retained
  payload. Disabling discovery, changing the root, a node no longer being
  watched, or uninstalling all leave the old retained configs (and retained
  `…/noeud/…` states) on the broker (SOURCE `domotique.js`, whole file;
  EMPIRICAL: after restarting with `DOMOTIQUE_DECOUVERTE=non`, all 15 retained
  config topics were still on the broker). Home Assistant will keep the
  entities; they show as unavailable only while `disponibilite` is `offline`.
- **Entities appear lazily.** Battery, voltage and tracker configs are
  published only once the value exists.

### 2.4 Shutdown and availability

On `SIGTERM` the process closes the input client and the database and exits;
it does **not** call the home-automation module's stop function (SOURCE
`server.js:4290-4297`, `domotique.js:156`). The broker then publishes the
last will. EMPIRICAL: after `docker stop`, a retained
`<root>/disponibilite offline` appeared within one second.

## 3. MQTT-to-LoRa command interface

| Property | Value | Evidence |
| --- | --- | --- |
| Topic | `<root>/envoyer` (always subscribed when the output is enabled) | SOURCE `domotique.js:118,143` |
| Gate | `DOMOTIQUE_ENVOI_LORA` must be true, otherwise the reply is `{"ok":false,"erreur":"Envoi LoRa depuis la domotique désactivé (DOMOTIQUE_ENVOI_LORA)"}` | SOURCE `domotique.js:121`; EMPIRICAL |
| Payload | plain text, or JSON `{"texte":…,"canal":<0-7>,"vers":"!id"}` if it starts with `{` | SOURCE `domotique.js:123-127` |
| Default channel | `DOMOTIQUE_CANAL_ENVOI` | SOURCE `domotique.js:23,127` |
| Rate limit | one accepted message per 20 s, in memory | SOURCE `domotique.js:11,122,128` |
| Size limit | 200 bytes UTF-8 | SOURCE `administration.js:1223-1225` |
| Needs | a connected Meshtastic radio; otherwise `Module radio non connecté` | SOURCE `administration.js:1221`; EMPIRICAL (with the gate open and no radio) |
| Reply | `<root>/envoyer/resultat`, not retained | SOURCE `domotique.js:120` |
| Authentication | **none in the application.** Anyone who can publish to `<root>/envoyer` on that broker can transmit. Protection is the broker's own accounts and ACLs. | SOURCE `domotique.js:117-132` |
| Audit | sender recorded as `domotique` | SOURCE `server.js:4227` |
| Discovery | the `text` entity is advertised only when the gate is open; if the gate is later closed, its retained config is not removed | SOURCE `domotique.js:74-79` |

Because the setting is in the UI catalogue, a web-UI administrator can open
this gate regardless of the App's environment (see
[configuration.md](configuration.md) section 1).

## 4. Upstream documentation

`wiki/en/Domotique-et-supervision.md:5-45` describes the same topics and the
same entity list. It states "Nothing is published again until something
changes", which is true except for `<root>/etat` (see 2.2).
