// Leaflet map with node markers, companion markers and the stored-route line.
import * as L from "leaflet/dist/leaflet-src.esm.js";
import { escapeHtml, mainBounds } from "./logic.js";
import { ICONS, shapeSvg } from "./icons.js";
import { S } from "./strings.js";

function icon(type, fresh) {
  return L.divIcon({
    className: `mm-marker mm-shape t-${type} f-${fresh}`,
    html: shapeSvg(type),
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export class MapView {
  // onSelect(key) is called when a node marker is activated.
  constructor(container, onSelect) {
    this.onSelect = onSelect;
    this.markers = new Map();
    this.fitted = false;
    this.tiles = null;
    this.tileKey = "";
    this.route = null;
    this.map = L.map(container, { worldCopyJump: true }).setView([20, 0], 2);
    this.nodeLayer = L.layerGroup().addTo(this.map);
    this.companionLayer = L.layerGroup().addTo(this.map);

    const FitControl = L.Control.extend({
      onAdd: () => {
        const bar = L.DomUtil.create("div", "leaflet-bar");
        const button = L.DomUtil.create("button", "mm-fit", bar);
        button.type = "button";
        button.title = S.fitAll;
        button.setAttribute("aria-label", S.fitAll);
        button.innerHTML = ICONS.fit;
        L.DomEvent.disableClickPropagation(button);
        L.DomEvent.on(button, "click", () => this.fitAll());
        return bar;
      },
    });
    new FitControl({ position: "topleft" }).addTo(this.map);

    this.routeLabel = L.DomUtil.create("div", "mm-route-label");
    this.routeLabel.textContent = S.routeLabel;
    this.routeLabel.hidden = true;
    const RouteLabel = L.Control.extend({ onAdd: () => this.routeLabel });
    new RouteLabel({ position: "topright" }).addTo(this.map);
  }

  // Sets the tile layer. The attribution is shown as text.
  setTiles(url, attribution) {
    const key = `${url}\n${attribution}`;
    if (!url || key === this.tileKey) return;
    this.tileKey = key;
    if (this.tiles) this.tiles.remove();
    let text = escapeHtml(attribution);
    if (/^https:\/\/([a-z0-9-]+\.)*openstreetmap\.org\//i.test(url)) {
      text = `<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
    // Tile requests carry the Home Assistant origin as Referer; tile servers such as OpenStreetMap refuse requests without one.
    this.tiles = L.tileLayer(url, { maxZoom: 19, attribution: text, referrerPolicy: "origin" }).addTo(this.map);
  }

  // Shows one marker per located item and marks the selected one.
  setNodes(items, selectedKey) {
    const seen = new Set();
    for (const item of items) {
      if (!item.located) continue;
      seen.add(item.key);
      const title = S.markerTitle(item.node.name, S.types[item.type], S.fresh[item.fresh]);
      const signature = [item.node.lat, item.node.lon, item.type, item.fresh, title].join("|");
      let marker = this.markers.get(item.key);
      if (!marker || marker.signature !== signature) {
        if (marker) marker.remove();
        marker = L.marker([item.node.lat, item.node.lon], { icon: icon(item.type, item.fresh), title });
        marker.signature = signature;
        marker.on("click", () => this.onSelect(item.key));
        marker.addTo(this.nodeLayer);
        this.markers.set(item.key, marker);
      }
      const selected = item.key === selectedKey;
      marker.getElement().classList.toggle("selected", selected);
      marker.setZIndexOffset(selected ? 1000 : 0);
    }
    for (const [key, marker] of this.markers) {
      if (!seen.has(key)) {
        marker.remove();
        this.markers.delete(key);
      }
    }
    this.tryInitialFit();
  }

  // Shows the companion markers: [{lat, lon, name}].
  setCompanions(companions) {
    this.companionLayer.clearLayers();
    for (const c of companions) {
      L.marker([c.lat, c.lon], {
        icon: icon("companion", "fresh"),
        title: S.companionOf(c.name),
        zIndexOffset: 500,
      }).addTo(this.companionLayer);
    }
  }

  // Draws the stored-route line and its label, or removes them when points is null.
  setRoute(points) {
    const key = JSON.stringify(points);
    if (key === this.routeKey) return;
    this.routeKey = key;
    if (this.route) this.route.remove();
    this.route = null;
    this.routeLabel.hidden = !points;
    if (!points) return;
    this.route = L.polyline(points, { className: "mm-route", interactive: false, weight: 3 }).addTo(this.map);
  }

  // Pans to the marker of the item when it is outside the view.
  panTo(key) {
    const marker = this.markers.get(key);
    if (marker && !this.map.getBounds().contains(marker.getLatLng())) {
      this.map.panTo(marker.getLatLng());
    }
  }

  points() {
    return [...this.nodeLayer.getLayers(), ...this.companionLayer.getLayers()].map((m) => m.getLatLng());
  }

  // Fits the view to all markers. Returns false when there is nothing to fit.
  fitAll() {
    const points = this.points();
    if (!points.length) return false;
    this.map.fitBounds(L.latLngBounds(points).pad(0.15), { maxZoom: 14 });
    return true;
  }

  // Fits once, as soon as the map has a size and markers, to the area holding most markers.
  tryInitialFit() {
    if (this.fitted) return;
    const size = this.map.getSize();
    if (size.x <= 0 || size.y <= 0) return;
    const bounds = mainBounds(this.points().map((p) => ({ lat: p.lat, lon: p.lng })));
    if (!bounds) return;
    this.map.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 14 });
    this.fitted = true;
  }

  resized() {
    this.map.invalidateSize();
    this.tryInitialFit();
  }

  destroy() {
    this.map.remove();
    this.markers.clear();
  }
}
