import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverSegments, stripLeadingSlashes, findResiduals, transformScript, transformHtml, transformManifest, transformServer, transformTree, TARGETED, BASE_EXPR,
} from '../../live-mesh-map/build/relativize.mjs';

const SEGS = ['api', 'vendor', 'ws', 'agent', 'rejoindre', 'publique', 'app.js', 'style.css', 'symbole.svg', 'sw.js'];

test('discoverSegments reads Express routes and static file names', () => {
  const server = "app.get(['/', '/index.html'], x);\napp.get('/api/config', x);\napp.use('/vendor/leaflet', y);\napp.post(`/api/x/:id`, z);\napp.get('/rejoindre', p);\napp.get('/sante', h);";
  const segs = discoverSegments(server, ['app.js', 'style.css']);
  for (const s of ['api', 'vendor', 'rejoindre', 'sante', 'index.html', 'app.js', 'style.css', 'ws', 'agent']) assert.ok(segs.includes(s), s);
  assert.ok(!segs.includes(''), 'the root route adds no empty segment');
});

test('generic rule strips the slash of literals that start a URL', () => {
  const src = "api('/api/a'); postJson(`/api/b/${id}`, {}); x = \"/api/c\"; h = '<a href=\"/agent/f.exe\">'; fetch(c ? '/api/d' : '/api/e'); return '/vendor/x.js';";
  const r = stripLeadingSlashes(src, SEGS);
  assert.equal(r.count, 7);
  assert.equal(r.text, "api('api/a'); postJson(`api/b/${id}`, {}); x = \"api/c\"; h = '<a href=\"agent/f.exe\">'; fetch(c ? 'api/d' : 'api/e'); return 'vendor/x.js';");
});

test('generic rule leaves alone: concatenations, other paths, regular expressions, longer names', () => {
  const src = "a = base + '/api/x'; b = h.startsWith('/dev/'); c = /\\/api\\/x/.test(u); d = '/apiary'; e = '/api-docs'; f = s.replace(/\"/g, ''); g = '//cdn.example/api/x';";
  const r = stripLeadingSlashes(src, SEGS);
  assert.equal(r.count, 0);
  assert.equal(r.text, src);
});

test('dictionary template is recognised', () => {
  const r = stripLeadingSlashes('fetch(`/i18n-${l}.json`)', SEGS);
  assert.equal(r.text, 'fetch(`i18n-${l}.json`)');
});

test('residual scan reports what the rules did not cover', () => {
  assert.deepEqual(findResiduals('x.js', "ok('api/a'); r = /\\/api\\//; // see /api/doc\n  // whole line about /api/x\n t = `rel/api/x`; u = './vendor/a';", SEGS), []);
  const hits = findResiduals('x.js', "a = base + '/api/x';\nb = `${location.origin}/rejoindre`;", SEGS);
  assert.equal(hits.length, 2);
  assert.match(hits[0], /^x\.js:1:/);
  assert.match(hits[1], /^x\.js:2:/);
});

test('residual allowlist is tied to the text right before the slash', () => {
  assert.deepEqual(findResiduals('app.js', "lien(base + '/api/export')", SEGS), []);
  assert.equal(findResiduals('app.js', "lien(other + '/api/export')", SEGS).length, 1);
  assert.equal(findResiduals('other.js', "lien(base + '/api/export')", SEGS).length, 1, 'allowlist is per file');
});

test('targeted rule with the wrong number of matches is an error', () => {
  const none = transformScript('topologie.js', 'nothing here', SEGS);
  assert.equal(none.errors.length, 1);
  assert.match(none.errors[0], /matched 0 time\(s\), expected 1/);
  const twice = transformScript('topologie.js', "a(location.host + '/ws'); b(location.host + '/ws');", SEGS);
  assert.equal(twice.errors.length, 1);
});

