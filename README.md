<p align="center">
  <img src="assets/wordmark.png" alt="Live Mesh Map for Home Assistant" width="450">
</p>

# Live Mesh Map

Live Mesh Map is a Home Assistant add-on that runs [Live Mesh Map World](https://github.com/sauveteur71/live-mesh-map-world), a live map for Meshtastic and MeshCore networks. It shows nodes and links in real time in the Home Assistant sidebar and publishes the network state as Home Assistant entities through MQTT discovery.

## Features

* Live map of Meshtastic and MeshCore nodes, links, coverage and alerts.
* Opens through Home Assistant Ingress/sidebar, with direct web access on port `8095` when exposed.
* Publishes sensors for active nodes, gateways online, packet rate, channel utilisation and active alerts, plus one device per monitored node, through MQTT discovery.
* Uses the MQTT broker provided by Home Assistant, or a broker you configure.
* Stores its database, accounts and settings in the add-on data folder, included in Home Assistant backups.
* Accepts remote agents on port `4404` when exposed.
* `make update` moves the add-on to the latest Live Mesh Map World release.

## Requirements

* Home Assistant OS or a Supervised installation, on amd64 or aarch64.
* An MQTT broker that receives your mesh traffic.
* For entities in Home Assistant: the MQTT integration and a broker such as the Mosquitto broker add-on.

## MQTT requirement

Live Mesh Map does not receive radio traffic directly. It reads Meshtastic and MeshCore packets from an MQTT broker.

Configure a Meshtastic node to publish to an MQTT broker (Meshtastic app: **Module configuration > MQTT**), then give Live Mesh Map the same broker and root topic. For the Mosquitto broker add-on of the same Home Assistant:

```text
mesh_mqtt_url: mqtt://core-mosquitto:1883
mesh_mqtt_root_topic: msh/US
```

The `mesh_mqtt_root_topic` option must match the root topic of the node's region.

## Install

1. Add this repository to the Home Assistant Add-on Store:

   <a href="https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fgenepool99%2Fhameshmap" target="_blank" rel="noreferrer noopener">
     <img src="https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg" alt="Open your Home Assistant instance and add the Live Mesh Map add-on repository.">
   </a>

   ```text
   https://github.com/genepool99/hameshmap
   ```

2. Install **Live Mesh Map**. Home Assistant builds the image on your machine, which takes a few minutes.
3. Configure the add-on options if needed.
4. Start the add-on.
5. Open Live Mesh Map from the Home Assistant sidebar or click **Open Web UI** on the add-on page.
6. Create the map's administrator account. The setup code it asks for is in the add-on log, on the line starting with `Setup:`.
7. Finish the wizard: map area, mesh MQTT broker, channels.

## Configuration

All options can be left empty. Settings saved inside the map take precedence over these options.

| Option | Default | Description |
|---|---|---|
| `map_area` | empty | Map area: a 1° square named after its south-west corner, for example `MN40W075`, or a French department number. Empty: chosen in the wizard. |
| `map_area_name` | empty | Display name of the area. |
| `radio_frequency_mhz` | empty (`869.525`) | Frequency used for coverage computations, for example `906.875`. |
| `mesh_mqtt_url` | empty | Broker the map reads mesh traffic from: `mqtt://`, `mqtts://`, `ws://` or `wss://`. Empty: set in the wizard. |
| `mesh_mqtt_username` | empty | User name for `mesh_mqtt_url`. |
| `mesh_mqtt_password` | empty | Password for `mesh_mqtt_url`. |
| `mesh_mqtt_root_topic` | empty (`msh/EU_868`) | Topic prefix of the Meshtastic region, for example `msh/US`. |
| `meshcore_enabled` | `true` | Shows the MeshCore network. |
| `meshcore_iata` | empty | MeshCore area code, for example `PHL`. |
| `ha_mqtt_enabled` | `true` | Publishes the network state for Home Assistant. |
| `ha_mqtt_discovery` | `true` | Publishes MQTT discovery so Home Assistant creates the entities. |

### Advanced tuning

These options are safe to leave at their defaults for most installs.

| Option | Default | Description |
|---|---|---|
| `ha_mqtt_url` | empty | Broker for the Home Assistant output. Empty: the broker provided by Home Assistant. |
| `ha_mqtt_username` | empty | User name for `ha_mqtt_url`. |
| `ha_mqtt_password` | empty | Password for `ha_mqtt_url`. |
| `ha_mqtt_root_topic` | `live-mesh-map` | Prefix of the published topics. |
| `ha_mqtt_lora_send` | `false` | Transmits over LoRa every message published to `<root topic>/envoyer`. |
| `export_token` | empty | Token required by the map's exports (GeoJSON, GPX, Prometheus). |
| `setup_code` | empty | Code for creating the first administrator account. Empty: a code is written to the log. |
| `log_language` | `en` | Language of the log and of alerts: `en` or `fr`. |

## Usage

* Open the map from the Home Assistant sidebar or **Open Web UI**.
* Sign in with the map's own account to administer it. Home Assistant users are not signed in automatically.
* Entities appear under the MQTT integration in Home Assistant once the add-on is connected to the broker.
* Update the add-on from Home Assistant. The map's own "update" button does nothing.

### Ports

No port is open by default. Give a port a host port in the add-on **Network** section, then restart the add-on.

| Port | Description |
|---|---|
| `8095` | The map without Home Assistant, at `http://<home-assistant-address>:<port>`. Create the administrator account or set `setup_code` before opening it. |
| `4404` | Remote agents, which connect a radio node attached to another computer. Do not forward this port from the internet. |

## Updating Live Mesh Map World

The upstream version is pinned in `live-mesh-map/Dockerfile`. To move to the latest release, run in a clone of this repository:

```sh
make update
```

It writes the new version and image digest to the Dockerfile, increases the add-on version, adds a changelog entry, builds the image and runs the tests. It changes nothing when the pinned version is already the latest. After the changed files are pushed, Home Assistant offers the new add-on version, and installs it by itself when **Auto update** is on.

## Data Locations

| Path | Purpose |
|---|---|
| `/data/carte-live.db` | SQLite database. |
| `/data/reglages.json` | Settings saved inside the map. |
| `/data/options.json` | Add-on options written by Home Assistant. |
| `/data/` | Accounts, session key and terrain cache. |

## Troubleshooting

**Add-on stops right after starting**
Check the add-on log. Lines starting with `[lmm] ERROR` name the option to fix.

**"Live Mesh Map is starting or restarting"**
The map restarts after some settings changes. Reload after a few seconds.

**No entities in Home Assistant**
Check the log line `Home Assistant MQTT output: ...`. Confirm the MQTT integration is set up and `ha_mqtt_discovery` is on.

**Setup code refused**
The code changes when the add-on data is deleted. Use the newest one in the log.

**Port 8095 or 4404 does not respond**
Set a host port in the **Network** section, then restart the add-on.

**Update not appearing**
Reload the Home Assistant Add-on Store, then check for add-on updates again.

## Development

```sh
make test          # unit tests (Node.js 22 or newer)
make build         # builds the image local/live-mesh-map:dev
make test-ingress  # browser tests below an Ingress-style path prefix (docker)
```

## License

GPL-3.0. See [LICENSE](LICENSE). Live Mesh Map World is copyright its authors and licensed under GPL-3.0; [live-mesh-map/NOTICE.md](live-mesh-map/NOTICE.md) lists the changes this add-on makes to it.
