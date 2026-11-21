# Upstream licensing

Pinned: `v1.5.14`, commit `07bc1a7`. Labels are defined in
[README.md](README.md). Paths are relative to the upstream repository root.

This is a factual inventory plus the obligations that normally follow from
it. It is **not legal advice**. Statements about what the GPL requires are a
reading of the licence text and are marked UNVERIFIED where they are
interpretation.

## 1. Upstream's own licence

| Fact | Evidence |
| --- | --- |
| The repository ships the GNU GPL version 3 text | SOURCE `LICENSE:1-2` |
| The Node package declares `GPL-3.0-only` | SOURCE `carte-live/package.json:10` |
| The README says "GPL-3.0. Created by **F4GLD**" | SOURCE `README.md:53` |
| The image label says `org.opencontainers.image.licenses=GPL-3.0` | EMPIRICAL |
| Source files carry no licence header and no "or any later version" statement. Treat the work as GPL-3.0-only. | SOURCE (search of `carte-live/src`, `carte-live/public`, `agent`) |
| No explicit copyright line with year and holder was found outside the README credit. | SOURCE (same search) |
| There is no `NOTICE`, `CREDITS`, `CONTRIBUTING` or CLA file. | SOURCE (repository root) |
| The published image does **not** contain upstream's `LICENSE` file. The only licence text in `/app` is `/app/protobufs/LICENSE` (also GPL v3). | SOURCE `Dockerfile:29-38`; EMPIRICAL |

## 2. Third-party material inside upstream

### 2.1 Code

| Component | Where | Licence | Evidence |
| --- | --- | --- | --- |
| Meshtastic protobuf definitions | `carte-live/protobufs/meshtastic/*.proto` | GPL v3 (licence file alongside) | SOURCE `carte-live/protobufs/LICENSE:1-2` |
| D3 7.9.0, minified, vendored | `carte-live/public/vendor/d3-7.9.0.min.js` | ISC. The file keeps the copyright line; the ISC text itself is not vendored. | SOURCE file header; licence name from the D3 project (UNVERIFIED here) |
| Leaflet 1.9.4 | `node_modules`, served at `/vendor/leaflet` | BSD-2-Clause | SOURCE `carte-live/package-lock.json` |
| MapLibre GL 6.18.0 | `node_modules`, served at `/vendor/maplibre` | BSD-3-Clause | SOURCE `carte-live/package-lock.json` |
| Protomaps-Leaflet 5.1.0 | `node_modules`, served at `/vendor/protomaps-leaflet` | BSD-3-Clause | SOURCE `carte-live/package-lock.json` |
| Other npm dependencies (256 packages in the lock file) | `node_modules` | 197 MIT, 28 ISC, 13 BSD-3-Clause, 5 Apache-2.0, 3 BSD-2-Clause, and single cases of MIT-0, 0BSD, CC0-1.0, PSF-2.0 (`argparse`), dual licences, and `h5wasm` ("SEE LICENSE IN LICENSE.txt") | SOURCE `carte-live/package-lock.json` (licence fields counted) |
| `better-sqlite3` 11.10.0 with bundled SQLite | `node_modules` | MIT; SQLite is public domain | SOURCE lock file; SQLite status UNVERIFIED here |
| `go-pmtiles` v1.31.2 binary | `/usr/local/bin/pmtiles` | BSD-3-Clause (UNVERIFIED here) | SOURCE `Dockerfile:17-20,38` |
| Agent executables (Go), built from `agent/` | `/app/public/agent/*`, downloadable by anyone | Upstream's GPL-3.0 code, linking `go.bug.st/serial` v1.8.0 and `golang.org/x/sys` (both BSD-style, UNVERIFIED here) and the Go runtime | SOURCE `agent/go.mod`, `Dockerfile:5-14,37` |
| Base image | `node:22-bookworm-slim` | Node.js (MIT and bundled components) and Debian packages under many licences, including GPL and LGPL | SOURCE `Dockerfile:23` |

