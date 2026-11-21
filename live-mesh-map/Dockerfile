# Live Mesh Map - Home Assistant App
#
# A thin layer on top of the published image of Live Mesh Map World
# (https://github.com/sauveteur71/live-mesh-map-world, GPL-3.0, (c) its authors).
# The upstream version is pinned here, by tag AND by digest of the multi-arch
# index. To move to another upstream release, change the three UPSTREAM_*
# values together (docker buildx imagetools inspect <image>:<tag> prints the
# digest) and rebuild: the build stops if the web UI no longer matches what
# build/relativize.mjs expects.
#
# Home Assistant no longer reads build.yaml (Supervisor 2026.04): base image,
# build arguments and labels are all defined in this file.
ARG UPSTREAM_IMAGE=ghcr.io/sauveteur71/live-mesh-map-world
ARG UPSTREAM_VERSION=1.5.14
ARG UPSTREAM_DIGEST=sha256:4f2d4f0148ef6c5170b9fb86040322fda0f59f0f78ed8b113e193fd4ee77d237

# ---- Stage 1: make the upstream web UI work below a URL prefix (Ingress) ----
# Runs on the build machine's own architecture: the result is plain text.
FROM --platform=$BUILDPLATFORM ${UPSTREAM_IMAGE}:${UPSTREAM_VERSION}@${UPSTREAM_DIGEST} AS webui
ARG UPSTREAM_VERSION
# Build stage only: needs to write the rewritten files to /out.
# hadolint ignore=DL3002
USER 0
COPY build/relativize.mjs /build/relativize.mjs
RUN set -eu; \
    found="$(node -p "require('/app/package.json').version")"; \
    if [ "${found}" != "${UPSTREAM_VERSION}" ]; then \
      echo "Upstream image contains version ${found}, expected ${UPSTREAM_VERSION}" >&2; exit 1; \
    fi; \
    node /build/relativize.mjs /app /out; \
    for f in /out/public/*.js /out/src/server.js; do node --check "${f}"; done

# ---- Stage 2: the App image ---------------------------------------------------
FROM ${UPSTREAM_IMAGE}:${UPSTREAM_VERSION}@${UPSTREAM_DIGEST}

ARG UPSTREAM_IMAGE
ARG UPSTREAM_VERSION
ARG UPSTREAM_DIGEST
# Provided by the Home Assistant Supervisor / builder; defaults for a plain "docker build".
ARG BUILD_VERSION=dev
ARG BUILD_ARCH="aarch64|amd64"
# Set when the image is published (URL of the repository holding this Dockerfile).
ARG IMAGE_SOURCE=""

# The container starts as root only to hand the Supervisor-created /data to the
# unprivileged "node" user; run.mjs then drops root before anything listens.
# hadolint ignore=DL3002
USER 0

COPY --from=webui --chown=root:root /out/public/ /app/public/
COPY --from=webui --chown=root:root /out/src/server.js /app/src/server.js
COPY --chown=root:root --chmod=0755 rootfs/opt/lmm/ /opt/lmm/
COPY --chown=root:root --chmod=0755 build/relativize.mjs /opt/lmm/source/relativize.mjs
COPY --chown=root:root --chmod=0755 NOTICE.md /opt/lmm/NOTICE.md

ENV TZ=UTC \
    NODE_ENV=production

EXPOSE 8099

HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8095/sante').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

WORKDIR /app
ENTRYPOINT ["node", "/opt/lmm/run.mjs"]
CMD []

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}" \
  org.opencontainers.image.title="Live Mesh Map (Home Assistant App)" \
  org.opencontainers.image.description="Live Mesh Map World packaged for Home Assistant: Meshtastic and MeshCore map, monitoring and administration" \
  org.opencontainers.image.version="${BUILD_VERSION}" \
  org.opencontainers.image.licenses="GPL-3.0-only" \
  org.opencontainers.image.source="${IMAGE_SOURCE}" \
  org.opencontainers.image.url="${IMAGE_SOURCE}" \
  org.opencontainers.image.base.name="${UPSTREAM_IMAGE}:${UPSTREAM_VERSION}" \
  org.opencontainers.image.base.digest="${UPSTREAM_DIGEST}" \
  io.github.sauveteur71.live-mesh-map-world.version="${UPSTREAM_VERSION}" \
  io.github.sauveteur71.live-mesh-map-world.source="https://github.com/sauveteur71/live-mesh-map-world"
