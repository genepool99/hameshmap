# Security Policy

## Status

This project is pre-release. No version has been published and none is
supported for production use yet.

## Reporting a vulnerability

Please do not open a public issue for security problems.

<!-- OWNER: set the private reporting channel before publication, for example
     GitHub private vulnerability reporting on this repository. -->
A private reporting channel will be listed here before the first public
release.

Include the App version, Home Assistant and Supervisor versions, installation
type, and steps to reproduce. Remove credentials, tokens, message content, and
location data from logs before sharing them.

## Scope

In scope: the Home Assistant packaging in this repository — manifests,
container build, startup and configuration adapter, the Ingress adaptation, and
documentation.

Vulnerabilities in the Live Mesh Map World application itself should be
reported to the upstream project at
<https://github.com/sauveteur71/live-mesh-map-world>. If you are unsure which
side is affected, report it here and it will be forwarded.

## Security design

- [Threat model](docs/security/threat-model.md)
- [Container hardening review](docs/security/container-hardening-review.md)
- [ADR 0007: container privileges](docs/adr/0007-container-privileges.md)

Summary of defaults: no host ports published, no privileged access, no Docker
socket, MQTT-to-LoRa transmission disabled, upstream version pinned.
