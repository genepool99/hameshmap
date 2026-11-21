import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, readPins, writePins, bumpAppVersion, addChangelogEntry } from '../../scripts/update-upstream.mjs';

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;
const dockerfile = `ARG UPSTREAM_IMAGE=ghcr.io/x/y\nARG UPSTREAM_VERSION=1.5.14\nARG UPSTREAM_DIGEST=${digestA}\nFROM x\nARG UPSTREAM_VERSION\n`;

test('parseVersion accepts x.y.z with or without v', () => {
  assert.equal(parseVersion('v1.5.15'), '1.5.15');
  assert.equal(parseVersion('1.5.15'), '1.5.15');
  assert.throws(() => parseVersion('latest'));
  assert.throws(() => parseVersion('1.5'));
});

test('pins are read and rewritten, other lines are kept', () => {
  assert.deepEqual(readPins(dockerfile), { version: '1.5.14', digest: digestA });
  const out = writePins(dockerfile, '1.6.0', digestB);
  assert.deepEqual(readPins(out), { version: '1.6.0', digest: digestB });
  assert.ok(out.includes('ARG UPSTREAM_IMAGE=ghcr.io/x/y\n'));
  assert.ok(out.endsWith('FROM x\nARG UPSTREAM_VERSION\n'));
  assert.throws(() => readPins('FROM x\n'));
});

test('App version patch number is increased', () => {
  const r = bumpAppVersion('name: x\nversion: "0.1.9"\nslug: y\n');
  assert.equal(r.version, '0.1.10');
  assert.equal(r.text, 'name: x\nversion: "0.1.10"\nslug: y\n');
  assert.throws(() => bumpAppVersion('name: x\n'));
});

test('changelog entry is inserted above the previous one', () => {
  const out = addChangelogEntry('# Changelog\n\n## 0.1.0\n\n- Live Mesh Map World 1.5.14.\n', '0.1.1', '1.6.0');
  assert.equal(out, '# Changelog\n\n## 0.1.1\n\n- Live Mesh Map World 1.6.0.\n\n## 0.1.0\n\n- Live Mesh Map World 1.5.14.\n');
  assert.equal(addChangelogEntry('# Changelog\n', '0.1.1', '1.6.0'), '# Changelog\n\n## 0.1.1\n\n- Live Mesh Map World 1.6.0.\n');
});
