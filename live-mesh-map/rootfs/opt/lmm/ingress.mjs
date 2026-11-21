// Ingress listener: a small reverse proxy in front of the upstream web server.
//
// It exists for three reasons, none of which upstream can do by itself:
//   1. accept connections only from the Home Assistant ingress gateway;
//   2. scope the upstream session cookie (issued with Path=/) to this App's
//      ingress path, so it is not sent to Home Assistant or to other Apps
//      that share the same browser origin;
//   3. mark requests as proxied (X-Forwarded-For) so upstream never treats an
//      ingress user as a "local network" visitor.
//
// It does not rewrite response bodies and does not authenticate anybody:
// upstream accounts and roles apply unchanged behind it.

import http from 'node:http';
import net from 'node:net';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'upgrade']);

export function normalizeAddress(address) {
  return String(address || '').replace(/^::ffff:/i, '').toLowerCase();
}

// allow: array of literal addresses, or ['*'] for the documented test override.
export function isAllowed(remoteAddress, allow) {
  if (!Array.isArray(allow) || allow.length === 0) return false;
  if (allow.includes('*')) return true;
  const a = normalizeAddress(remoteAddress);
  return a !== '' && allow.some((x) => normalizeAddress(x) === a);
}

export function parseAllowList(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return [fallback];
  return String(value).split(',').map((x) => x.trim()).filter(Boolean);
}

// The path Home Assistant serves this App under, or '' when the header is
// absent or does not look like a plain absolute path.
export function ingressPath(headerValue) {
  const v = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof v !== 'string' || v.length > 200) return '';
  return /^(\/[A-Za-z0-9._~-]+)+$/.test(v) ? v : '';
}

// "Path=/" becomes "Path=<ingress path>/"; any other cookie is left alone.
export function scopeCookie(cookie, base) {
  if (!base) return cookie;
  return String(cookie).replace(/;\s*path=\/(?=\s*(;|$))/i, `; Path=${base}/`);
}

export function forwardedFor(existing, remoteAddress) {
  const prior = Array.isArray(existing) ? existing.join(', ') : existing;
  const peer = normalizeAddress(remoteAddress) || 'unknown';
  return prior ? `${prior}, ${peer}` : peer;
}

export function createIngressProxy({ targetHost = '127.0.0.1', targetPort, allow, log = () => {} }) {
  let refused = 0;
  const noteRefusal = (address) => {
    // One line for the first refusals, then every 100th: enough to diagnose, no log flooding.
    refused++;
    if (refused <= 3 || refused % 100 === 0) log(`ingress: connection from ${normalizeAddress(address) || 'unknown'} refused (only the Home Assistant ingress gateway may connect; ${refused} refused so far)`);
  };

  const server = http.createServer((req, res) => {
    const peer = req.socket.remoteAddress;
    if (!isAllowed(peer, allow)) {
      noteRefusal(peer);
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end('Forbidden\n');
      return;
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k)) headers[k] = v;
    headers['x-forwarded-for'] = forwardedFor(req.headers['x-forwarded-for'], peer);
    const base = ingressPath(req.headers['x-ingress-path']);

    const up = http.request({ host: targetHost, port: targetPort, method: req.method, path: req.url, headers, agent: false }, (upRes) => {
      const out = {};
      for (const [k, v] of Object.entries(upRes.headers)) if (!HOP_BY_HOP.has(k)) out[k] = v;
      if (out['set-cookie']) out['set-cookie'] = [].concat(out['set-cookie']).map((c) => scopeCookie(c, base));
      res.writeHead(upRes.statusCode, upRes.statusMessage, out);
      upRes.pipe(res);
      upRes.on('error', () => res.destroy());
    });
    up.on('error', () => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5', 'Cache-Control': 'no-store' });
      res.end('Live Mesh Map is starting or restarting. Reload this page in a few seconds.\n');
    });
    req.on('aborted', () => up.destroy());
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    req.pipe(up);
  });

  // Uploads (backup restore) can be long behind a slow link; the gateway in
  // front already bounds idle connections.
  server.requestTimeout = 0;

  server.on('upgrade', (req, socket, head) => {
    const peer = socket.remoteAddress;
    socket.on('error', () => {});
    if (!isAllowed(peer, allow)) {
      noteRefusal(peer);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const up = net.connect({ host: targetHost, port: targetPort });
    up.on('error', () => {
      if (socket.writable && !up.bytesRead) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      else socket.destroy();
    });
    up.on('connect', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i].toLowerCase() === 'x-forwarded-for') continue;
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push(`X-Forwarded-For: ${forwardedFor(req.headers['x-forwarded-for'], peer)}`);
      up.write(lines.join('\r\n') + '\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    socket.on('close', () => up.destroy());
    up.on('close', () => socket.destroy());
  });

  server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });

  return {
    server,
    listen: (port, host = '0.0.0.0') => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
    }),
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
    refusedCount: () => refused,
  };
}
