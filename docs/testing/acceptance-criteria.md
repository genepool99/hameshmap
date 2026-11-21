# Acceptance criteria

Last updated 2026-11-20. Status values: **PASS**, **FAIL**, **NOT TESTED**.
A row is PASS only with evidence from the environment named in the row.
Synthetic results (local containers, simulated Ingress) are listed separately
and never upgrade a real-world row.

## A. Real-world acceptance checks (owner's test host)

None of these has been executed: no action has been taken on any Home
Assistant installation. Procedure: `deployment-and-regression.md`.

| # | Check | Pass condition | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Fresh install | App appears in the store from the repository (or `/addons` local folder), installs without error on a host that never had it | NOT TESTED | none |
| 2 | Container start | Starts with default options; log shows upstream healthy; Supervisor reports `started`; watchdog does not restart it | NOT TESTED | none |
| 3 | MQTT connection | With the Mosquitto App installed and no manual broker, the App connects using the Supervisor-provided service; with a manual broker set, only that broker is used | NOT TESTED | none |
| 4 | Live map | Map renders with tiles; nodes appear when mesh traffic arrives on the mesh broker; live updates without reload | NOT TESTED | none |
| 5 | Ingress | "Open web UI" and the sidebar panel work on desktop and the mobile app, over the host's real URL (HTTPS if used); reload, login, logout, file download work; browser network log shows no request outside `/api/hassio_ingress/<token>/` | NOT TESTED | none |
| 6 | Device discovery | Home Assistant's MQTT integration shows one "Live Mesh Map" device with the map-level entities; monitored nodes appear as devices; no duplicates | NOT TESTED | none |
| 7 | Test automation | An automation triggered by a discovered entity (for example the critical-alert binary sensor) fires | NOT TESTED | none |
| 8 | Restart and recovery | App restart, Mosquitto restart and host reboot each end with the map reachable and entities available again, same entity IDs | NOT TESTED | none |
| 9 | Upgrade without data loss | Upgrade from the previous App version keeps accounts, settings and history | NOT TESTED | none (no previous version exists yet) |
| 10 | Backup and restore | Supervisor backup of the App, uninstall, restore: accounts, settings, history and options are back | NOT TESTED | none |
| 11 | amd64 and arm64 | Checks 1, 2, 4, 5 on one `amd64` and one `aarch64` Home Assistant host | NOT TESTED | none |
| 12 | No unintended exposure | From another machine on the LAN: ports 8095, 4404 and 8099 of the host are closed with default options; the App's security rating in the UI is as expected; no LoRa transmission entity exists | NOT TESTED | none |

## B. Synthetic evidence available today

These results come from this development machine (linux/amd64, Docker 29)
and are **not** Home Assistant results. Commands and dates are in the latest
quality report; re-run them with `make check`, `make test-integration`,
`make test-ingress`.

| Area | What was exercised | Relates to | Result |
| --- | --- | --- | --- |
| Manifest | static validation of `config.yaml`, translations, Dockerfile pinning | 1, 12 | see latest `make check` output |
| Container start | image built locally, started with sample options beside a fake Supervisor | 2 | integration `t01`-`t03`, `t15` |
| MQTT selection | Supervisor-provided versus manual broker, broker outage | 3, 8 | integration `t07`, `t13`, `t14` |
| Discovery payloads | topics and `unique_id`s stable across restart (map-level entities only; no node traffic) | 6, 8 | integration `t07` |
| Ingress path handling | browser behind a simulated gateway, desktop and mobile viewport | 5 | `make test-ingress` |
| Persistence | container recreated on the same volume | 8, 9 | integration `t11` |
| Exposure | listening sockets, source-address filter, LoRa transmit refused | 12 | integration `t03`, `t04`, `t08` |

## C. First working release: criteria

All of the following, in addition to section A rows 1-8, 10 and 12 being PASS
on at least one architecture (row 11 PASS for both before the App is
advertised as supporting both):

1. `make check` has no FAIL and no SKIP.
2. `make validate-manifest MANIFEST_FLAGS=--strict` has no WARN, or each
   remaining WARN has a recorded owner decision.
3. `make test-integration` and `make test-ingress` pass on a canonical
   (`172.30.32.0/23`) network.
4. The upstream image is pinned by digest and the digest's provenance is
   recorded (`docs/security/threat-model.md`, supply chain).
5. Every item of `docs/security/container-hardening-review.md` is answered.
6. Threat-model entries marked "planned" are either implemented or accepted by
   the owner in writing.
7. `DOCS.md` tells the user how the first administrator account is created,
   what the optional ports expose, and that LoRa transmission is off by
   default.
8. Licensing: GPL-3.0 text, upstream notice and source offer are present for
   the distributed image.
