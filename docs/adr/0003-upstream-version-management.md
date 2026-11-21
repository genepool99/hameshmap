# ADR 0003: Upstream version management

- Status: Accepted
- Date: 2026-11-20

## Context

Verified on 2026-11-20 ([upstream/README.md](../upstream/README.md)):

- Image: `ghcr.io/sauveteur71/live-mesh-map-world`. The tag for release
  `v1.5.14` is `1.5.14` (no `v`).
- Version tags are mutable: `1.5.14`, `1.5`, `latest`, and `main` pointed at
  the same index when checked, and a version tag can be re-pushed.
- Images are not signed. Only BuildKit provenance is attached.
- Upstream releases several times a day at present.
- Upstream checks GitHub for new versions and offers an in-app updater that
  needs a Docker-socket sidecar.

## Decision

1. Pin one reviewed upstream version, by version **and** immutable index
   digest, in a single place in the App build configuration. Never use
   `latest`.
2. Record the upstream commit and per-architecture digests in
   `docs/upstream/README.md` for each pinned version.
3. The App version is `<upstream version>-<wrapper revision>` style only if
   Supervisor's version handling allows it; otherwise the App carries its own
   version and states the upstream version in the changelog. The chosen scheme
   is recorded in `live-mesh-map/CHANGELOG.md`.
4. Upgrading upstream is a deliberate change that must pass, in order:
   - the frontend transform's zero-residual check
     ([ADR 0004](0004-ingress-implementation.md));
   - every row of
     [upstream/integration-contract.md](../upstream/integration-contract.md);
   - `make check`, `make test-integration`, and `make test-ingress`;
   - an upgrade test from the previous App version with existing data.
5. Upstream's own update check is disabled (`VERIFIER_MAJ=non`) and its
   Docker-socket updater is not shipped. Supervisor owns upgrades
   ([ADR 0008](0008-release-and-update-architecture.md)).

## Alternatives considered

- **Track `latest` or a floating minor tag.** Rejected: unreviewed code would
  reach users, and the frontend transform could silently stop matching.
- **Pin by version tag only.** Rejected: tags are mutable.
- **Follow every upstream release automatically.** Rejected for now: too
  frequent to review. A bot that proposes bumps may be added later; it must
  only open proposals for the owner, never commit or publish.

## Consequences

- Users lag upstream by the time it takes to review and test a bump.
- The in-app "update" control cannot be hidden upstream. It is inert without
  the sidecar; this is documented for users and proposed upstream.
- Digest pinning is a release gate (see
  [release checklist](../release-checklist.md)).
