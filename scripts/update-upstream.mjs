#!/usr/bin/env node
// Moves the App to the latest release of Live Mesh Map World.
//
//   node scripts/update-upstream.mjs           latest release
//   node scripts/update-upstream.mjs 1.5.15    a given version
//
// Writes the upstream version and image digest to live-mesh-map/Dockerfile,
// increases the patch number of the App version in live-mesh-map/config.yaml
// and adds an entry to live-mesh-map/CHANGELOG.md. Prints "up to date" and
// changes nothing when the Dockerfile already has that version and digest.
// Exit code: 0 updated or up to date, 1 error.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'sauveteur71/live-mesh-map-world';
const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'live-mesh-map');

// "v1.5.15" or "1.5.15" -> "1.5.15"; anything else is an error.
export function parseVersion(tag) {
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(String(tag).trim());
  if (!m) throw new Error(`not a version: ${tag}`);
  return m[1];
}

// Reads UPSTREAM_VERSION and UPSTREAM_DIGEST from the Dockerfile text.
export function readPins(dockerfile) {
  const version = /^ARG UPSTREAM_VERSION=(\S+)$/m.exec(dockerfile);
  const digest = /^ARG UPSTREAM_DIGEST=(\S+)$/m.exec(dockerfile);
  if (!version || !digest) throw new Error('UPSTREAM_VERSION or UPSTREAM_DIGEST not found in the Dockerfile');
  return { version: version[1], digest: digest[1] };
}

export function writePins(dockerfile, version, digest) {
  return dockerfile
    .replace(/^ARG UPSTREAM_VERSION=\S+$/m, `ARG UPSTREAM_VERSION=${version}`)
    .replace(/^ARG UPSTREAM_DIGEST=\S+$/m, `ARG UPSTREAM_DIGEST=${digest}`);
}

// Increases the patch number of the `version: "x.y.z"` line of config.yaml.
// Returns { text, version }.
export function bumpAppVersion(config) {
  const m = /^version: "(\d+)\.(\d+)\.(\d+)"$/m.exec(config);
  if (!m) throw new Error('version: "x.y.z" not found in config.yaml');
  const version = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  return { text: config.replace(m[0], `version: "${version}"`), version };
}

// Inserts a new first entry below the "# Changelog" title.
export function addChangelogEntry(changelog, appVersion, upstreamVersion) {
  const entry = `## ${appVersion}\n\n- Live Mesh Map World ${upstreamVersion}.\n`;
  const at = changelog.indexOf('\n## ');
  if (at === -1) return `${changelog.trimEnd()}\n\n${entry}`;
  return `${changelog.slice(0, at + 1)}${entry}\n${changelog.slice(at + 1)}`;
}

async function latestVersion() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'update-upstream' } });
  if (!r.ok) throw new Error(`GitHub releases: HTTP ${r.status}`);
  return parseVersion((await r.json()).tag_name);
}

// Digest of the multi-arch index of ghcr.io/<REPO>:<version>.
async function imageDigest(version) {
  const t = await fetch(`https://ghcr.io/token?scope=repository:${REPO}:pull`);
  if (!t.ok) throw new Error(`ghcr.io token: HTTP ${t.status}`);
  const { token } = await t.json();
  const r = await fetch(`https://ghcr.io/v2/${REPO}/manifests/${version}`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' },
  });
  if (!r.ok) throw new Error(`ghcr.io has no image for version ${version} (HTTP ${r.status})`);
  const digest = r.headers.get('docker-content-digest');
  if (!/^sha256:[0-9a-f]{64}$/.test(digest || '')) throw new Error('ghcr.io returned no digest');
  return digest;
}

async function main() {
  const files = { dockerfile: path.join(APP_DIR, 'Dockerfile'), config: path.join(APP_DIR, 'config.yaml'), changelog: path.join(APP_DIR, 'CHANGELOG.md') };
  const dockerfile = fs.readFileSync(files.dockerfile, 'utf8');
  const current = readPins(dockerfile);
  const version = process.argv[2] ? parseVersion(process.argv[2]) : await latestVersion();
  const digest = await imageDigest(version);
  if (version === current.version && digest === current.digest) {
    console.log(`up to date: Live Mesh Map World ${version}`);
    return;
  }
  const app = bumpAppVersion(fs.readFileSync(files.config, 'utf8'));
  fs.writeFileSync(files.dockerfile, writePins(dockerfile, version, digest));
  fs.writeFileSync(files.config, app.text);
  fs.writeFileSync(files.changelog, addChangelogEntry(fs.readFileSync(files.changelog, 'utf8'), app.version, version));
  console.log(`updated: Live Mesh Map World ${current.version} -> ${version} (${digest}), App version ${app.version}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`update failed: ${e.message}`); process.exit(1); });
}
