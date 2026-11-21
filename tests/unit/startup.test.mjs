import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findForeignOwned, takeOwnership, isWritable, KEEP_AS_IS } from '../../live-mesh-map/rootfs/opt/lmm/datadir.mjs';
import { supervisorGet, publishedPorts, parsePortList } from '../../live-mesh-map/rootfs/opt/lmm/supervisor.mjs';

const LMM = fileURLToPath(new URL('../../live-mesh-map/rootfs/opt/lmm/', import.meta.url));

// ---- data directory ----------------------------------------------------------
function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmm-data-'));
  fs.mkdirSync(path.join(dir, 'sub/deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'carte-live.db'), 'db');
  fs.writeFileSync(path.join(dir, 'options.json'), '{}');
  fs.writeFileSync(path.join(dir, 'sub/deep/f'), 'x');
  fs.writeFileSync(path.join(dir, 'sub/options.json'), 'not the supervisor file');
  fs.symlinkSync('/etc', path.join(dir, 'sub/link'));
  return dir;
}

test('findForeignOwned: nothing to do when everything already belongs to the user', () => {
  const dir = tree();
  try { assert.deepEqual(findForeignOwned(dir, process.getuid(), process.getgid()), []); } finally { fs.rmSync(dir, { recursive: true }); }
});

test('findForeignOwned: lists every entry once, skips the Supervisor options file, never follows links', () => {
  const dir = tree();
  try {
    const found = findForeignOwned(dir, 424242, 424242).map((p) => path.relative(dir, p)).sort();
    assert.deepEqual(found, ['', 'carte-live.db', 'sub', 'sub/deep', 'sub/deep/f', 'sub/link', 'sub/options.json']);
    assert.ok(KEEP_AS_IS.has('options.json'));
    assert.ok(!found.some((p) => p.startsWith('sub/link/')), 'the link target is not walked');
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('takeOwnership uses lchown on exactly the listed entries and counts failures', () => {
  const dir = tree();
  try {
    const calls = [];
    const fsImpl = { ...fs, lstatSync: fs.lstatSync, readdirSync: fs.readdirSync, lchownSync: (p, u, g) => { calls.push([path.relative(dir, p), u, g]); if (p.endsWith('carte-live.db')) throw new Error('EPERM'); } };
    const r = takeOwnership(dir, 424242, 424243, { fsImpl });
    assert.equal(calls.length, 7);
    assert.ok(calls.every(([, u, g]) => u === 424242 && g === 424243));
    assert.deepEqual(r, { changed: 6, failed: 1 });
    assert.ok(fs.existsSync(path.join(dir, 'carte-live.db')), 'nothing is deleted');
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('isWritable leaves no file behind', () => {
  const dir = tree();
  try {
    const before = fs.readdirSync(dir).sort();
    assert.equal(isWritable(dir), true);
    assert.deepEqual(fs.readdirSync(dir).sort(), before);
    assert.equal(isWritable(path.join(dir, 'does-not-exist')), false);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

// ---- Supervisor client -------------------------------------------------------
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('supervisorGet: sends the bearer token and unwraps data', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return reply(200, { result: 'ok', data: { host: 'h' } })(); };
  const r = await supervisorGet('http://supervisor', 'tok', '/services/mqtt', { fetchImpl });
  assert.deepEqual(r, { ok: true, data: { host: 'h' } });
  assert.equal(seen.url, 'http://supervisor/services/mqtt');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
});

test('supervisorGet: every failure is reported without throwing and without the token', async () => {
  const cases = [
    [reply(400, { result: 'error', message: 'Service not enabled' }), 'HTTP 400'],
    [reply(200, { result: 'error' }), 'HTTP 200'],
    [async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }), 'HTTP 200'],
    [async () => { throw new Error('getaddrinfo ENOTFOUND supervisor tok'); }, 'unreachable'],
    [async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }, 'timeout'],
  ];
  for (const [fetchImpl, reason] of cases) {
    const r = await supervisorGet('http://supervisor', 'tok', '/x', { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
    assert.ok(!JSON.stringify(r).includes('tok'));
  }
  assert.deepEqual(await supervisorGet('http://supervisor', '', '/x', { fetchImpl: async () => { throw new Error('must not be called'); } }), { ok: false, reason: 'no Supervisor token' });
});

test('publishedPorts: only ports the user mapped', () => {
  assert.deepEqual(publishedPorts({ network: { '8095/tcp': null, '4404/tcp': null } }), []);
  assert.deepEqual(publishedPorts({ network: { '8095/tcp': 8095, '4404/tcp': null } }), [8095]);
  assert.deepEqual(publishedPorts({ network: { '8095/tcp': 18095, '4404/tcp': 4404, '53/udp': 53 } }), [8095, 4404]);
  for (const bad of [null, {}, { network: null }, { network: 'x' }]) assert.deepEqual(publishedPorts(bad), []);
});

test('parsePortList', () => {
  assert.deepEqual(parsePortList('8095, 4404'), [8095, 4404]);
  assert.deepEqual(parsePortList('none'), []);
  assert.deepEqual(parsePortList(''), []);
  assert.deepEqual(parsePortList('0,70000,abc,80'), [80]);
});

// ---- bind guard (runs in a child process, as it does in the container) ---------
function runGuard(loopbackPorts, script) {
  return spawnSync(process.execPath, ['--require', path.join(LMM, 'bind-guard.cjs'), '-e', script], { env: { ...process.env, LMM_LOOPBACK_PORTS: loopbackPorts }, encoding: 'utf8', timeout: 10000 });
}
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

test('bind guard: listed ports are bound to loopback for net and http servers, in every call form', async () => {
  const [a, b, c, d] = [await freePort(), await freePort(), await freePort(), await freePort()];
  const script = `
    const net = require('net'), http = require('http');
    const out = [];
    const done = () => { if (out.length === 4) { console.log(JSON.stringify(out)); process.exit(0); } };
    const s1 = http.createServer().listen(${a}, () => { out.push(s1.address().address); done(); });
    const s2 = net.createServer().listen(${b}, () => { out.push(s2.address().address); done(); });
    const s3 = net.createServer().listen(${c}, '0.0.0.0', () => { out.push(s3.address().address); done(); });
    const s4 = net.createServer().listen({ port: ${d} }, () => { out.push(s4.address().address); done(); });`;
  const r = runGuard(`${a},${b},${c},${d}`, script);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['127.0.0.1', '127.0.0.1', '127.0.0.1', '127.0.0.1']);
});

test('bind guard: other ports and an empty list are left untouched', async () => {
  const [a, b] = [await freePort(), await freePort()];
  const script = `const net = require('net'); const s = net.createServer().listen(${a}, () => { console.log(s.address().address); process.exit(0); });`;
  const other = runGuard(String(b), script);
  assert.equal(other.status, 0, other.stderr);
  assert.notEqual(other.stdout.trim(), '127.0.0.1');
  const none = runGuard('', script);
  assert.equal(none.status, 0, none.stderr);
  assert.notEqual(none.stdout.trim(), '127.0.0.1');
});

// ---- entry point: failure paths that need no container ---------------------------
function runEntry(env) {
  return spawnSync(process.execPath, [path.join(LMM, 'run.mjs')], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 15000 });
}

test('run.mjs: invalid JSON options abort with exit code 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmm-opt-'));
  try {
    const f = path.join(dir, 'options.json');
    fs.writeFileSync(f, '{broken');
    const r = runEntry({ LMM_OPTIONS_FILE: f });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /is not valid JSON/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('run.mjs: invalid options abort with exit code 2, before anything starts, without leaking secrets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmm-opt-'));
  const calls = [];
  const sup = http.createServer((req, res) => { calls.push(req.url); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result: 'ok', data: req.url === '/services/mqtt' ? { host: 'broker', port: 1883, ssl: false, username: 'svc', password: 'svc-secret-value' } : { network: {} } })); });
  await new Promise((r) => sup.listen(0, '127.0.0.1', r));
  try {
    const f = path.join(dir, 'options.json');
    fs.writeFileSync(f, JSON.stringify({ mesh_mqtt_url: 'mqtt://bob:opt-secret-value@h:1883', export_token: 'tok-secret-value' }));
    // async spawn: the fake Supervisor lives in this process
    const { spawn } = await import('node:child_process');
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(LMM, 'run.mjs')], { env: { PATH: process.env.PATH, LMM_OPTIONS_FILE: f, SUPERVISOR_TOKEN: 'sup-token-value', LMM_SUPERVISOR_URL: `http://127.0.0.1:${sup.address().port}` } });
      let out = '';
      p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
      p.on('exit', (status) => resolve({ status, out }));
    });
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /Option "mesh_mqtt_url" must not contain a user name or password/);
    assert.match(r.out, /invalid configuration/);
    for (const secret of ['opt-secret-value', 'tok-secret-value', 'svc-secret-value', 'sup-token-value']) assert.ok(!r.out.includes(secret), secret);
    assert.ok(!/upstream started/.test(r.out));
    assert.ok(calls.includes('/services/mqtt'), 'the MQTT service was asked for');
  } finally { sup.close(); fs.rmSync(dir, { recursive: true }); }
});
