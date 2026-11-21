// Panel CSS, including Leaflet's stylesheet without its image references.
import leafletCss from "leaflet/dist/leaflet.css";

export const STYLE = `
${leafletCss.replace(/url\([^)]*\)/g, "none")}

:host {
  display: block;
  height: 100vh;
  height: 100dvh;
  color: var(--primary-text-color, #212121);
  background: var(--primary-background-color, #fafafa);
  font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, sans-serif));
  font-size: 14px;
  --mm-card: var(--card-background-color, #fff);
  --mm-divider: var(--divider-color, #ddd);
  --mm-secondary: var(--secondary-text-color, #727272);
  --mm-primary: var(--primary-color, #03a9f4);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.panel { display: flex; flex-direction: column; height: 100%; }
button, select, input { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--mm-primary); outline-offset: 1px; }

header {
  display: flex; align-items: center; gap: 8px;
  min-height: var(--header-height, 56px); padding: 0 12px;
  background: var(--app-header-background-color, var(--mm-primary));
  color: var(--app-header-text-color, #fff);
}
header h1 { flex: 1; margin: 0; font-size: 20px; font-weight: 400; white-space: nowrap; }
header :focus-visible { outline-color: currentColor; }
.icon-button {
  display: inline-flex; align-items: center; gap: 4px;
  min-width: 40px; height: 40px; padding: 0 8px;
  border: 0; border-radius: 20px; background: none; cursor: pointer;
}
.icon-button svg { width: 24px; height: 24px; fill: currentColor; }
header select {
  max-width: 45%; padding: 6px; border-radius: 4px;
  border: 1px solid currentColor; background: transparent;
}
header select option { color: var(--primary-text-color, #212121); background: var(--mm-card); }
.list-toggle { display: none; }
:host([narrow]) .list-toggle { display: inline-flex; }

.status {
  display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 6px 12px;
  background: var(--mm-card); border-bottom: 1px solid var(--mm-divider);
  color: var(--mm-secondary); font-size: 13px;
}
.status:empty { display: none; }
.status b { color: var(--primary-text-color, #212121); font-weight: 500; }
.dot { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 50%; background: var(--mm-secondary); }
.dot.connected { background: var(--success-color, #43a047); }
.dot.disconnected { background: var(--error-color, #db4437); }
.entry-error { color: var(--error-color, #db4437); }

.body { position: relative; display: flex; flex: 1; min-height: 0; overflow: hidden; }
.main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.banner {
  display: flex; align-items: center; gap: 12px; padding: 8px 12px;
  background: var(--mm-card); border-bottom: 1px solid var(--mm-divider);
}
.banner.error { color: var(--error-color, #db4437); }
.banner button, .filters select, .filters input {
  padding: 6px 8px; border: 1px solid var(--mm-divider); border-radius: 4px;
  background: var(--mm-card); color: var(--primary-text-color, #212121);
}
.map { flex: 1; min-height: 120px; z-index: 0; background: var(--secondary-background-color, #e5e5e5); }

aside {
  display: flex; flex-direction: column; width: 340px; max-width: 100%;
  background: var(--mm-card); border-left: 1px solid var(--mm-divider);
}
:host([narrow]) aside {
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 2;
  width: min(340px, 90%); visibility: hidden; transform: translateX(100%);
  transition: transform 0.15s, visibility 0.15s; box-shadow: -2px 0 8px rgba(0, 0, 0, 0.3);
}
:host([narrow]) aside.open { visibility: visible; transform: none; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; }
.filters input { flex: 1 1 100%; min-width: 0; }
.filters select { flex: 1 1 40%; min-width: 0; }
.counts { padding: 0 10px 6px; color: var(--mm-secondary); font-size: 13px; }
.list { flex: 1; min-height: 80px; margin: 0; padding: 0; overflow-y: auto; list-style: none; border-top: 1px solid var(--mm-divider); }
.list .empty { padding: 12px 10px; color: var(--mm-secondary); }
.item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px;
  border: 0; border-bottom: 1px solid var(--mm-divider); background: none;
  text-align: left; cursor: pointer;
}
.item:hover { background: var(--secondary-background-color, rgba(127, 127, 127, 0.12)); }
.item[aria-current="true"] { box-shadow: inset 4px 0 0 var(--mm-primary); background: var(--secondary-background-color, rgba(127, 127, 127, 0.18)); }
.item .mm-shape { flex: none; width: 20px; height: 20px; }
.item .text { min-width: 0; flex: 1; }
.item .name, .item .sub { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .sub { color: var(--mm-secondary); font-size: 12px; }
.item.unmapped .mm-shape { opacity: 0.45; }
.badge { flex: none; padding: 1px 6px; border: 1px solid var(--mm-divider); border-radius: 8px; color: var(--mm-secondary); font-size: 11px; }

.legend {
  max-width: min(260px, calc(100vw - 40px)); padding: 4px 8px; border-radius: 4px; font-size: 12px;
  background: var(--mm-card); color: var(--primary-text-color, #212121); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.legend summary { cursor: pointer; font-weight: 500; }
.legend p { margin: 4px 0 0; color: var(--mm-secondary); }
.legend ul { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 6px 0 0; padding: 0; list-style: none; }
.legend li { display: flex; align-items: center; gap: 4px; }
.legend .mm-shape { width: 16px; height: 16px; }
.legend-cluster { width: 18px; height: 18px; font-size: 10px; border-width: 1px; cursor: default; }
.legend-route { width: 22px; border-top: 3px dashed var(--mm-primary); }

.details { max-height: 55%; overflow-y: auto; padding: 8px 10px; background: var(--mm-card); border-top: 1px solid var(--mm-divider); }
.details[hidden] { display: none; }
.details-head { display: flex; align-items: center; gap: 8px; }
.details h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 500; overflow-wrap: anywhere; }
.details dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 6px 0 0; }
.details dt { color: var(--mm-secondary); }
.details dd { margin: 0; overflow-wrap: anywhere; }
.note { color: var(--mm-secondary); font-size: 12px; }

.mm-shape { --c: #757575; }
.mm-shape svg { display: block; width: 100%; height: 100%; overflow: visible; }
.mm-shape svg > * { fill: var(--c); stroke: #fff; stroke-width: 2; stroke-linejoin: round; }
.mm-shape.f-stale svg > * { fill: #fff; fill-opacity: 0.75; stroke: var(--c); }
.mm-shape.f-unknown svg > * { fill: #fff; fill-opacity: 0.75; stroke: var(--c); stroke-dasharray: 3 2.5; }
.t-client { --c: #1976d2; }
.t-repeater { --c: #e65100; }
.t-room_server { --c: #8e24aa; }
.t-sensor { --c: #2e7d32; }
.t-unknown { --c: #616161; }
.t-companion { --c: #c62828; }
.mm-marker { filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.5)); }
.mm-marker.selected { filter: drop-shadow(0 0 3px #000) drop-shadow(0 0 5px var(--mm-primary)); }
.mm-marker.selected svg { transform: scale(1.35); }
.mm-cluster {
  display: flex; align-items: center; justify-content: center; border: 2px solid #fff; border-radius: 50%;
  background: #37474f; color: #fff; font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5); cursor: pointer;
}
.mm-route { stroke: var(--mm-primary); stroke-dasharray: 8 6; fill: none; }
.mm-route-label {
  display: flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 4px;
  background: var(--mm-card); color: var(--primary-text-color, #212121); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.mm-route-label::before { content: ""; width: 26px; border-top: 3px dashed var(--mm-primary); }
.mm-fit { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 2px; background: none; cursor: pointer; }
.mm-fit svg { width: 20px; height: 20px; fill: currentColor; }

.leaflet-container { font: inherit; font-size: 12px; }
.leaflet-bar, .leaflet-bar a, .leaflet-control-attribution {
  background: var(--mm-card); color: var(--primary-text-color, #212121);
}
.leaflet-bar a { border-bottom-color: var(--mm-divider); }
.leaflet-bar a:hover, .leaflet-bar a:focus { background: var(--secondary-background-color, #f4f4f4); color: var(--primary-text-color, #212121); }
.leaflet-control-attribution a { color: var(--mm-primary); }
`;
