// Entry point of the Live Mesh Map Home Assistant App.
//
// Order of operations:
//   1. read the options written by the Supervisor;
//   2. ask the Supervisor (when there is one) for the MQTT service and for
//      the ports the user mapped;
//   3. translate the options into upstream's environment (config.mjs);
//   4. hand /data to the unprivileged user, then drop root for good;
//   5. start the ingress listener and the upstream server;
//   6. forward stop signals and report upstream's exit code.
//
// Environment overrides (testing and plain "docker run"):
//   LMM_OPTIONS_FILE     options file (default /data/options.json)
//   LMM_SUPERVISOR_URL   Supervisor base URL (default http://supervisor)
//   LMM_INGRESS_ALLOW    addresses allowed on the ingress port, comma-separated,
//                        or "*" for any (default 172.30.32.2)
//   LMM_PUBLISHED_PORTS  container ports reachable from outside the container,
//                        e.g. "8095,4404" or "none"; replaces the Supervisor query
//   LMM_STOP_GRACE_MS    time upstream gets to stop before it is killed (default 20000)

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { buildEnvironment, redact, redactText, WEB_PORT, AGENTS_PORT, INGRESS_PORT, SUPERVISOR_INGRESS_ADDRESS } from './config.mjs';
import { createIngressProxy, parseAllowList } from './ingress.mjs';
import { takeOwnership, isWritable } from './datadir.mjs';
import { supervisorGet, publishedPorts, parsePortList } from './supervisor.mjs';

const EXIT_CONFIG = 2;
const EXIT_DATA = 3;
const EXIT_RESTART_LOOP = 4;

const DATA_DIR = '/data';
const APP_DIR = '/app';
const RUN_UID = 1000; // "node" in the upstream image
const RUN_GID = 1000;
const OPTIONS_FILE = process.env.LMM_OPTIONS_FILE || `${DATA_DIR}/options.json`;
const SUPERVISOR_URL = (process.env.LMM_SUPERVISOR_URL || 'http://supervisor').replace(/\/+$/, '');
const STOP_GRACE_MS = Number(process.env.LMM_STOP_GRACE_MS) > 0 ? Number(process.env.LMM_STOP_GRACE_MS) : 20000;

const log = (...a) => console.log(new Date().toISOString(), '[lmm]', ...a);
const fail = (code, ...a) => { console.error(new Date().toISOString(), '[lmm] ERROR', ...a); process.exit(code); };

function readOptions() {
  let raw;
  try { raw = fs.readFileSync(OPTIONS_FILE, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') { log(`no options file at ${OPTIONS_FILE}: using defaults`); return {}; }
    fail(EXIT_CONFIG, `cannot read ${OPTIONS_FILE} (${e.code || 'error'})`);
  }
  try { return JSON.parse(raw); } catch { fail(EXIT_CONFIG, `${OPTIONS_FILE} is not valid JSON`); }
}

function prepareData() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* reported below */ }
  if (process.getuid() === 0) {
    const r = takeOwnership(DATA_DIR, RUN_UID, RUN_GID);
    if (r.changed) log(`data: ownership of ${r.changed} entr${r.changed === 1 ? 'y' : 'ies'} in ${DATA_DIR} given to uid ${RUN_UID}`);
    if (r.failed) log(`data: WARNING ownership of ${r.failed} entr${r.failed === 1 ? 'y' : 'ies'} could not be changed`);
    process.setgroups([RUN_GID]);
    process.setgid(RUN_GID);
    process.setuid(RUN_UID);
  }
  if (process.getuid() === 0 || process.geteuid() === 0) fail(EXIT_DATA, 'could not drop root privileges');
  if (!isWritable(DATA_DIR)) fail(EXIT_DATA, `${DATA_DIR} is not writable by uid ${process.getuid()}; upstream cannot store its database`);
  log(`running as uid ${process.getuid()} gid ${process.getgid()}`);
}

