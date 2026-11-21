# Deployment and regression procedure for a real Home Assistant test host

**Nothing in this document may be executed without the owner's explicit
authorization for that step.** It is a procedure, not a record: no step has
been run. Before each state-changing step, state the change, the affected
service, expected downtime, backup and rollback, and wait for approval
(`AGENTS.md` section 4). Never copy keys or tokens into the repository.

Scope: Home Assistant OS or Supervised. A Container or Core installation has
no Supervisor and cannot run Apps.

## 0. Preconditions

- Owner names the host and how to reach it (SSH App, Samba App or terminal).
- A maintenance window is agreed; the host should not be the owner's only
  production automation controller if avoidable.
- Local gates are green: `make check`, `make test-integration`,
  `make test-ingress`.

## 1. Read-only reconnaissance (no changes)

Record the answers in the test report. All commands only read state.

| Question | How (read-only) |
| --- | --- |
| Installation type, versions, architecture | Settings > About; or `ha info`, `ha core info`, `ha supervisor info`, `ha os info` |
| Supervisor is 2026.04.0 or newer (Dockerfile-only builds) | `ha supervisor info` |
| Free disk space (image is roughly the upstream image plus a few MB; local build needs more) | Settings > System > Storage; `ha host info` |
| Installed Apps, existing MQTT broker | Settings > Apps; `ha apps` (older CLI: `ha addons`) |
| MQTT integration configured in Home Assistant, discovery prefix | Settings > Devices & services > MQTT > Configure |
| Existing retained topics that could collide (`homeassistant/+/live-mesh-map/#`, `live-mesh-map/#`) | MQTT integration "Listen to a topic", or `mosquitto_sub -v -t 'live-mesh-map/#' -W 5` |
| Host ports 8095 and 4404 already used | `ha network info`; from another machine `nc -zv <host> 8095` |
| How the UI is reached (HTTP/HTTPS, reverse proxy, Nabu Casa, mobile app) | owner |
| Last full backup and where it is stored | Settings > System > Backups |
| Does a previous copy of this App exist (`/addons/live-mesh-map`)? | Samba/SSH listing |

Stop here and report. Do not continue without approval.

## 2. Backup before any change (approval required)

1. Create a **full** backup (Settings > System > Backups > Create backup) and
   copy it off the host.
2. Record the backup slug and time in the test report.

Risk: none beyond disk usage and a short load spike. Rollback: delete the
backup.

## 3. Install as a local App (approval required)

Change: adds one App build directory and one container. Affected service:
none until started. Downtime: none. Rollback: section 6.

1. Copy the directory `live-mesh-map/` of this repository (only that
   directory) to `/addons/live-mesh-map/` on the host (`/local_apps` in the
   SSH/Samba App's view of newer releases). Do not copy `tests/` or `.git/`.
2. Confirm `image:` is absent or commented out in `config.yaml`, so
   Supervisor builds locally.
3. Settings > Apps > App store > menu > "Check for updates"; the App appears
   under "Local apps".
4. Open it and read the security rating and requested permissions **before**
   installing. Expected: Ingress, no host network, no privileged access, no
   device access, AppArmor enabled.
5. Install (the host builds the image: several minutes, CPU and disk load).
6. Do not start yet. Review the Configuration tab: LoRa transmission is off,
   both optional ports are disabled.

## 4. First start and the 12 acceptance checks (approval required)

Change: starts the container; it connects to the MQTT broker and publishes
retained discovery messages; Home Assistant creates devices and entities.
Rollback: section 6, including retained-topic cleanup.

Run the checks of `acceptance-criteria.md` section A in order and record
PASS/FAIL with evidence (screenshot, log excerpt with secrets removed, command
output).

1. **Fresh install**: recorded in section 3.
2. **Start**: Start the App. In the Log tab expect, in order: options read,
   which MQTT broker is used for the Home Assistant output, "running as uid
   1000", "ingress listening on port 8099", upstream "listening on port 8095",
   "upstream is healthy". No secret in the log. Leave it 10 minutes; the
   watchdog must not restart it.
3. **MQTT**: Mosquitto App log shows a client `live-mesh-map-domotique-*`
   connecting with the service user. Then set a manual broker in the options,
   restart, confirm the service broker no longer sees that client; revert.
4. **Live map**: set the mesh broker options (owner provides them), restart,
   open the map, confirm nodes appear and move/update without reload.
5. **Ingress**: "Open web UI" and sidebar. With the browser's developer tools
   Network tab open, filter on the host name and confirm no request path
   outside `/api/hassio_ingress/`. Create the administrator with the setup
   code (from the `setup_code` option, or from the App log if none was set).
   Check: reload, logout/login, one export download, the topology page, a
   second browser, the Home Assistant mobile app, and the external URL if one
   exists. Confirm a non-admin Home Assistant user does not see the panel.
6. **Discovery**: Settings > Devices & services > MQTT: one "Live Mesh Map"
   device, eight map-level entities with sensible states, availability
   "online". Record entity IDs.
7. **Automation**: create a temporary automation triggered by one discovered
   entity (state change of "active nodes" is enough) that writes a persistent
   notification; confirm it fires; delete it.
8. **Restart and recovery**: restart the App; restart the Mosquitto App;
   reboot the host (approval for each). After each: map reachable, entities
   available, entity IDs unchanged, no `_2` duplicates.
9. **Upgrade**: only when a newer version exists. Note accounts and a few
   history values, update via the App page, compare.
10. **Backup/restore**: create a partial backup of this App; uninstall the App
    (data removed); restore the backup; start; confirm the administrator
    login, settings and history are back.
11. **Architectures**: repeat 1, 2, 4, 5 on the other architecture.
12. **Exposure**: from another LAN machine, `nc -zv <host> 8095`,
    `nc -zv <host> 4404`, `nc -zv <host> 8099` are all refused. No "Message
    LoRa" text entity exists. Publish a test payload to
    `live-mesh-map/envoyer` and confirm the answer on
    `live-mesh-map/envoyer/resultat` is a refusal. **Do not enable LoRa
    transmission on a host with a radio attached without a separate, explicit
    authorization: it transmits on air.**

## 5. Regression run (after any change to the App)

1. Locally: `make check && make test-integration && make test-ingress`.
2. On the host (approval): copy the new `live-mesh-map/`, "Check for updates",
   Rebuild or Update.
3. Re-run checks 2, 3, 5, 6, 8 and 12. If `config.yaml` options changed, also
   confirm the saved options survived and the Configuration tab shows no
   "option does not exist in the schema" warning in the Supervisor log.
4. Compare entity IDs with the previous record (no renames, no duplicates).
5. Record results in a new dated row set; never overwrite earlier evidence.

## 6. Rollback

| Situation | Action (approval required) |
| --- | --- |
| App misbehaves, data not important | Stop, Uninstall (tick "remove data"), delete `/addons/live-mesh-map/` |
| A new version misbehaves | Stop; restore the App from the partial backup taken before the update (restores the image tag for registry installs; for local builds, copy back the previous directory and Rebuild) |
| Home Assistant entities left behind | Delete the device in the MQTT integration, then clear retained topics: publish empty retained payloads to each `homeassistant/+/live-mesh-map/+/config` topic and to `live-mesh-map/#` topics (the App's log lists the root topic) |
| Host affected more broadly | Restore the full backup from step 2 |

After rollback, confirm with the owner that the host is in its previous state
(Apps list, MQTT devices, free disk space).