All of these are compatible with distribution under GPL-3.0 as far as the
licence names indicate (UNVERIFIED: `h5wasm`'s licence file was not read).

### 2.2 Data shipped in the repository and image

| Data | Where | Origin and terms |
| --- | --- | --- |
| French department outlines and landmarks | `carte-live/donnees-ref/*.geojson`, `reperes-43.json` | No source or licence stated in the repository. Probably French open data. **UNVERIFIED.** |
| Wiki pages and screenshots | `wiki/`, copied to `/app/wiki` | Part of the GPL-3.0 repository; screenshots show "a real network in Haute-Loire" (SOURCE `README.md:25`) |
| Logos and icons | `docs/logo/`, `carte-live/public/*.svg`, `icone-*.png` | Part of the repository; no separate licence or trademark statement |

### 2.3 Data fetched at run time (attribution duties fall on the operator)

| Data | Terms as stated by upstream | Evidence |
| --- | --- | --- |
| Copernicus DEM GLO-30 | "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA" | SOURCE `README.md:54` |
| IGN RGE ALTI | Licence Ouverte Etalab | SOURCE `README.md:54` |
| OpenStreetMap (Overpass, Photon, Protomaps) | ODbL, "© contributors" | SOURCE `README.md:54`, `carte-live/src/fonds.js:7` |
| Default base-map tiles: Esri ArcGIS Online | Attribution string built in; subject to Esri's terms of use (not reviewed, UNVERIFIED) | SOURCE `carte-live/src/config.js:100-104` |
| DB-IP country database | Free "lite" database; the DB-IP site is linked from the UI. Its licence (CC BY 4.0 with attribution, UNVERIFIED here) applies when visitor-country statistics are on (default). | SOURCE `carte-live/src/frequentation.js:53`, `carte-live/src/variables.js:91` |
| LSA SAF fire data | CC BY 4.0 | SOURCE `carte-live/src/feux.js:35` |
| NASA FIRMS, MeteoAlarm, Hub'Eau, Open-Meteo, RainViewer | Terms not stated in the repository (UNVERIFIED) | SOURCE (URLs in `carte-live/src` and `carte-live/public/app.js`) |

## 3. Trademarks and naming

- "Meshtastic® is a registered trademark of Meshtastic LLC. This project is
  not affiliated with Meshtastic LLC." (SOURCE `README.md:55`). The App should
  carry an equivalent statement and avoid the Meshtastic logo.
- MeshCore is a third-party project name; upstream makes no statement about
  it.
- "Live Mesh Map" is upstream's project name. Nothing in the repository
  claims it as a trademark. The App should present itself as an unofficial
  packaging and name the upstream author, so that users do not take support
  requests about the packaging to upstream.
- The upstream manifest names the app "Carte live Meshtastic · MeshCore" and
  the discovery device is named "Carte live" (SOURCE
  `carte-live/public/manifest.webmanifest:2-3`, `carte-live/src/domotique.js:50`).

## 4. What follows for this project

Interpretation of GPL-3.0; UNVERIFIED as legal conclusions.

### 4.1 The wrapper repository

- Files written for the App (manifests, start-up scripts, documentation,
  tests) are separate works as long as they contain no upstream code. They
  can carry the repository's own licence.
- Anything copied or adapted from upstream (code excerpts, translated wiki
  text, logos, screenshots) is GPL-3.0 material and must stay under GPL-3.0
  with attribution.
- A script that rewrites upstream files at build time is itself original
  code. A **patch file** containing upstream lines is a derivative of
  upstream and is GPL-3.0.
- The repository should credit upstream and its author, state the pinned
  version and commit, link to the upstream source, reproduce the Meshtastic
  trademark notice and the data attributions of section 2.3 (or link to
  them), and say clearly that it is not affiliated with upstream.

### 4.2 The container image

Two distribution models differ:

| Model | Who conveys GPL binaries | Obligations on this project |
| --- | --- | --- |
| The App is built on the user's machine from a `Dockerfile` that starts `FROM` the upstream image digest | Upstream (the user pulls upstream's image). This project distributes only build instructions. | Those of 4.1. Still state what the build changes. |
| This project publishes a prebuilt image | This project conveys upstream's object code and everything in the base image | GPL-3.0 sections 4 to 6: include the licence text; keep copyright and licence notices; if any upstream file is modified (for example the relative-URL transform), mark the image as modified with a date (section 5a) and license the modified work under GPL-3.0 (section 5c); provide the Corresponding Source for the exact version: upstream source at the pinned commit **plus** the transform and build scripts, by one of the section 6 methods (for example a durable link next to the image). Base-image components keep their own licences and source-offer duties. |

Points specific to this upstream:

- Upstream's image lacks the `LICENSE` file. A published derived image should
  add the GPL-3.0 text and a notice file rather than inherit that gap.
- The image contains downloadable agent executables served to any visitor.
  Whoever runs a public instance conveys those binaries; the source is the
  `agent/` directory at the pinned commit.
- Pinning by digest fixes the binary, but upstream's tag for a version can be
  moved. The Corresponding Source reference should be the commit
  (`07bc1a7…`), not the tag name.
- The network-use clause of the AGPL does **not** apply: this is GPL, so
  merely running a modified copy for others to use over a network creates no
  source-offer duty. Distributing the image does.

### 4.3 Suggested notice content

For `NOTICE.md` (owned by the coordinator), based on the facts above:
upstream name, URL, author credit "F4GLD" as given in upstream's README,
licence GPL-3.0-only, pinned version, commit and image digest; statement of
any modification made at build time; Meshtastic trademark disclaimer; data
attributions for Copernicus DEM, IGN, OpenStreetMap, Esri tiles, DB-IP and
LSA SAF; licences of Leaflet, MapLibre GL, Protomaps-Leaflet, D3 and the
Meshtastic protobufs.
