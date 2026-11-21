// SIMULATED Home Assistant Ingress gateway for local browser tests.
//
// This is NOT Home Assistant. It reproduces the parts of the real request path
// (browser -> Home Assistant Core /api/hassio_ingress/<token>/... -> Supervisor
// -> App ingress port) that matter to a web application behind a prefix:
//
//   * only URLs below /api/hassio_ingress/<token>/ reach the App; the prefix
//     is stripped, the remainder is forwarded to the App's ingress port;
//   * request headers added like Core does (homeassistant/components/hassio/
//     ingress.py, checked at core commit e17c7a6, 2026-11-20):
//     X-Ingress-Path, X-Hass-Source, X-Forwarded-For/-Host/-Proto; and like
//     Supervisor does (supervisor/api/ingress.py, commit fe91b8d):
//     X-Remote-User-Id/-Name/-Display-Name;
//   * Accept-Encoding is removed from the request (Core compresses at the
//     border), hop-by-hop headers are not forwarded;
//   * WebSocket upgrades below the prefix are tunnelled;
//   * cookies pass through unchanged in both directions.
//
// Known differences from the real thing (see docs/testing/test-plan.md):
// no Home Assistant authentication or ingress session cookie, no frontend
// iframe, plain HTTP, raw TCP tunnelling of WebSockets instead of message
// re-framing, no 16 MiB WebSocket message limit, no response re-compression.
//
// Anything requested OUTSIDE the prefix is what would hit Home Assistant
// itself in a real installation. The proxy answers 404 and records it; the
// list is served at /__harness/escapes for the tests.
//
// Environment: TARGET_HOST, TARGET_PORT, INGRESS_TOKEN, LISTEN_PORT (8123).
import http from 'node:http';
import net from 'node:net';

const TARGET_HOST = process.env.TARGET_HOST || 'app';
const TARGET_PORT = Number(process.env.TARGET_PORT || 8099);
const TOKEN = process.env.INGRESS_TOKEN || 'simulatedtoken';
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 8123);
const PREFIX = `/api/hassio_ingress/${TOKEN}`;

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const REQUEST_DROP = new Set([...HOP_BY_HOP, 'accept-encoding', 'x-remote-user-id', 'x-remote-user-name', 'x-remote-user-display-name', 'x-ingress-path', 'x-hass-source']);

const escapes = [];      // since the last /__harness/reset
const allEscapes = [];   // since the gateway started
const stats = { proxied: 0, websockets: 0, errors: 0 };

function peerOf(socket) {
  return String(socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function forwardHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (!REQUEST_DROP.has(name)) headers[name] = value;
  }
  const prior = req.headers['x-forwarded-for'];
  headers['x-forwarded-for'] = prior ? `${prior}, ${peerOf(req.socket)}` : peerOf(req.socket);
  headers['x-forwarded-host'] = req.headers['x-forwarded-host'] || req.headers.host || '';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http';
  headers['x-ingress-path'] = PREFIX;
  headers['x-hass-source'] = 'core.ingress';
  headers['x-remote-user-id'] = '00000000000000000000000000000001';
  headers['x-remote-user-name'] = 'simulated-admin';
  headers['x-remote-user-display-name'] = 'Simulated Admin';
  return headers;
}

// Path below the prefix ("/x?y"), or null when the URL is outside of it.
function innerPath(url) {
  if (url === PREFIX) return '/';
  if (url.startsWith(`${PREFIX}/`) || url.startsWith(`${PREFIX}?`)) {
    const rest = url.slice(PREFIX.length);
    return rest.startsWith('?') ? `/${rest}` : rest;
  }
  return null;
}

function recordEscape(req, kind) {
  const entry = { kind, method: req.method, url: req.url, referer: req.headers.referer || '' };
  escapes.push(entry);
  allEscapes.push(entry);
  console.log(`ESCAPE ${kind} ${req.method} ${req.url}`);
}

const server = http.createServer((req, res) => {
  if (req.url === '/__harness/ready') { res.writeHead(200).end('ok'); return; }
  if (req.url === '/__harness/escapes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ prefix: PREFIX, escapes, allEscapes, stats }));
    return;
  }
  if (req.url === '/__harness/reset') { escapes.length = 0; res.writeHead(200).end('ok'); return; }

  const path = innerPath(req.url || '');
  if (path === null) {
    recordEscape(req, 'http');
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('simulated Home Assistant: this URL is outside the ingress prefix\n');
    return;
  }
  const upstream = http.request({ host: TARGET_HOST, port: TARGET_PORT, method: req.method, path, headers: forwardHeaders(req), agent: false }, (up) => {
    stats.proxied++;
    const headers = {};
    for (const [name, value] of Object.entries(up.headers)) if (!HOP_BY_HOP.has(name)) headers[name] = value;
    res.writeHead(up.statusCode || 502, headers);
    up.pipe(res);
  });
  upstream.on('error', (err) => {
    stats.errors++;
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`simulated ingress: bad gateway (${err.code || err.message})\n`);
  });
  req.pipe(upstream);
});

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => {});
  const path = innerPath(req.url || '');
  if (path === null) {
    recordEscape(req, 'websocket');
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  const upstream = net.connect({ host: TARGET_HOST, port: TARGET_PORT }, () => {
    stats.websockets++;
    const headers = forwardHeaders(req);
    // The WebSocket handshake headers must survive the hop.
    headers.connection = 'Upgrade';
    headers.upgrade = req.headers.upgrade || 'websocket';
    const lines = [`${req.method} ${path} HTTP/1.1`];
    for (const [name, value] of Object.entries(headers)) {
      for (const v of [].concat(value)) lines.push(`${name}: ${v}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => { stats.errors++; socket.destroy(); });
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`simulated ingress gateway on :${LISTEN_PORT}, ${PREFIX}/ -> http://${TARGET_HOST}:${TARGET_PORT}/`);
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
