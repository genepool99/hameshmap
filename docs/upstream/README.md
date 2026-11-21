# Upstream analysis: Live Mesh Map World

Verified facts about the upstream application that this Home Assistant App
packages. Everything here describes **upstream behaviour**, not the App.

| Item | Value |
| --- | --- |
| Upstream | <https://github.com/sauveteur71/live-mesh-map-world> (GPL-3.0) |
| Pinned release | `v1.5.14` (git tag), published 2026-11-20T10:12:41Z |
| Pinned commit | `07bc1a79205a6eae1d136c1261635ca7156c90f3` |
| Image | `ghcr.io/sauveteur71/live-mesh-map-world` |
| Image tag | `1.5.14` (no `v` prefix; `v1.5.14` does not exist on GHCR) |
| Index digest | `sha256:4f2d4f0148ef6c5170b9fb86040322fda0f59f0f78ed8b113e193fd4ee77d237` |
| `linux/amd64` digest | `sha256:6c718fc012582cae8cfd48ab667746f8c10902ed32eb01cb26d08f537b41cfa4` |
| `linux/arm64` digest | `sha256:1821f5cdc4ddef204ff49bda8c0c05f842b44a75f819c396df14409e223f5310` |
| Date verified | 2026-11-20 |

## Documents

| File | Content |
| --- | --- |
| [configuration.md](configuration.md) | Environment variables, parsing rules, precedence of web-UI settings |
| [network-and-http.md](network-and-http.md) | Listening sockets, outbound connections, HTTP routes, authentication |
| [ingress-audit.md](ingress-audit.md) | URL audit and recommendation for Home Assistant Ingress |
| [mqtt.md](mqtt.md) | MQTT input, Home Assistant discovery output, MQTT-to-LoRa command |
| [persistence-and-lifecycle.md](persistence-and-lifecycle.md) | `/data` layout, process user, signals, restarts, updater, USB/serial |
| [licensing.md](licensing.md) | GPL-3.0 obligations and third-party components |
| [integration-contract.md](integration-contract.md) | The upstream behaviours the App depends on, breakage detection, risk register |

## Evidence labels

- **SOURCE**: read in the upstream tree at the pinned commit. Citations are
  `path:line` relative to the upstream repository root.
- **EMPIRICAL**: observed by running the published image at the index digest
  above (amd64 only) in throwaway local containers on 2026-11-20.
- **UNVERIFIED**: not checked, or depends on Home Assistant behaviour that is
  outside the scope of this analysis. Treat as an assumption.

## Method

- Source read from a clone at tag `v1.5.14`. Code and comments are mostly
  French; names are quoted as written.
- Releases, tags and issues read through the GitHub API; image tags and
  manifests read anonymously from the GHCR registry API.
- Runtime checks used the published image with synthetic data only: a local
  Mosquitto broker on an internal Docker network, a synthetic Meshtastic node
  published as protobuf `ServiceEnvelope` messages, an nginx container that
  strips a path prefix to imitate Ingress, and headless Chrome. No real
  broker, credentials, radio traffic or location data were used. Test ports
  were bound to `127.0.0.1`; all containers, volumes and networks were removed.
- The arm64 image was not run. Nothing was tested under a real Home Assistant
  Supervisor.

## Release and image facts

| Fact | Evidence |
| --- | --- |
| Latest release is `v1.5.14`; `carte-live/package.json` says `1.5.14`. | SOURCE `carte-live/package.json:3`; GitHub API `releases/latest` |
| Git tags are `vX.Y.Z`. Image tags are `X.Y.Z`, `X.Y`, `latest`, `main`, `sha-<7 hex>`. | SOURCE `.github/workflows/image-docker.yml:74-79,126`; GHCR tag list (74 tags) |
| `1.5.14`, `1.5`, `latest`, `main` and `sha-07bc1a7` all resolve to the same index digest today. | EMPIRICAL (registry `HEAD` per tag) |
| Version tags are created by re-tagging the `sha-<commit>` image, so `X.Y.Z` is a mutable pointer. Only the digest is immutable. | SOURCE `.github/workflows/image-docker.yml:121-126` |
| Platforms: `linux/amd64`, `linux/arm64` only. No `armv7`, `armhf` or `i386`. | SOURCE `.github/workflows/image-docker.yml:83`; EMPIRICAL (index manifest) |
| The image label `org.opencontainers.image.version` is `main`, not `1.5.14`; `org.opencontainers.image.revision` is the pinned commit. | EMPIRICAL (`docker image inspect`) |
| Each platform has an unsigned BuildKit SLSA provenance attestation manifest. There is no cosign signature tag, no OCI referrers, and no GitHub artifact attestation. | EMPIRICAL (index manifest, referrers API 404, attestations API 404) |
| Release cadence is very high: 26 releases between 2026-11-12 and 2026-11-20, 6 of them on 2026-11-19. | GitHub API `releases` |
| The repository was created on 2026-11-12. It is the English edition of `sauveteur71/carte-live-meshtastic`. | GitHub API; SOURCE `README.md:11` |
| Base image `node:22-bookworm-slim`; Node 22.23.5 in the pinned image; image size about 421 MB. | SOURCE `Dockerfile:23`; EMPIRICAL |
