import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createIngressProxy, isAllowed, parseAllowList, ingressPath, scopeCookie, forwardedFor, normalizeAddress } from '../../live-mesh-map/rootfs/opt/lmm/ingress.mjs';

test('isAllowed: only listed addresses, IPv4-mapped form accepted, empty list denies', () => {
  assert.equal(isAllowed('172.30.32.2', ['172.30.32.2']), true);
  assert.equal(isAllowed('::ffff:172.30.32.2', ['172.30.32.2']), true);
  assert.equal(isAllowed('172.30.32.3', ['172.30.32.2']), false);
  assert.equal(isAllowed('172.30.32.20', ['172.30.32.2']), false);
  assert.equal(isAllowed('127.0.0.1', ['172.30.32.2']), false);
  assert.equal(isAllowed(undefined, ['172.30.32.2']), false);
  assert.equal(isAllowed('10.1.1.1', []), false);
  assert.equal(isAllowed('10.1.1.1', undefined), false);
  assert.equal(isAllowed('10.1.1.1', ['*']), true);
  assert.equal(normalizeAddress('::FFFF:10.0.0.1'), '10.0.0.1');
});

test('parseAllowList: default when unset, explicit list otherwise', () => {
  assert.deepEqual(parseAllowList(undefined, '172.30.32.2'), ['172.30.32.2']);
  assert.deepEqual(parseAllowList('  ', '172.30.32.2'), ['172.30.32.2']);
  assert.deepEqual(parseAllowList('10.0.0.1, 10.0.0.2', 'x'), ['10.0.0.1', '10.0.0.2']);
  assert.deepEqual(parseAllowList('*', 'x'), ['*']);
});

test('ingressPath accepts plain absolute paths only', () => {
  assert.equal(ingressPath('/api/hassio_ingress/AbC-_123'), '/api/hassio_ingress/AbC-_123');
  for (const bad of [undefined, '', '/', 'api/x', '/a/', '/a//b', '/a;b', '/a b', '/a/../b?x', '/a\r\nSet-Cookie: x', '/' + 'a'.repeat(300)]) {
    assert.equal(ingressPath(bad), '', String(bad).slice(0, 20));
  }
});

test('scopeCookie rewrites Path=/ only', () => {
  const base = '/api/hassio_ingress/tok';
  assert.equal(scopeCookie('s=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=5', base), 's=1; HttpOnly; SameSite=Lax; Path=/api/hassio_ingress/tok/; Max-Age=5');
  assert.equal(scopeCookie('s=1; path=/', base), 's=1; Path=/api/hassio_ingress/tok/');
  assert.equal(scopeCookie('s=1; Path=/other', base), 's=1; Path=/other');
  assert.equal(scopeCookie('s=1; Path=/', ''), 's=1; Path=/');
  assert.equal(scopeCookie('s=Path=/; HttpOnly', base), 's=Path=/; HttpOnly', 'cookie value is not touched');
});

test('forwardedFor appends the peer', () => {
  assert.equal(forwardedFor(undefined, '::ffff:172.30.32.2'), '172.30.32.2');
  assert.equal(forwardedFor('1.2.3.4, 172.30.32.1', '172.30.32.2'), '1.2.3.4, 172.30.32.1, 172.30.32.2');
});

