// Builds the single panel bundle into the integration directory.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const licence = readFileSync("node_modules/leaflet/LICENSE", "utf8").trim();

await build({
  entryPoints: ["src/panel.js"],
  outfile: "../custom_components/meshcore_map/frontend/meshcore-map-panel.js",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  loader: { ".css": "text" },
  legalComments: "inline",
  banner: { js: `/*!\nIncludes Leaflet 1.9.4 (https://leafletjs.com)\n\n${licence}\n*/` },
});
