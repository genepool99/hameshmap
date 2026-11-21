# Requirements

Status legend used across this repository: **implemented** (code exists),
**tested** (verified by a test whose scope is stated), **partially tested**,
**planned**. Current status of each requirement is tracked in
[testing/acceptance-criteria.md](testing/acceptance-criteria.md).

## Product goal

A Home Assistant App that runs the full
[Live Mesh Map World](https://github.com/sauveteur71/live-mesh-map-world)
application under Home Assistant Supervisor (Home Assistant OS and Supervised
installations), installable from a community App repository.

## Functional requirements

| ID | Requirement |
| --- | --- |
| F1 | Install from a Home Assistant App repository without writing Docker Compose files or environment variables. |
| F2 | Configure region, radio, mesh broker, MeshCore, and Home Assistant output through the App configuration form, with validated and translated options. |
| F3 | Monitor Meshtastic and MeshCore networks using the unmodified upstream backend. |
| F4 | Open the live map inside Home Assistant through Ingress, including assets, API calls, live updates, reloads, and downloads. |
| F5 | Expose devices and entities to Home Assistant through upstream's MQTT Discovery, using the Supervisor-provided broker when available and a manually configured broker otherwise. A manual broker is never silently overridden. |
| F6 | Entities have stable identifiers across restarts and upgrades; no duplicate devices; no unnecessary retained-message churn. |
| F7 | Upgrades, restarts, and backup/restore preserve history and configuration stored under `/data`. |
| F8 | Failures are diagnosable through the App log, health check/watchdog, and clear configuration error messages. |

## Security requirements

| ID | Requirement |
| --- | --- |
| S1 | Least privilege: no privileged mode, `full_access`, `docker_api`, host networking, Docker socket, broad host mounts, or USB/serial access by default. |
| S2 | No ports published to the host by default. The remote-agent port (4404) is never exposed unless the user opts in. |
| S3 | Ingress must not bypass the application's own authorization for administrative operations. |
| S4 | MQTT-to-LoRa transmission is disabled by default. |
| S5 | No default credentials, no embedded credentials, TLS verification never disabled. |
| S6 | Passwords, credential-bearing URLs, tokens, message content, and precise location data are not logged. |
| S7 | Upstream's Docker-socket updater is not shipped; Supervisor owns lifecycle and upgrades. |
| S8 | The upstream dependency is pinned to a reviewed version, and by immutable digest with recorded provenance before any public release. |

## Engineering requirements

| ID | Requirement |
| --- | --- |
| E1 | Thin packaging layer around upstream; any upstream patch is minimal, documented, and has a path to upstream acceptance. |
| E2 | AMD64 and ARM64 images. |
| E3 | Correct signal handling, shutdown, and health checks. |
| E4 | Automated static checks, unit tests, container integration tests, and browser tests behind an Ingress path prefix. |
| E5 | CI validates only: it never commits, pushes, tags, or publishes. |
| E6 | Significant decisions are recorded as ADRs. |

## Out of scope for this milestone

- A custom Home Assistant integration or Lovelace map card.
- Publication: GitHub repository, container registry, releases.
- Server-attached USB/serial/Bluetooth radios.

## Release gates

Working, secure Ingress verified on a real Home Assistant installation is a
release gate, as are the twelve real-world acceptance checks in
[testing/acceptance-criteria.md](testing/acceptance-criteria.md) and the
[release checklist](release-checklist.md).