// ---- end-to-end on loopback ------------------------------------------------
function startUpstream() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url === '/login') {
        res.setHeader('Set-Cookie', ['gaulix_session=abc; HttpOnly; SameSite=Lax; Path=/; Max-Age=60', 'other=1; Path=/keep']);
        res.end('ok');
      } else if (req.url === '/stream') {
        res.write('a'); setTimeout(() => res.end('b'), 20);
      } else {
        res.writeHead(req.url === '/missing' ? 404 : 200, { 'Content-Type': 'text/plain', 'X-Up': 'yes' });
        res.end(`echo:${body}`);
      }
    });
  });
  server.on('upgrade', (req, socket) => {
    seen.push({ method: 'UPGRADE', url: req.url, headers: req.headers });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write(`pong:${d}`));
    socket.on('end', () => socket.end());
    socket.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function withProxy(allow, fn) {
  const up = await startUpstream();
  const logs = [];
  const proxy = createIngressProxy({ targetPort: up.port, allow, log: (m) => logs.push(m) });
  const addr = await proxy.listen(0, '127.0.0.1');
  try { await fn({ port: addr.port, up, logs, proxy }); } finally { await proxy.close(); up.server.closeAllConnections(); await new Promise((r) => up.server.close(r)); }
}

test('proxy forwards method, path, query, body and headers; adds X-Forwarded-For', async () => {
  await withProxy(['127.0.0.1'], async ({ port, up }) => {
    const r = await request(port, { method: 'POST', path: '/api/x?y=1&z=%2F', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9, 172.30.32.1', 'X-Ingress-Path': '/api/hassio_ingress/tok', Cookie: 'a=b' }, body: '{"k":1}' });
    assert.equal(r.status, 200);
    assert.equal(r.body, 'echo:{"k":1}');
    assert.equal(r.headers['x-up'], 'yes');
    const s = up.seen[0];
    assert.equal(s.method, 'POST');
    assert.equal(s.url, '/api/x?y=1&z=%2F');
    assert.equal(s.headers['x-forwarded-for'], '203.0.113.9, 172.30.32.1, 127.0.0.1');
    assert.equal(s.headers.cookie, 'a=b');
    assert.equal(s.headers['content-type'], 'application/json');
  });
});

test('proxy passes upstream status codes and streamed bodies through', async () => {
  await withProxy(['127.0.0.1'], async ({ port }) => {
    assert.equal((await request(port, { path: '/missing' })).status, 404);
    assert.equal((await request(port, { path: '/stream' })).body, 'ab');
  });
});

test('session cookie is scoped to the ingress path, others untouched', async () => {
  await withProxy(['127.0.0.1'], async ({ port }) => {
    const r = await request(port, { path: '/login', headers: { 'X-Ingress-Path': '/api/hassio_ingress/tok' } });
    assert.deepEqual(r.headers['set-cookie'], ['gaulix_session=abc; HttpOnly; SameSite=Lax; Path=/api/hassio_ingress/tok/; Max-Age=60', 'other=1; Path=/keep']);
    const plain = await request(port, { path: '/login' });
    assert.equal(plain.headers['set-cookie'][0], 'gaulix_session=abc; HttpOnly; SameSite=Lax; Path=/; Max-Age=60');
  });
});

test('a source address that is not allowed gets 403 and nothing reaches upstream', async () => {
  await withProxy(['172.30.32.2'], async ({ port, up, logs, proxy }) => {
    const r = await request(port, { path: '/api/secret', headers: { 'X-Forwarded-For': '172.30.32.2', 'X-Remote-User-Name': 'admin' } });
    assert.equal(r.status, 403);
    assert.equal(up.seen.length, 0);
    assert.equal(proxy.refusedCount(), 1);
    assert.match(logs[0], /refused/);
  });
});

test('upstream down gives 502, not a crash', async () => {
  const proxy = createIngressProxy({ targetPort: 1, allow: ['127.0.0.1'] });
  const addr = await proxy.listen(0, '127.0.0.1');
  try {
    const r = await request(addr.port, { path: '/' });
    assert.equal(r.status, 502);
    assert.match(r.body, /starting or restarting/);
  } finally { await proxy.close(); }
});

function upgrade(port, path, extra = '') {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n${extra}\r\n`));
    let buf = '';
    s.on('data', (d) => {
      buf += d;
      if (buf.includes('\r\n\r\n') && !s.sentPing) { s.sentPing = true; if (buf.startsWith('HTTP/1.1 101')) s.write('ping'); else { s.destroy(); resolve(buf); } }
      if (buf.includes('pong:ping')) { s.destroy(); resolve(buf); }
    });
    s.on('error', reject);
    setTimeout(() => { s.destroy(); resolve(buf); }, 2000).unref();
  });
}

test('WebSocket upgrade is tunnelled both ways with the original path', async () => {
  await withProxy(['127.0.0.1'], async ({ port, up }) => {
    const out = await upgrade(port, '/ws/module?nom=a%20b', 'X-Forwarded-For: 203.0.113.9\r\n');
    assert.match(out, /^HTTP\/1\.1 101/);
    assert.match(out, /pong:ping/);
    const s = up.seen.find((x) => x.method === 'UPGRADE');
    assert.equal(s.url, '/ws/module?nom=a%20b');
    assert.equal(s.headers['x-forwarded-for'], '203.0.113.9, 127.0.0.1');
  });
});

test('WebSocket upgrade from a source that is not allowed is refused', async () => {
  await withProxy(['172.30.32.2'], async ({ port, up }) => {
    const out = await upgrade(port, '/ws');
    assert.match(out, /^HTTP\/1\.1 403/);
    assert.equal(up.seen.length, 0);
  });
});
