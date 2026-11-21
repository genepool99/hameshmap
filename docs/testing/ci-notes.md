# CI notes and verified Home Assistant guidance

Verified on 2026-11-20. Sources are the raw files of
`home-assistant/developers.home-assistant` at commit `50b5188` (the site
`developers.home-assistant.io/docs/apps/*`), plus the repositories named below.

## What was verified

| Topic | Finding | Source |
| --- | --- | --- |
| Terminology and paths | Add-ons are now "apps"; docs live under `/docs/apps/` (`configuration`, `security`, `testing`, `publishing`, `presentation`, `communication`, `repository`). The old `/docs/add-ons/*` source files no longer exist. | `docs/apps/` listing |
| Architectures | `arch` supports `aarch64` and `amd64` only. | `docs/apps/configuration.md` |
| `build.yaml` | No longer used by the builder; Supervisor still reads it with a deprecation warning. Base image, labels and args belong in the Dockerfile. `BUILD_FROM` is no longer supplied since Supervisor 2026.04.0. | `docs/apps/configuration.md`, `blog/2026-04-02-builder-migration.md` |
| Required labels | Without the builder actions the Dockerfile must set `io.hass.version`, `io.hass.type`, `io.hass.arch`. | `docs/apps/configuration.md` |
| Builder | The `home-assistant/builder` container and old action are retired. Replacement: composite actions `home-assistant/builder/actions/{prepare-multi-arch-matrix,build-image,publish-multi-arch-manifest,cosign-verify}`, latest release `2026.09.0`. | builder repository, `docs/apps/publishing.md` |
| Linter | `frenck/action-addon-linter` is still what `home-assistant/apps-example` uses (`@v2.21`); latest release `v2.21.2` (2026-11-06). | `apps-example/.github/workflows/lint.yaml` |
| Local build | `docker build` in the App directory, `--platform linux/arm64` for `aarch64`. | `docs/apps/testing.md` |
| Ingress | `ingress: true`, default port 8099, "only connections from `172.30.32.2` must be allowed", `X-Ingress-Path` header. | `docs/apps/presentation.md` |
| Ingress headers | Core adds `X-Ingress-Path`, `X-Hass-Source`, `X-Forwarded-For/-Host/-Proto` and drops `Accept-Encoding`; Supervisor adds `X-Remote-User-Id/-Name/-Display-Name` and requires an admin user when `panel_admin` is true. | `home-assistant/core` `components/hassio/ingress.py` @ `e17c7a6`; `home-assistant/supervisor` `api/ingress.py` @ `fe91b8d` |
| Supervisor API without `hassio_api` | An App token may call `/services*` and `/addons/self/<x>` (except `security`, `update`) without `hassio_api: true`. | `supervisor/api/middleware/security.py` (`api_bypass`) |
| Security guidance | No host network, custom AppArmor profile, read-only maps, minimal API role, signed images. Ingress adds 2 rating points. | `docs/apps/security.md`, `docs/apps/presentation.md` |

Not verified: behaviour of any of the above on a running Supervisor.

## Why CI does not use the Home Assistant builder actions

`build-image` is the publishing path: `container-registry-password` is a
required input, Cosign is on by default and needs `id-token: write`, and the
example workflow grants `packages: write`. This repository's CI must hold
`contents: read` only and must not be able to publish. The Home Assistant
documentation describes plain `docker build` as the supported local build, so
the `build` job uses that, with the same `BUILD_VERSION` / `BUILD_ARCH`
arguments the builder would pass. When the owner decides to publish, a
separate, owner-written release workflow based on the builder actions is the
documented route; none exists here by design.

## Pinned actions

| Action | Version | Commit |
| --- | --- | --- |
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| `frenck/action-addon-linter` | v2.21.2 | `d51677290aef26cdfc835271dd3c7343ce502809` |

Each SHA was resolved with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`
(annotated tags dereferenced to their commit) on 2026-11-20. The workflow has
not been executed on GitHub: the repository is not published. `actionlint`
passes locally.

## Dependency updates: proposal, not active

No `.github/dependabot.yml` is installed. Dependabot never pushes to a
protected branch, but it does create branches, commits and commit messages in
the repository, which `AGENTS.md` section 1 does not allow automation to do
without the owner's decision. If the owner wants it, this is the proposed
content (weekly, actions and Docker only, pull requests for review):

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /live-mesh-map
    schedule:
      interval: weekly
```

Note that Dependabot will not update the image references in
`tests/images.env` (not a format it understands) and would propose upstream
image bumps that still need the review described in the Dockerfile header.
Requirements before enabling: branch protection on `main` with required
review and required CI.
