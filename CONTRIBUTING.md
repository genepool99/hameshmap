# Contributing

Thank you for helping improve the Live Mesh Map World Home Assistant App.

## Scope

This repository contains only the Home Assistant packaging: Supervisor
manifests, the container build, the startup/configuration adapter, tests, and
documentation. The application itself lives upstream at
<https://github.com/sauveteur71/live-mesh-map-world>.

- Bugs or feature requests about the map, radio decoding, alerts, or MQTT
  entity content belong upstream.
- Bugs about installation, configuration options, Ingress, startup, or
  Supervisor integration belong here.

If a fix is needed in upstream code, propose it upstream first. Patches carried
here must be minimal, documented in an ADR, and removed once upstream ships an
equivalent.

## Development

Requirements: Docker and Node.js 22 or newer. Everything else runs from pinned
container images.

```sh
make check              # linters, manifest validation, unit tests, secret scan
make test-integration   # builds the image and runs real-container tests
make test-ingress       # browser tests behind a simulated Ingress prefix
```

See [docs/testing/test-plan.md](docs/testing/test-plan.md) for what each layer
does and does not prove. Local container tests and simulated Ingress are not a
substitute for testing on a real Home Assistant installation; say which one you
ran when reporting results.

## Standards

- Follow the current [Home Assistant App documentation](https://developers.home-assistant.io/docs/apps).
- Keep the wrapper thin and dependency-free where possible.
- Every option in `config.yaml` needs a schema entry, a translation, a unit
  test for its translation to upstream configuration, and documentation in
  `live-mesh-map/DOCS.md`.
- Never log credentials, tokens, message content, or precise locations.
- Do not widen container privileges or publish additional ports without an ADR
  in [docs/adr/](docs/adr/).
- Record significant design decisions as ADRs.
- Update `live-mesh-map/CHANGELOG.md` for user-visible changes.

## Upgrading the pinned upstream version

Follow [docs/adr/0003-upstream-version-management.md](docs/adr/0003-upstream-version-management.md)
and re-check every item of
[docs/upstream/integration-contract.md](docs/upstream/integration-contract.md).

## Licensing

Contributions are accepted under the repository licence
([GPL-3.0](LICENSE)). Preserve existing copyright notices and upstream credits.

## Automated agents

AI agents and automation working in this repository must follow
[AGENTS.md](AGENTS.md), including its absolute restrictions on Git operations
and attribution.
