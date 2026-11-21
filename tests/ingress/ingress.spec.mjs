// SIMULATED INGRESS browser tests -- not a Home Assistant acceptance test.
//
// The page is loaded through tests/ingress/proxy.mjs, which serves the App
// below /api/hassio_ingress/<token>/ like Home Assistant does. These tests
// prove that the web UI works below a path prefix and does not address
// anything outside of it. They do not prove behaviour inside the real Home
// Assistant frontend (iframe, authentication, ingress session, HTTPS).
//
// Environment (set by run.sh):
//   INGRESS_PREFIX   /api/hassio_ingress/<token>
//   SETUP_CODE       code accepted by the first-run wizard ('' = unknown)
//   LMM_MODE         strict (default) | baseline (report escapes, do not fail)
//   EXTERNAL_ALLOW   comma-separated extra external hosts the page may contact
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = process.env.INGRESS_PREFIX || '/api/hassio_ingress/simulatedtoken';
const BASE = `${PREFIX}/`;
const MODE = process.env.LMM_MODE || 'strict';
const SETUP_CODE = process.env.SETUP_CODE || '';
const OUT = process.env.PW_OUTPUT_DIR || '/artifacts/playwright';

// External hosts the upstream UI is known to use for map tiles and overlays
// (found in upstream public/app.js and src/config.js at v1.5.14). Requests to
// them are recorded and then aborted: the tests never load the internet.
const EXTERNAL_ALLOW = new Set([
  'server.arcgisonline.com', 'data.geopf.fr', 'tile.openstreetmap.org', 'opentopomap.org',
  'a.tile.opentopomap.org', 'b.tile.opentopomap.org', 'c.tile.opentopomap.org',
  'api.rainviewer.com', 'tilecache.rainviewer.com', 'api.open-meteo.com', 'build.protomaps.com',
  ...(process.env.EXTERNAL_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

// Records every request the page makes and classifies it.
async function watch(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const seen = { inside: [], escaped: [], external: [], externalUnlisted: [], websockets: [], apiResponses: [], pageErrors: [], consoleErrors: [] };
  const classify = (raw) => {
    let u;
    try { u = new URL(raw); } catch { return 'ignored'; }
    if (!/^(https?|wss?):$/.test(u.protocol)) return 'ignored';
    const sameHost = u.host === new URL(origin).host;
    if (sameHost) return u.pathname === PREFIX || u.pathname.startsWith(BASE) ? 'inside' : 'escaped';
    return EXTERNAL_ALLOW.has(u.hostname) ? 'external' : 'externalUnlisted';
  };
  await page.route('**/*', (route) => {
    const kind = classify(route.request().url());
    if (kind === 'external' || kind === 'externalUnlisted') return route.abort('blockedbyclient');
    return route.continue();
  });
  page.on('request', (r) => {
    const kind = classify(r.url());
    if (kind !== 'ignored') seen[kind].push(`${r.method()} ${r.url().replace(origin, '')}`);
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === origin && u.pathname.startsWith(`${BASE}api/`)) seen.apiResponses.push({ status: r.status(), path: u.pathname.slice(PREFIX.length) });
  });
  page.on('websocket', (ws) => {
    const entry = { url: ws.url(), kind: classify(ws.url()), frames: 0, closed: false, error: null };
    seen.websockets.push(entry);
    ws.on('framereceived', () => { entry.frames++; });
    ws.on('close', () => { entry.closed = true; });
    ws.on('socketerror', (e) => { entry.error = String(e); });
    if (entry.kind === 'escaped') seen.escaped.push(`WS ${ws.url().replace(/^ws/, 'http').replace(origin, '')}`);
  });
  page.on('pageerror', (e) => seen.pageErrors.push(String(e.message || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') seen.consoleErrors.push(m.text().slice(0, 300)); });
  return seen;
}

const unique = (list) => [...new Set(list)].sort();
// "host: count" for a list of "METHOD url" entries (keeps evidence files small).
const hostCounts = (list) => {
  const counts = {};
  for (const entry of list) { const h = new URL(entry.split(' ')[1]).hostname; counts[h] = (counts[h] || 0) + 1; }
  return counts;
};

// Writes the evidence for one test to the artifacts directory.
function record(testInfo, name, data) {
  const dir = path.join(OUT, 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${testInfo.project.name}-${name}.json`), JSON.stringify(data, null, 2));
}

// In baseline mode an escape is evidence, not a failure.
function expectNoEscape(testInfo, name, seen) {
  const escaped = unique(seen.escaped);
  record(testInfo, name, { mode: MODE, prefix: PREFIX, escaped, inside: unique(seen.inside).length, externalBlockedByHarness: hostCounts(seen.external), externalUnlisted: unique(seen.externalUnlisted), websockets: seen.websockets, pageErrors: seen.pageErrors, consoleErrors: unique(seen.consoleErrors).slice(0, 30) });
  testInfo.annotations.push({ type: 'escaped-requests', description: `${escaped.length}: ${escaped.slice(0, 12).join(' | ')}` });
  if (MODE === 'baseline') return;
  expect(escaped, 'requests that left the ingress prefix').toEqual([]);
}

async function gatewayEscapes(request) {
  const r = await request.get('/__harness/escapes');
  return (await r.json()).escapes;
}

async function openMap(page) {
  const response = await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  expect(response && response.status(), 'status of the map page').toBe(200);
  return response;
}

test.describe('simulated Ingress', () => {
  test.beforeEach(async ({ request }) => { await request.get('/__harness/reset'); });

  test('initial map load stays below the prefix', async ({ page, baseURL, request }, testInfo) => {
    const seen = await watch(page, baseURL);
    await openMap(page);
    if (MODE !== 'baseline') {
      await expect(page.locator('#carte')).toBeVisible();
      // Leaflet has initialised: its container class and panes exist.
      await expect(page.locator('#carte.leaflet-container, #carte .leaflet-container').first()).toBeVisible();
    }
    await page.waitForTimeout(6000); // let deferred API calls and the WebSocket start
    await page.screenshot({ path: path.join(OUT, `map-${testInfo.project.name}.png`) });
    const fromGateway = await gatewayEscapes(request);
    testInfo.annotations.push({ type: 'gateway-escapes', description: String(fromGateway.length) });
    record(testInfo, 'gateway-escapes', fromGateway);
    expectNoEscape(testInfo, 'initial-load', seen);
    if (MODE !== 'baseline') {
      expect(fromGateway, 'requests the gateway received outside the prefix').toEqual([]);
      expect(seen.pageErrors, 'uncaught exceptions in the page').toEqual([]);
      expect(unique(seen.externalUnlisted), 'external hosts not on the allow-list').toEqual([]);
      expect(seen.inside.length, 'number of requests below the prefix').toBeGreaterThan(10);
    }
  });

  test('API calls succeed below the prefix', async ({ page, baseURL }, testInfo) => {
    const seen = await watch(page, baseURL);
    await openMap(page);
    await page.waitForTimeout(6000);
    const api = seen.apiResponses;
    record(testInfo, 'api', api);
    testInfo.annotations.push({ type: 'api-responses', description: `${api.length} responses, statuses ${unique(api.map((a) => String(a.status))).join(',')}` });
    if (MODE === 'baseline') return;
    expect(api.length, 'number of API responses below the prefix').toBeGreaterThan(3);
    // A visitor without an account may get 401/403 on member endpoints; 404
    // and 5xx would mean the path is wrong or the App is broken.
    const bad = api.filter((a) => a.status === 404 || a.status >= 500);
    expect(bad, 'API responses with 404 or 5xx').toEqual([]);
    const direct = await page.request.get(`${BASE}api/installation`);
    expect(direct.status()).toBe(200);
    expect(await direct.json()).toHaveProperty('requise');
  });

  test('live WebSocket connects below the prefix', async ({ page, baseURL }, testInfo) => {
    const seen = await watch(page, baseURL);
    await openMap(page);
    await page.waitForTimeout(8000);
    record(testInfo, 'websocket', seen.websockets);
    testInfo.annotations.push({ type: 'websockets', description: seen.websockets.map((w) => `${w.kind} ${new URL(w.url).pathname} closed=${w.closed}`).join(' | ') || 'none' });
    if (MODE === 'baseline') return;
    const live = seen.websockets.filter((w) => w.kind === 'inside' && new URL(w.url).pathname === `${BASE}ws`);
    expect(live.length, 'WebSocket connections to <prefix>/ws').toBeGreaterThan(0);
    expect(live.some((w) => !w.closed && !w.error), 'a WebSocket below the prefix is still open').toBe(true);
    expect(seen.websockets.filter((w) => w.kind !== 'inside'), 'WebSockets outside the prefix').toEqual([]);
  });

  test('reload keeps working', async ({ page, baseURL }, testInfo) => {
    const seen = await watch(page, baseURL);
    await openMap(page);
    await page.waitForTimeout(3000);
    const response = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(response.status()).toBe(200);
    expect(new URL(page.url()).pathname.startsWith(BASE), 'still below the prefix after reload').toBe(true);
    if (MODE !== 'baseline') await expect(page.locator('#carte')).toBeVisible();
    await page.waitForTimeout(4000);
    expectNoEscape(testInfo, 'reload', seen);
    if (MODE !== 'baseline') expect(seen.pageErrors).toEqual([]);
  });

  test('secondary pages and the web manifest resolve below the prefix', async ({ page, baseURL }, testInfo) => {
    const seen = await watch(page, baseURL);
    for (const p of ['topologie.html', 'publique', 'relief3d.html']) {
      const r = await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
      testInfo.annotations.push({ type: 'page', description: `${p} -> ${r.status()}` });
      if (MODE !== 'baseline') expect(r.status(), `status of ${p}`).toBeLessThan(400);
      await page.waitForTimeout(2500);
    }
    const manifest = await page.request.get(`${BASE}manifest.webmanifest`);
    if (manifest.ok()) {
      const m = await manifest.json();
      const manifestUrl = new URL(`${BASE}manifest.webmanifest`, baseURL);
      const targets = [m.start_url, m.scope, ...(m.icons || []).map((i) => i.src)].filter(Boolean).map((t) => new URL(t, manifestUrl).pathname);
      const outside = targets.filter((t) => !t.startsWith(BASE));
      record(testInfo, 'manifest', { targets, outside });
      testInfo.annotations.push({ type: 'manifest-outside-prefix', description: outside.join(' ') || 'none' });
      if (MODE !== 'baseline') expect(outside, 'web manifest URLs outside the prefix').toEqual([]);
    }
    const scopes = await page.evaluate(async () => (navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope) : []));
    testInfo.annotations.push({ type: 'service-worker-scopes', description: scopes.join(' ') || 'none' });
    if (MODE !== 'baseline') expect(scopes.filter((s) => !new URL(s).pathname.startsWith(BASE)), 'service worker scopes outside the prefix').toEqual([]);
    expectNoEscape(testInfo, 'secondary-pages', seen);
  });
});

// Account tests change server state (they create the administrator), so they
// run once, in the desktop project, after the read-only tests above.
test.describe('simulated Ingress: setup, login and session', () => {
  test.describe.configure({ mode: 'serial' });
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const user = 'ingresstest';

  test('setup wizard is protected, session cookie is scoped to the prefix', async ({ page, baseURL, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'state-changing test runs once');
    const seen = await watch(page, baseURL);
    await openMap(page);
    const api = (p, init) => page.evaluate(async ([url, i]) => {
      const r = await fetch(url, i);
      let body = null;
      try { body = await r.json(); } catch { /* not JSON */ }
      return { status: r.status, body };
    }, [`${BASE}${p}`, init]);
    const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const before = await api('api/installation');
    testInfo.annotations.push({ type: 'installation', description: JSON.stringify({ requise: before.body && before.body.requise, codeRequis: before.body && before.body.codeRequis, reseauLocal: before.body && before.body.reseauLocal }) });
    expect(before.status).toBe(200);
    test.skip(before.body.requise !== true, 'an administrator already exists in this data volume');
    expect(before.body.codeRequis, 'the wizard must require a setup code for Ingress users').toBe(true);

    const wrong = await post('api/installation', { code: 'WRONG-CODE', compte: { identifiant: user, indicatif: '', motDePasse: password } });
    expect(wrong.status, 'wizard with a wrong code').toBe(403);

    test.skip(!SETUP_CODE, 'no setup code available to the harness');
    const created = await post('api/installation', { code: SETUP_CODE, compte: { identifiant: user, indicatif: '', motDePasse: password } });
    expect(created.status, `wizard with the right code: ${JSON.stringify(created.body)}`).toBe(200);

    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'gaulix_session');
    expect(session, 'session cookie set after setup').toBeTruthy();
    testInfo.annotations.push({ type: 'session-cookie', description: `path=${session.path} httpOnly=${session.httpOnly} sameSite=${session.sameSite} secure=${session.secure}` });
    expect(session.httpOnly).toBe(true);
    if (MODE !== 'baseline') {
      // With Path=/ the cookie would be sent to Home Assistant itself and to
      // every other App served from the same origin.
      expect(session.path, 'session cookie path').toBe(BASE);
      const outside = await context.cookies(new URL('/api/', baseURL).toString());
      expect(outside.filter((c) => c.name === 'gaulix_session'), 'session cookie visible outside the prefix').toEqual([]);
    }

    const me = await api('api/compte');
    expect(me.body && me.body.identifiant, 'logged in after setup').toBe(user);

    await page.reload({ waitUntil: 'domcontentloaded' });
    expect((await api('api/compte')).body.identifiant, 'still logged in after reload').toBe(user);

    const out = await post('api/deconnexion', {});
    expect(out.status).toBeLessThan(400);
    expect((await api('api/compte')).body, 'logged out').toBeFalsy();

    const bad = await post('api/connexion', { identifiant: user, motDePasse: 'not-the-password' });
    expect(bad.status, 'login with a wrong password').toBeGreaterThanOrEqual(400);
    const good = await post('api/connexion', { identifiant: user, motDePasse: password });
    expect(good.status, 'login with the right password').toBe(200);
    expect((await api('api/compte')).body.role).toBe('admin');
    await page.waitForTimeout(3000); // administrator UI loads more data
    expectNoEscape(testInfo, 'session', seen);
  });

  test('Home Assistant identity headers alone do not log anyone in', async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'runs once');
    // The simulated gateway adds X-Remote-User-* to every request, as the real
    // one does. A fresh browser context without the App's own session cookie
    // must still be an anonymous visitor.
    await watch(page, baseURL);
    await openMap(page);
    const r = await page.request.get(`${BASE}api/compte`);
    expect(r.status()).toBe(200);
    expect(await r.json(), 'anonymous despite X-Remote-User-* headers').toBeFalsy();
    const admin = await page.request.get(`${BASE}api/comptes`);
    testInfo.annotations.push({ type: 'admin-endpoint-anonymous', description: String(admin.status()) });
    expect([401, 403, 404]).toContain(admin.status());
  });
});