test('WebSocket URLs keep the page directory', () => {
  const r = transformScript('topologie.js', "const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');", SEGS);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.residuals, []);
  assert.ok(r.text.includes(`location.host + ${BASE_EXPR} + 'ws'`));
  // the expression itself: directory of the current page
  const dir = (pathname) => pathname.replace(/[^/]*$/, '');
  assert.equal(dir('/'), '/');
  assert.equal(dir('/topologie.html'), '/');
  assert.equal(dir('/api/hassio_ingress/tok/'), '/api/hassio_ingress/tok/');
  assert.equal(dir('/api/hassio_ingress/tok/publique'), '/api/hassio_ingress/tok/');
});

test('every targeted replacement is valid JavaScript text and differs from its source', () => {
  for (const [file, rules] of Object.entries(TARGETED)) {
    for (const rule of rules) {
      assert.notEqual(rule.find, rule.put, `${file}: ${rule.why}`);
      assert.ok(Number.isInteger(rule.count) && rule.count > 0, `${file}: ${rule.why}`);
    }
  }
});

test('demo-mode same-origin test accepts relative URLs and rejects foreign ones', () => {
  const rule = TARGETED['app.js'].find((r) => r.why.includes('same-origin'));
  const expr = rule.put.replace('const meme = ', 'return ').replace(' || u.startsWith(location.origin);', ';');
  const meme = new Function('u', expr);
  for (const u of ['api/x', '/api/x', './x', '?q=1']) assert.equal(meme(u), true, u);
  for (const u of ['https://tiles.example/1/2/3.png', '//cdn.example/x', 'data:text/plain,x']) assert.equal(meme(u), false, u);
});

test('HTML: attributes made relative and local assets versioned', () => {
  const html = '<link rel="stylesheet" href="/style.css"><link href="/vendor/leaflet/leaflet.css"><script src="/app.js"></script><script src="rel.js"></script><a href="https://example.org/x.js">x</a>';
  const r = transformHtml('index.html', html, SEGS, '9.9.9');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.residuals, []);
  assert.equal(r.text, '<link rel="stylesheet" href="style.css?v=9.9.9"><link href="vendor/leaflet/leaflet.css"><script src="app.js?v=9.9.9"></script><script src="rel.js?v=9.9.9"></script><a href="https://example.org/x.js">x</a>');
});

test('manifest: start_url, scope and icons become relative', () => {
  const out = JSON.parse(transformManifest(JSON.stringify({ name: 'n', start_url: '/?source=pwa', scope: '/', icons: [{ src: '/icone-192.png' }, { src: 'https://x/y.png' }] })));
  assert.equal(out.start_url, './?source=pwa');
  assert.equal(out.scope, './');
  assert.equal(out.icons[0].src, 'icone-192.png');
  assert.equal(out.icons[1].src, 'https://x/y.png');
  assert.equal(out.name, 'n');
});

test('server: coverage image URL made relative, missing pattern is an error', () => {
  const r = transformServer('res.json({ image: `/api/relief/couverture/${r.id}.png` });');
  assert.equal(r.count, 1);
  assert.deepEqual(r.errors, []);
  assert.ok(r.text.includes('image: `api/relief/couverture/'));
  assert.equal(transformServer('nothing').errors.length, 1);
});

test('transformTree: reports missing files and leaves the service worker alone', () => {
  const files = new Map([
    ['src/server.js', "app.get('/api/x', h); res.json({ image: `/api/relief/couverture/${id}.png` });"],
    ['public/sw.js', "const COQUILLE = ['/', '/app.js'];"],
    ['public/extra.js', "api('/api/x');"],
    ['public/manifest.webmanifest', '{"start_url":"/","scope":"/","icons":[]}'],
  ]);
  const r = transformTree(files, '1.0.0');
  assert.ok(!r.changed.has('public/sw.js'));
  assert.equal(r.changed.get('public/extra.js'), "api('api/x');");
  assert.ok(r.changed.has('src/server.js'));
  assert.ok(r.changed.has('public/manifest.webmanifest'));
  assert.ok(r.errors.some((e) => /public\/app\.js: file missing/.test(e)), 'known upstream files must be present');
});
