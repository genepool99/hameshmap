# Ingress compatibility audit

Pinned: `v1.5.14`, commit `07bc1a7`. Labels are defined in
[README.md](README.md). Paths are relative to the upstream repository root.

Home Assistant Ingress serves an app under `/api/hassio_ingress/<token>/`,
strips that prefix and adds an `X-Ingress-Path` header. Those properties are
taken from the task brief and Home Assistant documentation; they were **not**
verified here against a real Supervisor (UNVERIFIED). The tests below used an
nginx container that strips the same prefix.

## 1. Summary

- Upstream has **no** base-path or prefix support of any kind.
- Unmodified, the app is **unusable** under a stripped prefix: every asset of
  the main page escapes the prefix (EMPIRICAL).
- All five pages are served one level below the root, so making URLs
  **relative** is enough; no `<base>` tag and no knowledge of the prefix is
  needed.
- A mechanical rewrite of about 450 sites in 15 files produced a main page
  that loaded entirely inside the prefix, with a working WebSocket, and still
  worked at `/` (EMPIRICAL, prototype).
- **Recommendation: (b) a build-time relative-URL transform, guarded by an
  automated residual check**, and offered upstream as a contribution.
  Details in section 6.

## 2. Does upstream support a prefix?

| Check | Result | Evidence |
| --- | --- | --- |
| Environment variable or setting for a base URL | None | SOURCE: full list of `process.env` reads, see [configuration.md](configuration.md) section 4 |
| Use of `X-Ingress-Path`, `X-Forwarded-Prefix`, `SCRIPT_NAME`, `basePath` | None | SOURCE: no match under `carte-live/src` or `carte-live/public` |
| `<base>` tag in any page | None | SOURCE: no match in `carte-live/public/*.html` |
| Express router mounted on a configurable path | No; all routes are literal root paths on `app` | SOURCE `carte-live/src/server.js` (281 `app.<verb>('/…')` routes) |
| Documentation of sub-path hosting | None; the wiki only covers reverse proxies at the root of a host name | SOURCE `wiki/en/Installation.md:146-151`, `wiki/en/Comptes-et-sécurité.md:18,29` |
| Upstream issues or pull requests on the topic | None (the tracker holds only Dependabot pull requests) | GitHub API, 2026-11-20 |

## 3. URL inventory

Method: regular-expression count of string literals and attributes that begin
with a known root path (`/api/`, `/ws`, `/sante`, `/vendor/`, `/fonds/`,
`/metrics`, `/publique`, `/rejoindre`, `/rapport`, `/agent/`, `/?…`, `/`, or a
root-level static file). `i18n-*.json` dictionaries are excluded. Counts are
approximate to within a few sites (SOURCE; script kept outside the repo).

### 3.1 Root-absolute references per file

| File | Root-absolute | Breakdown |
| --- | --- | --- |
| `carte-live/public/app.js` | 237 | 212 `/api/…`, 5 `/agent/…`, 4 `/publique`, 3 `/rejoindre`, 3 static files, 4 `/`, and one each of `/ws`, `/sante`, `/metrics`, `/rapport`, `/fonds/…`, `/?…` |
| `carte-live/public/administration.js` | 78 | 76 `/api/…`, `/?reinit=`, `/` |
| `carte-live/public/meshcore.js` | 68 | 67 `/api/…`, 1 `/ws/meshcore` |
| `carte-live/public/sw.js` | 26 | cache list and pathname tests |
| `carte-live/public/publique.js` | 14 | 12 `/api/…`, `/ws`, `/?…` |
| `carte-live/public/index.html` | 13 | 10 static files, 3 `/vendor/…` |
| `carte-live/public/publique.html` | 9 | scripts, styles, 3 links |
| `carte-live/public/relief3d.js` | 8 | `/api/…` |
| `carte-live/public/ergonomie.js` | 7 | 6 `/api/…`, `/` |
| `carte-live/public/rejoindre.js` | 5 | |
| `carte-live/public/relief3d.html` | 4 | includes an ES module `import … from '/vendor/maplibre/…'` |
| `carte-live/public/manifest.webmanifest` | 4 | `start_url`, `scope`, 2 icons |
| `carte-live/public/topologie.js` | 3 | 2 `/api/…`, `/ws` |
| `carte-live/public/rejoindre.html` | 3 | |
| `carte-live/public/topologie.html` | 2 | |
| `carte-live/public/langue.js` | 1 | `/i18n-<lang>.json` |
| `carte-live/public/style.css` | 1 | `url(/symbole.svg)` at `style.css:47` |
| **Total** | **about 480** | about 390 are `/api/…` |