// Warns when a port that should be loopback-only answers on another address.
async function checkLoopbackOnly(ports) {
  const addresses = Object.values(os.networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4').map((i) => i.address);
  for (const port of ports) {
    for (const host of addresses) {
      const open = await new Promise((resolve) => {
        const s = net.connect({ host, port, timeout: 1000 });
        s.once('connect', () => { s.destroy(); resolve(true); });
        s.once('error', () => resolve(false));
        s.once('timeout', () => { s.destroy(); resolve(false); });
      });
      if (open) log(`WARNING port ${port} answers on ${host} although it should be loopback-only`);
    }
  }
}

async function waitHealthy(isStopping) {
  for (let i = 0; i < 120 && !isStopping(); i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${WEB_PORT}/sante`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  log('Live Mesh Map App starting');
  const options = readOptions();

  // ---- Supervisor -----------------------------------------------------------
  const token = process.env.SUPERVISOR_TOKEN || '';
  const wantsService = options && options.ha_mqtt_enabled !== false && !String(options.ha_mqtt_url || '').trim();
  let mqttService = null;
  if (!token) {
    log('no Supervisor token: running without Home Assistant services');
  } else if (wantsService) {
    const r = await supervisorGet(SUPERVISOR_URL, token, '/services/mqtt');
    if (r.ok) mqttService = r.data;
    else log(`MQTT service not available from Home Assistant (${r.reason})`);
  }

  let published;
  if (process.env.LMM_PUBLISHED_PORTS !== undefined) {
    published = parsePortList(process.env.LMM_PUBLISHED_PORTS);
  } else if (token) {
    const r = await supervisorGet(SUPERVISOR_URL, token, '/addons/self/info');
    published = r.ok ? publishedPorts(r.data) : [];
    if (!r.ok) log(`port mapping not available from Home Assistant (${r.reason}): optional ports stay closed`);
  } else {
    published = [];
  }
  const loopbackPorts = [WEB_PORT, AGENTS_PORT].filter((p) => !published.includes(p));

  // ---- Options -> upstream environment --------------------------------------
  const built = buildEnvironment({ options, mqttService });
  for (const w of built.warnings) log('WARNING', redactText(w));
  if (built.errors.length) {
    for (const e of built.errors) console.error(new Date().toISOString(), '[lmm] ERROR', redactText(e));
    fail(EXIT_CONFIG, 'invalid configuration: fix the App options and start again');
  }
  for (const i of built.info) log(i);
  log('upstream environment:', JSON.stringify(redact(built.env)));
  log(`port ${WEB_PORT} (direct web access): ${loopbackPorts.includes(WEB_PORT) ? 'closed, reachable through Home Assistant only' : 'OPEN on the mapped host port'}`);
  log(`port ${AGENTS_PORT} (remote agents): ${loopbackPorts.includes(AGENTS_PORT) ? 'closed' : 'OPEN on the mapped host port'}`);

  // ---- Data directory and privileges ----------------------------------------
  prepareData();

  // ---- Ingress listener -------------------------------------------------------
  const allow = parseAllowList(process.env.LMM_INGRESS_ALLOW, SUPERVISOR_INGRESS_ADDRESS);
  if (allow.includes('*')) log('WARNING ingress accepts connections from ANY address (LMM_INGRESS_ALLOW=*): for testing only');
  const proxy = createIngressProxy({ targetPort: WEB_PORT, allow, log });
  await proxy.listen(INGRESS_PORT);
  log(`ingress listening on port ${INGRESS_PORT}, allowed source: ${allow.join(', ')}`);

  // ---- Upstream server --------------------------------------------------------
  const childEnv = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    HOME: '/home/node',
    TZ: process.env.TZ || 'UTC',
    ...built.env,
    LMM_LOOPBACK_PORTS: loopbackPorts.join(','),
  };

  let child = null;
  let stopping = false;
  let killTimer = null;
  const restarts = [];

  const finish = async (code) => {
    clearTimeout(killTimer);
    await proxy.close();
    log(`stopped (exit code ${code})`);
    process.exit(code);
  };

  const start = () => {
    child = spawn(process.execPath, ['--require', '/opt/lmm/bind-guard.cjs', 'src/server.js'], { cwd: APP_DIR, env: childEnv, stdio: 'inherit' });
    log(`upstream started (pid ${child.pid})`);
    child.on('error', (e) => { log(`upstream could not be started (${e.code || e.message})`); finish(1); });
    child.on('exit', (code, signal) => {
      const result = code !== null ? code : 128 + (os.constants.signals[signal] || 0);
      if (stopping) return finish(result);
      if (code === 0) {
        // Upstream exits with 0 to apply saved settings or a restored backup
        // and expects to be started again.
        const now = Date.now();
        restarts.push(now);
        while (restarts.length && now - restarts[0] > 600000) restarts.shift();
        if (restarts.length > 10) { log('upstream asked for more than 10 restarts in 10 minutes: giving up'); return finish(EXIT_RESTART_LOOP); }
        log('upstream exited to apply new settings: restarting it');
        setTimeout(() => { if (!stopping) start(); else finish(0); }, 1000);
        return;
      }
      log(`upstream exited unexpectedly (${signal ? 'signal ' + signal : 'code ' + code})`);
      finish(result);
    });
    waitHealthy(() => stopping || child.exitCode !== null).then(async (ok) => {
      if (stopping) return;
      if (!ok) { log('WARNING upstream did not answer its health check within 60 s'); return; }
      log(`upstream is healthy (http://127.0.0.1:${WEB_PORT}/sante)`);
      await checkLoopbackOnly(loopbackPorts);
    });
  };

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    log(`${signal} received: stopping upstream`);
    if (!child || child.exitCode !== null || child.signalCode !== null) return finish(0);
    child.kill(signal);
    killTimer = setTimeout(() => { log(`upstream still running after ${STOP_GRACE_MS} ms: killing it`); child.kill('SIGKILL'); }, STOP_GRACE_MS);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  start();
}

main().catch((e) => fail(1, `startup failed: ${redactText(e && e.message ? e.message : String(e))}`));
