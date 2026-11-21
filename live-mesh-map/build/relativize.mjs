// Build-time transformation of the pinned upstream web UI so that it works
// under a URL prefix (Home Assistant Ingress serves the App below
// /api/hassio_ingress/<token>/).
//
// Upstream (Live Mesh Map World, GPL-3.0, (c) its authors) addresses its own
// server with root-absolute URLs ("/api/...", "/app.js", "/ws"). Every page of
// the UI lives at depth 0 ("/", "/publique", "/topologie.html", ...), so the
// same URLs written *relative* ("api/...", "app.js") resolve correctly both
// at the root (direct access) and below any prefix. This script rewrites them.
//
// Checks, each of which fails the build:
//   * every targeted rule must match exactly its declared number of times;
//   * after rewriting, no root-absolute same-origin reference may remain
//     unless it is on the allowlist below.
//
// Usage: node relativize.mjs <appDir> <outDir>
//   <appDir>  upstream /app (contains public/, src/server.js, package.json)
//   <outDir>  receives only the files that changed, same relative layout

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Directory of the current page, always ending with "/": "/" at the root,
// "/api/hassio_ingress/<token>/" under Ingress.
export const BASE_EXPR = "location.pathname.replace(/[^/]*$/, '')";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// First path segments that belong to the upstream server: its Express routes
// plus the files it serves statically, plus the WebSocket endpoint and the
// bundled agent downloads (static sub-directory added by the upstream image).
export function discoverSegments(serverSource, publicNames) {
  const segs = new Set(['ws', 'agent']);
  const route = /\bapp\.(?:get|post|put|patch|delete|use|all)\(\s*\[?\s*((?:['"`]\/[^'"`]*['"`]\s*,?\s*)+)/g;
  for (const m of serverSource.matchAll(route)) {
    for (const p of m[1].matchAll(/['"`]\/([^'"`/?#:*(]+)/g)) segs.add(p[1]);
  }
  for (const n of publicNames) segs.add(n);
  return [...segs].filter(Boolean).sort((a, b) => b.length - a.length);
}

function segmentPattern(segments) {
  // "i18n-" is the stem of the dictionaries fetched as `/i18n-${lang}.json`.
  return `(?:(?:${segments.map(escapeRe).join('|')})(?![\\w-])|i18n-(?=\\$\\{))`;
}

// Targeted rewrites: places where upstream builds a URL from pieces or
// inspects a URL string, which the generic rule cannot fix. `count` is the
// exact number of matches expected in that file for the pinned version.
export const TARGETED = {
  'app.js': [
    { why: 'demo mode: same-origin test must accept relative URLs',
      find: "const meme = u.startsWith('/') || u.startsWith(location.origin);",
      put: "const meme = !/^([a-z][a-z0-9+.-]*:|\\/\\/)/i.test(u) || u.startsWith(location.origin);", count: 1 },
    { why: 'demo mode: API test must accept relative URLs',
      find: '/\\/api\\/|\\/rapport/.test(u)',
      put: '/(^|\\/)(api\\/|rapport)/.test(u)', count: 1 },
    { why: 'live WebSocket', find: "location.host + '/ws'", put: `location.host + ${BASE_EXPR} + 'ws'`, count: 1 },
    { why: 'browser radio WebSocket', find: '://${location.host}/ws/', put: `://\${location.host}\${${BASE_EXPR}}ws/`, count: 1 },
    { why: 'absolute links shown for copy/paste (exports, federation)',
      find: 'const base = location.origin;',
      put: `const base = (location.origin + ${BASE_EXPR}).replace(/\\/$/, '');`, count: 1 },
    { why: 'join-page address shown to the user',
      find: '${location.origin}/rejoindre', put: `\${location.origin}\${${BASE_EXPR}}rejoindre`, count: 1 },
    { why: 'service worker only at the root: its cache logic assumes absolute paths',
      find: "navigator.serviceWorker.register('/sw.js')",
      put: `(${BASE_EXPR} === '/' ? navigator.serviceWorker.register('/sw.js') : Promise.resolve())`, count: 1 },
    { why: 'links back to the map', find: 'href="/"', put: 'href="./"', count: 2 },
  ],
  'publique.js': [
    { why: 'live WebSocket', find: "location.host + '/ws'", put: `location.host + ${BASE_EXPR} + 'ws'`, count: 1 },
    { why: 'link to the detailed map', find: '`/?consultation', put: '`./?consultation', count: 1 },
  ],
  'topologie.js': [
    { why: 'live WebSocket', find: "location.host + '/ws'", put: `location.host + ${BASE_EXPR} + 'ws'`, count: 1 },
  ],
  'meshcore.js': [
    { why: 'browser companion WebSocket', find: '://${location.host}/ws/', put: `://\${location.host}\${${BASE_EXPR}}ws/`, count: 1 },
  ],
  'relief3d.js': [
    { why: 'terrain tiles need an absolute URL',
      find: "location.origin + '/api/relief/terrain/", put: `location.origin + ${BASE_EXPR} + 'api/relief/terrain/`, count: 1 },
  ],
  'administration.js': [
    { why: 'password-reset link', find: "location.origin + '/?reinit='", put: `location.origin + ${BASE_EXPR} + '?reinit='`, count: 1 },
    { why: 'join-page address in the suggested message',
      find: '${location.host}/rejoindre', put: `\${location.host}\${${BASE_EXPR}}rejoindre`, count: 1 },
  ],
  'relief3d.html': [
    { why: 'ES module specifiers must be explicitly relative',
      find: "from '/vendor/", put: "from './vendor/", count: 1 },
  ],
  'publique.html': [
    { why: 'link to the map', find: 'href="/"', put: 'href="./"', count: 1 },
    { why: 'link to the detailed map', find: 'href="/?consultation"', put: 'href="./?consultation"', count: 1 },
  ],
  'style.css': [
    { why: 'background image', find: 'url(/symbole.svg)', put: 'url(symbole.svg)', count: 1 },
  ],
};

// Root-absolute references that are correct as they are. Each entry is the
// text that must stand immediately before the slash for a hit to be accepted.
export const RESIDUAL_ALLOW = {
  'app.js': [
    "base + '",          // "base" already carries the prefix (see TARGETED)
    '${base}',           // same
    '${esc(base)}',      // same
    "? navigator.serviceWorker.register('", // root-only branch (see TARGETED)
  ],
};

function applyTargeted(name, text, errors) {
  for (const rule of TARGETED[name] || []) {
    const parts = text.split(rule.find);
    const n = parts.length - 1;
    if (n !== rule.count) {
      errors.push(`${name}: rule "${rule.why}" matched ${n} time(s), expected ${rule.count}`);
      continue;
    }
    text = parts.join(rule.put);
  }
  return text;
}

// Generic rule: a string literal (or HTML attribute value) that *starts* with
// "/<known segment>" loses its leading slash. Literals appended to something
// else ("x + '/api'") are left alone: there the left operand is a base.
export function stripLeadingSlashes(text, segments) {
  const re = new RegExp(`(?<!\\+\\s*)(['"\`])\\/(?=${segmentPattern(segments)})`, 'g');
  let count = 0;
  const out = text.replace(re, (_, q) => { count++; return q; });
  return { text: out, count };
}

export function findResiduals(name, text, segments) {
  // A slash that starts a known segment and is not part of a longer path,
  // a regular expression (\/api\/), a closing tag or a relative URL.
  const re = new RegExp(`(?<![\\w.\\\\<*/~-])\\/(?=${segmentPattern(segments)})`, 'g');
  const allow = RESIDUAL_ALLOW[name] || [];
  const hits = [];
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, ''); // whole-line comments
    for (const m of code.matchAll(re)) {
      const around = code.slice(Math.max(0, m.index - 60), m.index + 60);
      const before = code.slice(0, m.index);
      if (allow.some((a) => before.endsWith(a))) continue;
      // trailing comment on a code line
      if (/(^|[\s;{}])\/\/[^'"`]*$/.test(before)) continue;
      hits.push(`${name}:${i + 1}: ${around.trim()}`);
    }
  });
  return hits;
}

export function transformScript(name, text, segments) {
  const errors = [];
  let out = applyTargeted(name, text, errors);
  const g = stripLeadingSlashes(out, segments);
  out = g.text;
  const residuals = findResiduals(name, out, segments);
  return { text: out, generic: g.count, errors, residuals };
}

export function transformHtml(name, text, segments, version) {
  const r = transformScript(name, text, segments);
  // Upstream appends ?v=<version> to root-absolute local scripts and styles
  // when it serves a page; relative references no longer match that rule, so
  // the cache-busting suffix is added here instead.
  let versioned = 0;
  r.text = r.text.replace(/((?:href|src)="(?!vendor\/|https?:|\/|\.)[\w.-]+\.(?:css|js))"/g, (_, a) => { versioned++; return `${a}?v=${version}"`; });
  r.versioned = versioned;
  return r;
}

export function transformManifest(text) {
  const m = JSON.parse(text);
  const rel = (u) => (typeof u === 'string' && u.startsWith('/') && !u.startsWith('//') ? '.' + u : u);
  m.start_url = rel(m.start_url);
  m.scope = rel(m.scope);
  for (const icon of m.icons || []) icon.src = rel(icon.src).replace(/^\.\//, '');
  return JSON.stringify(m, null, 2) + '\n';
}

// The server returns the URL of computed coverage images in JSON; the page
// uses it as an image source, so it has to be relative as well.
export function transformServer(text) {
  const find = 'image: `/api/relief/couverture/';
  const n = text.split(find).length - 1;
  const errors = n >= 1 ? [] : ['src/server.js: coverage image URL not found'];
  return { text: text.split(find).join('image: `api/relief/couverture/'), count: n, errors };
}

export function transformTree(files, version) {
  // files: Map<relative path, string>; returns { changed: Map, report, errors }
  const publicNames = [...files.keys()].filter((f) => f.startsWith('public/') && !f.slice(7).includes('/')).map((f) => f.slice(7));
  const segments = discoverSegments(files.get('src/server.js') || '', publicNames);
  const changed = new Map();
  const errors = [];
  const report = [];
  const put = (f, before, after) => { if (after !== before) changed.set(f, after); };
  for (const [f, text] of files) {
    const name = f.startsWith('public/') ? f.slice(7) : f;
    let r = null;
    if (f === 'src/server.js') {
      const s = transformServer(text);
      errors.push(...s.errors);
      report.push(`${f}: ${s.count} coverage image URL(s)`);
      put(f, text, s.text);
    } else if (f === 'public/manifest.webmanifest') {
      put(f, text, transformManifest(text));
      report.push(`${f}: start_url, scope and icons made relative`);
    } else if (f === 'public/sw.js') {
      // Left untouched on purpose: only registered when the UI is at the root.
      report.push(`${f}: unchanged (registered at the root only)`);
    } else if (/^public\/[^/]+\.html$/.test(f)) {
      r = transformHtml(name, text, segments, version);
    } else if (/^public\/[^/]+\.(js|css)$/.test(f)) {
      r = transformScript(name, text, segments);
    }
    if (r) {
      errors.push(...r.errors, ...r.residuals.map((x) => `unreviewed root-absolute reference left in ${x}`));
      report.push(`${f}: ${r.generic} reference(s) made relative${r.versioned ? `, ${r.versioned} versioned` : ''}`);
      put(f, text, r.text);
    }
  }
  for (const name of Object.keys(TARGETED)) if (!files.has('public/' + name)) errors.push(`public/${name}: file missing, targeted rules not applied`);
  return { changed, report, errors, segments };
}

function main(appDir, outDir) {
  const files = new Map();
  const pub = path.join(appDir, 'public');
  for (const e of fs.readdirSync(pub, { withFileTypes: true })) {
    if (e.isFile() && /\.(js|html|css|webmanifest|svg|png|json)$/.test(e.name)) {
      files.set('public/' + e.name, /\.(js|html|css|webmanifest)$/.test(e.name) ? fs.readFileSync(path.join(pub, e.name), 'utf8') : '');
    }
  }
  files.set('src/server.js', fs.readFileSync(path.join(appDir, 'src/server.js'), 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
  const { changed, report, errors } = transformTree(files, version);
  for (const line of report) console.log('[relativize]', line);
  if (errors.length) {
    for (const e of errors) console.error('[relativize] ERROR', e);
    console.error('[relativize] The upstream web UI changed in a way this build does not know. Review build/relativize.mjs.');
    process.exit(1);
  }
  for (const [f, text] of changed) {
    const dest = path.join(outDir, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
  }
  console.log(`[relativize] upstream ${version}: ${changed.size} file(s) rewritten`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) { console.error('usage: node relativize.mjs <appDir> <outDir>'); process.exit(2); }
  main(process.argv[2], process.argv[3]);
}