Already relative (10 sites): `topologie.html:148-150` (three scripts),
`index.html:105,108` (links to `topologie.html`), `relief3d.html:57` and
`topologie.html:110` (`./`), `relief3d.html:88` (`import('./relief3d.js')`),
`app.js:2951,6069` (`window.open('relief3d.html…')`), `topologie.js:370`.

### 3.2 By mechanism

| Mechanism | Sites | Notes | Evidence |
| --- | --- | --- | --- |
| HTML `<script src>`, `<link href>` | 30 in 5 pages | all root-absolute except `topologie.html` scripts | SOURCE `carte-live/public/index.html:8-13,470-477` and peers |
| `fetch` through the `api()` / `postJson()` helpers and direct `fetch` | about 390 literals | one helper, but the path is a literal at every call site | SOURCE `carte-live/public/app.js:104-107,6106` |
| `XMLHttpRequest` | 1 (upload with progress) | | SOURCE `carte-live/public/app.js:6497` |
| `new WebSocket(...)` | 5 | built from `location.host + '/ws…'` | SOURCE `app.js:5865,6871`, `meshcore.js:1359`, `publique.js:429`, `topologie.js:713` |
| `EventSource` | 0 | | SOURCE |
| Dynamic `<script>` | 1 | `s.src = '/administration.js?v=…'` | SOURCE `app.js:184-186` |
| Navigation | `location.href = '/api/sauvegarde-complete'`, `window.open` (relative), `location.reload()` | | SOURCE `app.js:1870,2951,6069,6353` |
| Links and images inside HTML template strings | 28 | `href="/api/export/…"`, `src="/api/…png"` etc. | SOURCE (counted by the prototype) |
| Absolute URLs built in the browser | 5 | `location.origin + '/…'` for share links, embed code, password-reset link, join link, and MapLibre terrain tiles | SOURCE `app.js:3860,8042`, `administration.js:957`, `relief3d.js:40` |
| CSS `url()` | 1 | | SOURCE `style.css:47` |
| Service worker | registered as `/sw.js`, only on HTTPS or `localhost` | cache list and `pathname.startsWith('/api/')` logic assume the root | SOURCE `app.js:3811`, `sw.js:7,43-48` |
| Web app manifest | `start_url: "/?source=pwa"`, `scope: "/"` | | SOURCE `manifest.webmanifest:5-6,12-13` |
| Map tiles and vendor libraries | vendor libraries local under `/vendor/…`; tiles are absolute third-party URLs | tiles are unaffected by the prefix | SOURCE `carte-live/src/server.js:207-209`, `carte-live/src/config.js:101-102` |
| Server redirects (`Location`) | 0 | | SOURCE |
| Server-rendered root-absolute links | 0 | | SOURCE |
| Absolute URLs built on the server | 3 | join-page QR target and live KML use `req.protocol` + `Host`; password-reset e-mail uses `CARTE_ADRESSE` | SOURCE `server.js:1983,3208,4199-4205` |
| Server-side HTML rewrite | 1 regex | appends `?v=<version>` only to attributes of the form `="/name.css\|js"` | SOURCE `server.js:213-221` |
| Cookie | `Path=/` | see section 5 | SOURCE `server.js:121,1950` |
| Demo-mode fetch wrapper | 1 | treats only URLs starting with `/` as same-origin | SOURCE `app.js:9-14` |

## 4. Empirical results

Set-up: pinned image behind nginx with
`location /api/hassio_ingress/TESTTOKEN/ { proxy_pass http://app:8095/; }`,
`X-Ingress-Path` and `X-Forwarded-For` set, everything else answered `404`.
Headless Chrome loaded the page; the nginx access log shows what the browser
requested.

| Case | Result |
| --- | --- |
| Unmodified upstream, main page under the prefix | The HTML returned 200. All 12 following requests (`/app.js`, `/style.css`, `/langue.js`, `/vendor/leaflet/…`, `/manifest.webmanifest`, `/favicon.svg`, …) went to the origin root and got 404. No API call and no WebSocket was attempted. The page is blank. |
| Prototype transform (section 6), main page under the prefix | 38 requests inside the prefix: 32 × 200, 5 × 304, and one `101` on `…/TESTTOKEN/ws`. Exactly one request outside the prefix: `/icone-192.png`, referenced by the deliberately untouched manifest. Rendered DOM grew from 37 kB to 80 kB (the app ran). |
| Prototype transform, other pages (`publique`, `topologie.html`, `rejoindre`, `relief3d.html`) | Static check only: every `href`, `src` and module import in the served HTML is relative and returns 200 under the prefix. Headless Chrome did not complete these pages in the test environment, so their runtime behaviour is **not** verified. |
| Prototype transform, direct access at `/` (no prefix) | `/`, `/app.js`, `/api/config`, `/vendor/leaflet/leaflet.js` all 200. The same build serves both Ingress and a direct port. |

