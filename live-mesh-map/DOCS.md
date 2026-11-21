# Live Mesh Map

## First start

1. Start the App and select **Open Web UI**.
2. The map asks you to create its administrator account and for a setup code.
   The code is on the **Log** tab, on the line starting with `Setup:`. To
   choose the code yourself, set the `setup_code` option before the first
   start.
3. Finish the wizard: map area, mesh MQTT broker, channels.

The map has its own accounts. Home Assistant users are not signed in to the
map automatically.

## Options

Options are read when the App starts. Settings saved inside the map (its
Settings screens) take precedence over these options; the log lists the
options that are replaced this way.

| Option | Default | Meaning |
| --- | --- | --- |
| `map_area` | empty | Map area: a 1° square named after its south-west corner, for example `MN40W075` for 40-41°N, 75-74°W (`MS` for south, `E` for east), or a French department number. Empty: chosen in the wizard. |
| `map_area_name` | empty | Display name of the area. |
| `radio_frequency_mhz` | empty (869.525) | Frequency used for coverage computations, for example `906.875`. |
| `log_language` | `en` | Language of the log and of alerts: `en` or `fr`. |
| `mesh_mqtt_url` | empty | Broker the map reads mesh traffic from: `mqtt://`, `mqtts://`, `ws://` or `wss://`, without user name or password in the address. Empty: set in the wizard. |
| `mesh_mqtt_username`, `mesh_mqtt_password` | empty | Credentials for that broker. |
| `mesh_mqtt_root_topic` | empty (`msh/EU_868`) | Topic prefix of the Meshtastic region, for example `msh/US`. |
| `meshcore_enabled` | `true` | Shows the MeshCore network. |
| `meshcore_iata` | empty | MeshCore area code, for example `PHL`. |
| `ha_mqtt_enabled` | `true` | Publishes the network state for Home Assistant. |
| `ha_mqtt_url` | empty | Broker for that output. Empty: the broker provided by Home Assistant. |
| `ha_mqtt_username`, `ha_mqtt_password` | empty | Credentials for `ha_mqtt_url`. |
| `ha_mqtt_discovery` | `true` | Publishes MQTT discovery so Home Assistant creates the entities. |
| `ha_mqtt_root_topic` | `live-mesh-map` | Prefix of the published topics. |
| `ha_mqtt_lora_send` | `false` | Transmits over LoRa every message published to `<root topic>/envoyer`. |
| `export_token` | empty | Token required by the map's exports (GeoJSON, GPX, Prometheus). |
| `setup_code` | empty | Code for creating the first administrator account. |

With an invalid option the App stops at start and the log names the option.
Passwords and tokens are not written to the log.

## MQTT

The map uses two MQTT connections, which can point at the same broker.

**Mesh input** (`mesh_mqtt_*`): where the map reads Meshtastic and MeshCore
packets. For the Mosquitto broker App of this Home Assistant, use
`mqtt://core-mosquitto:1883` with a Mosquitto user.

**Home Assistant output** (`ha_mqtt_*`): the broker is chosen in this order.

1. `ha_mqtt_enabled` is off: nothing is published.
2. `ha_mqtt_url` is set: that broker is used.
3. Otherwise: the MQTT broker provided by Home Assistant (for example the
   Mosquitto broker App).
4. No broker available: nothing is published, and the log says so.

With discovery on, the MQTT integration of Home Assistant creates sensors
(active nodes, gateways online, packets per minute, channel utilisation,
active alerts) and one device per monitored node. Entity names are in French.

Certificates of `mqtts://` and `wss://` brokers are always verified. Brokers
with a self-signed certificate cannot be used over TLS.

## Ports

No port is open by default. To open one, give it a host port in the App's
**Network** section and restart the App.

| Port | Use |
| --- | --- |
| `8095` | The map without Home Assistant, at `http://<home-assistant-address>:<port>`. Create the administrator account or set `setup_code` before opening this port: on a new installation, visitors from the local network can otherwise create the administrator account without a code. |
| `4404` | Remote agents, which connect a radio node attached to another computer. Agents use the code shown in the map under Network > Radio nodes. Do not forward this port from the internet. |

Radio nodes connected by USB to the Home Assistant machine are not available
to the App. Use an agent or a node reachable over TCP.

## When opened through Home Assistant

- Offline mode and "install as an app" are not available.
- Addresses the map shows for sharing (public page, join page, QR code, export
  URLs, password-reset links) contain the Home Assistant path and work only
  for users signed in to Home Assistant. Open port `8095` for links meant for
  other people or programs.
- The map's own "update" button does nothing. Update the App from Home
  Assistant.

## Data and backups

The database, accounts, settings and terrain cache are in the App's data
folder and are included in Home Assistant backups. The App is stopped while a
backup is taken. Uninstalling the App deletes its data.

## Troubleshooting

- **The App stops right after starting**: lines starting with `[lmm] ERROR` in
  the log name the option to fix.
- **"Live Mesh Map is starting or restarting"**: the map restarts after some
  settings changes. Reload after a few seconds.
- **No entities in Home Assistant**: check the log line
  `Home Assistant MQTT output: ...`. The MQTT integration must be set up in
  Home Assistant and `ha_mqtt_discovery` must be on.
- **Setup code refused**: the code changes when the App's data is deleted. Use
  the newest one in the log.
- **Port 8095 or 4404 does not respond**: set a host port in the Network
  section and restart the App.

Upstream documentation: <https://github.com/sauveteur71/live-mesh-map-world/wiki>.
