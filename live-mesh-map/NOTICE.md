# Notice

This image contains **Live Mesh Map World**
(<https://github.com/sauveteur71/live-mesh-map-world>), copyright its authors,
distributed under the GNU General Public License, version 3 (GPL-3.0-only).
The full licence text ships with the upstream project (`LICENSE` in its
repository). The exact upstream version and image digest are recorded in the
image labels `org.opencontainers.image.base.name` and
`org.opencontainers.image.base.digest`.

## Changes made to the upstream program

The Home Assistant App layer modifies the upstream program as follows. The
changes are applied when the image is built, by the script
`/opt/lmm/source/relativize.mjs` (also in the App's source repository as
`live-mesh-map/build/relativize.mjs`):

- In the web interface (`/app/public/*.js`, `*.html`, `style.css`,
  `manifest.webmanifest`), URLs pointing at the program's own server were
  changed from root-absolute (`/api/...`) to relative (`api/...`), so that the
  interface works below the path prefix used by Home Assistant Ingress. The
  service worker is registered only when the interface is served at the root.
- In `/app/src/server.js`, the URL of computed coverage images returned to the
  web interface was made relative in the same way.

Nothing else in the upstream program is modified. Additional files of the App
layer live in `/opt/lmm` (startup, option translation, ingress listener).

Because the image contains a modified copy of a GPL-3.0 program, the image as
a whole is distributed under the terms of the GPL-3.0. The licence of the App
layer's own files is stated in its source repository.

The icon and logo of the App (`icon.png`, `logo.png`) are rendered from
`assets/icon.svg` and `assets/wordmark.svg` in the App's source repository.