Not tested: login and admin screens under the prefix, `/ws/module`, file
upload, demo mode, a real Supervisor, a real Home Assistant iframe.

## 5. Iframe and same-origin concerns

| Topic | Finding | Evidence |
| --- | --- | --- |
| Framing headers | Upstream sends neither `X-Frame-Options` nor CSP `frame-ancestors`, so it can be framed. | EMPIRICAL (response headers); SOURCE `server.js:202-206` |
| Session cookie in the iframe | `SameSite=Lax`. The Ingress iframe is same-origin with the Home Assistant UI, so the cookie is sent. | SOURCE `server.js:121`; same-origin claim UNVERIFIED |
| Cookie scope | `Path=/` on the Home Assistant origin. The cookie is sent to Home Assistant itself and to every other Ingress app, and a different app using the same cookie name would collide. The name `gaulix_session` is unusual, so a collision is unlikely. A proxy can rewrite the path. | SOURCE `server.js:121` |
| `Secure` flag | Set only when the trusted proxy sends `X-Forwarded-Proto: https`. | EMPIRICAL |
| Ingress token in share links | Share, embed, join and reset links are built from the page URL or `Host`. Under Ingress they would contain the Ingress path (after a relative transform) or a wrong root path (unmodified). Either way they are not usable by third parties. | SOURCE `app.js:3860,8042`, `administration.js:957`, `server.js:3208` |
| Service worker | Registered only on HTTPS or `localhost`. Unmodified, `/sw.js` resolves to the Home Assistant origin root and registration fails harmlessly (logged with `console.warn`). If made relative it would register for the Ingress path, where its `pathname.startsWith('/api/')` test matches every request. Keep it unregistered under Ingress. | SOURCE `app.js:3811`, `sw.js:41-48`; behaviour on a real Home Assistant origin UNVERIFIED |
| PWA manifest | `scope` and `start_url` are `/`. Installing the app as a PWA from inside Ingress is not meaningful. One stray icon request to the origin root remains (404, harmless). | EMPIRICAL |
| Geolocation | Used for the field mode and "my position". In an iframe this needs the embedding page to allow it. | SOURCE `app.js:3758,6440`; Home Assistant iframe permissions UNVERIFIED |
| Clipboard | `navigator.clipboard.writeText`, with a `document.execCommand('copy')` fallback in most places. | SOURCE `app.js:156-159`, `administration.js:963` |
| Web Serial, Web Bluetooth | Used to attach a radio through the browser. Both need a secure context and, inside an iframe, an explicit permission policy from the parent. Expect them **not** to work through Ingress. The feature is optional. | SOURCE `app.js:6909,6955,7235,7266`, `meshcore.js:1378,1402`, `wiki/en/Connecter-un-module.md:108`; iframe policy UNVERIFIED |
| Notifications | `Notification.requestPermission()` is called on some actions; typically blocked in cross-context iframes and harmless when refused. | SOURCE `app.js:1094,1582`, `meshcore.js:1594` |
| Pop-ups and new tabs | `window.open` for the 3D view and detached panels; target `_blank` links for exports. | SOURCE `app.js:2951,6069,6353` |
| `localStorage` | About 40 keys prefixed `gaulix_`, `publique_`, `relief3d-`, plus a few unprefixed (`filtreMessages`, `mcFiltreMessages`, `pli-*`). Shared with the Home Assistant origin under Ingress. | SOURCE `carte-live/public/*.js` |
| Restart flow | After saving settings the page polls `/sante` and reloads. Under Ingress this works only if something restarts the process (see [persistence-and-lifecycle.md](persistence-and-lifecycle.md)). | SOURCE `app.js:6124-6127` |
| First-run wizard | Through a proxy that sends `X-Forwarded-For`, the wizard always demands the setup code. | EMPIRICAL; see [network-and-http.md](network-and-http.md) section 4.2 |

## 6. Strategy assessment

### (a) Upstream native prefix support

Not available at the pinned version (section 2). It is the best long-term
answer and should be proposed upstream, but the App cannot depend on it now.

### (b) Build-time relative-URL transform — recommended

Because every page lives one level below the root (`/`, `/index.html`,
`/publique`, `/publique.html`, `/rejoindre`, `/rejoindre.html`,
`/topologie.html`, `/relief3d.html`, and `/rapport`), a URL written without
the leading slash resolves correctly under any prefix and at the root.

