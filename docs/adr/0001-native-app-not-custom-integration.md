# ADR 0001: Deliver a Home Assistant App, not a custom integration

- Status: Accepted
- Date: 2026-11-20

## Context

Live Mesh Map World is a long-running Node.js server with its own web UI,
SQLite database, MQTT clients, and a TCP listener for remote agents. It already
publishes Home Assistant MQTT Discovery messages
([upstream/mqtt.md](../upstream/mqtt.md)).

Users want to install it from Home Assistant, configure it there, see the map
inside Home Assistant, and get entities for automations.

## Decision

Package the application as a Home Assistant App (formerly "add-on") run by
Supervisor. Entities reach Home Assistant through the upstream MQTT Discovery
implementation and the standard MQTT integration. The map is reached through
Ingress.

## Alternatives considered

- **Custom integration (Python, in Home Assistant Core).** Cannot host a
  Node.js server. It would need the application to run elsewhere and would
  reimplement entity mapping that upstream already provides over MQTT.
- **Custom integration plus Lovelace card, talking to an external instance.**
  Useful later for richer entities or a native map card, but it does not solve
  installation and lifecycle, which is the primary goal.
- **Documentation only (Docker Compose next to Home Assistant).** Does not work
  on Home Assistant OS without extra tooling and gives no Ingress, backups, or
  managed upgrades.

## Consequences

- Only Home Assistant OS and Supervised installations are supported. Container
  and Core installations have no Supervisor; those users run upstream directly.
- Entity content, naming, and language are whatever upstream publishes. The
  device name and entity names are currently French and fixed upstream;
  improving them is an upstream contribution, not wrapper code.
- Users need an MQTT broker and the MQTT integration to get entities.
- A custom integration or map card remains possible later without changing the
  App.
