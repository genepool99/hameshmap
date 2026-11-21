# ADR 0002: Thin wrapper around the upstream image, not a fork

- Status: Accepted
- Date: 2026-11-20

## Context

Upstream publishes a multi-architecture image (amd64, arm64) and releases very
often: 26 releases in the nine days before this decision
([upstream/README.md](../upstream/README.md)). A fork would have to be rebased
constantly. Upstream is configured through environment variables, keeps all
state under `/data`, and runs as an unprivileged user, which suits a wrapper.

Two upstream behaviours do not fit Supervisor as shipped:

1. The frontend uses root-absolute URLs and has no base-path support, so it
   cannot run behind Ingress unmodified
   ([upstream/ingress-audit.md](../upstream/ingress-audit.md)).
2. Configuration uses French environment variable names and values.

## Decision

Build the App image `FROM` the published upstream image at a pinned version.
Add only:

- a dependency-free Node.js startup adapter that translates Supervisor options
  into upstream environment variables and manages the process;
- an Ingress listener;
- one build-time transform of upstream's static frontend files, described in
  [ADR 0004](0004-ingress-implementation.md).

Upstream server code is not modified. No upstream source is vendored into this
repository.

## Alternatives considered

- **Fork upstream and build from source.** Full control, but a permanent
  maintenance burden against a fast-moving project, and it duplicates
  upstream's build (Go agents, pmtiles).
- **Use the upstream image directly as the App image.** Not possible: the App
  needs option translation, `/data` ownership handling, and Ingress support.
- **Rebuild on a Home Assistant base image with s6 and bashio.** Conventional
  for Apps written from scratch, but it would mean reproducing upstream's
  runtime on a different base (Alpine versus Debian, native modules) for no
  functional gain. The Node.js runtime already in the image runs the adapter.

## Consequences

- Upgrading upstream is normally a one-line version and digest change plus the
  contract checks in [ADR 0003](0003-upstream-version-management.md).
- The frontend transform makes the image a modified version of a GPL-3.0 work.
  Obligations are listed in [upstream/licensing.md](../upstream/licensing.md)
  and `NOTICE.md`.
- The wrapper depends on upstream behaviours it does not control. They are
  enumerated in
  [upstream/integration-contract.md](../upstream/integration-contract.md) and
  checked by tests.
- The image does not use the Home Assistant base images, so bashio and s6 are
  not available; the adapter talks to the Supervisor API directly.
