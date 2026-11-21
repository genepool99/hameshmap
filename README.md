# Live Mesh Map for Home Assistant

A Home Assistant App (add-on) that runs
[Live Mesh Map World](https://github.com/sauveteur71/live-mesh-map-world), a
live map for Meshtastic and MeshCore networks, inside Home Assistant.

- The map opens in the Home Assistant sidebar.
- Network state is published as Home Assistant entities through MQTT discovery.
- Data is stored in the App's data folder and included in Home Assistant backups.

Requires Home Assistant OS or a Supervised installation, on amd64 or aarch64.

## Install

1. In Home Assistant, open **Settings > Apps > App store**.
2. Open the menu (top right), select **Repositories**, and add the URL of this
   repository.
3. Find **Live Mesh Map** in the store and select **Install**. Home Assistant
   builds the image on your machine, which takes a few minutes.
4. Optional: set options on the **Configuration** tab. All options can be left
   empty.
5. Select **Start**, then **Open Web UI**.
6. The map asks you to create its administrator account and for a setup code.
   The code is on the App's **Log** tab, on the line starting with `Setup:`.
7. Finish the wizard: map area, mesh MQTT broker, channels.

To install without adding a repository, copy the `live-mesh-map` folder to the
`/addons` folder of your Home Assistant machine, then reload the App store.

Options, MQTT, ports and troubleshooting are described in
[live-mesh-map/DOCS.md](live-mesh-map/DOCS.md), which is also shown on the
App's **Documentation** tab.

## Update Live Mesh Map World

The upstream version is pinned in `live-mesh-map/Dockerfile`. To move to the
latest upstream release:

```sh
make update
```

This command:

1. Looks up the latest upstream release and the digest of its image.
2. Writes the new version and digest to `live-mesh-map/Dockerfile`.
3. Increases the App version in `live-mesh-map/config.yaml` and adds an entry
   to `live-mesh-map/CHANGELOG.md`.
4. Builds the image and runs the tests.

It does nothing when the pinned version is already the latest. After the
changed files are pushed, Home Assistant offers the new App version, and
installs it by itself if **Auto update** is on for the App.

## Development

```sh
make test          # unit tests (Node.js 22 or newer)
make build         # builds the image local/live-mesh-map:dev
make test-ingress  # browser tests below an Ingress-style path prefix (docker)
```

## Licence

[GPL-3.0](LICENSE). Live Mesh Map World is copyright its authors and licensed
under GPL-3.0; see [live-mesh-map/NOTICE.md](live-mesh-map/NOTICE.md) for the
changes this App makes to it.