Prototype result (EMPIRICAL, run against the files extracted from the pinned
image; 452 substitutions in 15 files; all transformed scripts pass
`node --check`):

| Rule | Sites | Mechanical |
| --- | --- | --- |
| String literal starting with a known root path: drop the leading `/` | 380 | yes |
| `href` / `src` attributes in HTML pages (14 of them re-adding the `?v=<version>` suffix that the server regex no longer matches) | 30 | yes |
| `href` / `src` attributes inside JavaScript template strings | 28 | yes |
| WebSocket URLs: insert the page directory between host and `ws` | 5 | pattern-based, must be reviewed on upgrade |
| `location.origin + '/…'` builders: insert the page directory | 4 | pattern-based |
| ES module import in `relief3d.html` | 1 | yes |
| `url(/symbole.svg)` in CSS | 1 | yes |
| `'/?…'` → `'./?…'` | 1 | yes |
| Demo-mode wrapper: treat scheme-less URLs as same-origin | 1 | hand-written |
| Service worker registration: keep absolute on purpose | 1 | hand-written exclusion |

Left untouched on purpose: `sw.js`, `manifest.webmanifest`, the server.

Strengths:

- No runtime rewriting and no dependence on the Ingress token; the result is
  a static, diffable artefact.
- Works identically at `/`, so one build serves Ingress and a direct port.
- Failure is detectable at build time: after the transform, a search for any
  remaining root-absolute literal must return nothing, and each transformed
  script must parse. On the pinned version the residual count is 0.
- The same change is what an upstream contribution would look like.

Weaknesses:

- It modifies upstream files, so the resulting image is a modified version
  under GPL-3.0 (see [licensing.md](licensing.md)).
- About ten pattern-based sites depend on exact upstream wording. With
  upstream releasing several times a day, each upgrade can break a pattern.
  The residual check and a browser smoke test under a prefix must gate every
  version bump.
- The path list is an allow-list. A new upstream root path (for example a new
  top-level page) is missed until the residual check is extended to catch any
  quote followed by `/` and a letter.

### (c) Reverse-proxy response rewriting

A proxy in the App would rewrite bodies on the fly (for example nginx
`sub_filter` with `$http_x_ingress_path`). It would need to rewrite:

- HTML attributes in 5 pages;
- about 420 literals in 9 JavaScript files, in three quote styles, including
  template strings;
- the 5 WebSocket and 4 `location.origin` builders, which do not start with a
  quote and need dedicated patterns;
- 1 CSS `url()`;
- JSON is not affected.

It is fragile because: it needs upstream compression disabled or undone
(upstream gzips responses over 1 kB, SOURCE `server.js:151`); it runs on
every response and silently passes through anything it does not recognise, so
breakage appears at run time in users' browsers instead of at build time; the
same patterns as (b) are needed anyway; cached scripts contain the token of
the session that fetched them; and blind substitution of `"/api/` also hits
strings that are not URLs. It has no advantage over (b) except leaving the
image files untouched.

### (d) Other options considered

| Option | Verdict |
| --- | --- |
| Inject `<base href>` | Does not help: root-absolute URLs ignore `<base>`. Useful only after (b), and not needed there. |
| Runtime JavaScript shim that patches `fetch`, `XMLHttpRequest`, `WebSocket` | Incomplete: cannot catch `location.href = '/…'`, links and images created through `innerHTML` (28 sites), module imports or CSS. Would have to be combined with rewriting. |
| No Ingress; open the direct port in a new tab or `webui` link | Works with zero modification and keeps Web Serial, Bluetooth, PWA and share links functional. Loses Home Assistant authentication in front of the app and the sidebar integration. A valid fallback and a useful complement. |
| Host-header or sub-domain routing | Not offered by Ingress. |

### Recommendation

1. Use **(b)**, applied when the App image is built from the pinned upstream
   digest, with three gates in CI: zero residual root-absolute references,
   `node --check` on every transformed script, and a headless-browser load of
   each page under a stripped prefix that asserts no request leaves the prefix
   and that the `/ws` upgrade succeeds.
2. Keep the service worker unregistered under Ingress and leave the manifest
   alone.
3. In front of the app, add the forwarding headers upstream relies on
   (`X-Forwarded-For`, `X-Forwarded-Proto`) and consider rewriting the cookie
   path to the Ingress path.
4. Offer the relative-URL change upstream. If it is accepted, the transform
   shrinks to nothing and the App returns to an unmodified image.
5. Document that browser-attached radios (Web Serial / Bluetooth), PWA
   install and public share links need direct access, not Ingress.

The prototype transform is not part of this repository. Its rule list is the
table above; the App engineering role owns the real implementation.
