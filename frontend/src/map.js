// Leaflet map with node markers, companion markers and the stored-route line.
import * as L from "leaflet/dist/leaflet-src.esm.js";
import { clusterPoints, escapeHtml, mainBounds, ringOffsets } from "./logic.js";
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

// Nodes in the same square of this many pixels are shown as one cluster marker.
const CLUSTER_CELL = 64;
// From this zoom level on every node has its own marker.
const CLUSTER_MAX_ZOOM = 16;
// From that zoom level on, nodes closer together than this many pixels are placed on a ring around their middle.
const OVERLAP_CELL = 14;
const RING_RADIUS = 24;

function clusterIcon(count) {
  const size = count < 10 ? 30 : count < 100 ? 36 : 42;
  return L.divIcon({
    className: "mm-cluster",
    html: `<span>${count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export class MapView {
  // onSelect(key) is called when a node marker is activated. legend is an element shown as a map control.
  constructor(container, onSelect, legend) {
    this.onSelect = onSelect;
    this.markers = new Map();
    this.items = [];
    this.companions = [];
    this.selectedKey = null;
    this.fitted = false;
    this.tiles = null;
    this.tileKey = "";
    this.route = null;
    this.map = L.map(container, { worldCopyJump: true }).setView([20, 0], 2);
    this.nodeLayer = L.layerGroup().addTo(this.map);
    this.clusterLayer = L.layerGroup().addTo(this.map);
    this.map.on("zoomend", () => this.layout());
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

    if (legend) {
      L.DomUtil.addClass(legend, "leaflet-control");
      L.DomEvent.disableClickPropagation(legend);
      L.DomEvent.disableScrollPropagation(legend);
      const Legend = L.Control.extend({ onAdd: () => legend });
      new Legend({ position: "bottomleft" }).addTo(this.map);
    }

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

  // Sets the located items to show and the selected one.
  setNodes(items, selectedKey) {
    this.items = items.filter((item) => item.located);
    this.selectedKey = selectedKey;
    const seen = new Set();
    for (const item of this.items) {
      seen.add(item.key);
      const title = S.markerTitle(item.node.name, S.types[item.type], S.fresh[item.fresh]);
      const signature = [item.node.lat, item.node.lon, item.type, item.fresh, title].join("|");
      let marker = this.markers.get(item.key);
      if (!marker || marker.signature !== signature) {
        if (marker) marker.remove();
        marker = L.marker([item.node.lat, item.node.lon], { icon: icon(item.type, item.fresh), title });
        marker.signature = signature;
        marker.position = marker.getLatLng();
        marker.on("click", () => this.onSelect(item.key));
        this.markers.set(item.key, marker);
      }
    }
    for (const [key, marker] of this.markers) {
      if (!seen.has(key)) {
        marker.remove();
        this.markers.delete(key);
      }
    }
    this.layout();
    this.tryInitialFit();
  }

  // Puts node markers and cluster markers on the map for the current zoom level.
  // Below CLUSTER_MAX_ZOOM nearby nodes share a cluster marker. From that level on every node has a marker,
  // and nodes at the same place are placed on a ring. The selected node always has its own marker at its position.
  layout() {
    const zoom = this.map.getZoom();
    const spread = zoom >= CLUSTER_MAX_ZOOM;
    const groups = clusterPoints(
      this.items.map((item) => ({ key: item.key, lat: item.node.lat, lon: item.node.lon })),
      zoom,
      spread ? OVERLAP_CELL : CLUSTER_CELL,
      this.selectedKey,
    );
    const place = new Map();
    this.clusterLayer.clearLayers();
    for (const group of groups) {
      if (group.keys.length === 1) {
        place.set(group.keys[0], null);
      } else if (spread) {
        const centre = this.map.project([group.lat, group.lon], zoom);
        ringOffsets(group.keys.length, RING_RADIUS).forEach(([dx, dy], i) => {
          place.set(group.keys[i], this.map.unproject([centre.x + dx, centre.y + dy], zoom));
        });
      } else {
        const marker = L.marker([group.lat, group.lon], {
          icon: clusterIcon(group.keys.length),
          title: S.clusterTitle(group.keys.length),
        });
        marker.on("click", () => this.openCluster(group));
        marker.addTo(this.clusterLayer);
      }
    }
    for (const [key, marker] of this.markers) {
      if (!place.has(key)) {
        this.nodeLayer.removeLayer(marker);
        continue;
      }
      marker.setLatLng(place.get(key) || marker.position);
      if (!this.nodeLayer.hasLayer(marker)) marker.addTo(this.nodeLayer);
      const selected = key === this.selectedKey;
      marker.getElement().classList.toggle("selected", selected);
      marker.setZIndexOffset(selected ? 1000 : 0);
    }
  }

  // Zooms to the nodes of a cluster.
  openCluster(group) {
    const bounds = L.latLngBounds([group.south, group.west], [group.north, group.east]);
    const zoom = Math.max(this.map.getBoundsZoom(bounds.pad(0.2)), this.map.getZoom() + 1);
    this.map.setView(bounds.getCenter(), Math.min(zoom, CLUSTER_MAX_ZOOM));
  }

  // Shows the companion markers: [{lat, lon, name}].
  setCompanions(companions) {
    this.companions = companions;
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
    if (marker && !this.map.getBounds().contains(marker.position)) {
      this.map.panTo(marker.position);
    }
  }

  // Positions of all shown nodes and companions as {lat, lon}.
  points() {
    return [...this.items.map((item) => item.node), ...this.companions].map((p) => ({ lat: p.lat, lon: p.lon }));
  }

  // Fits the view to all markers. Returns false when there is nothing to fit.
  fitAll() {
    const points = this.points();
    if (!points.length) return false;
    this.map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon])).pad(0.15), { maxZoom: 14 });
    return true;
  }

  // Fits once, as soon as the map has a size and markers, to the area holding most markers.
  tryInitialFit() {
    if (this.fitted) return;
    const size = this.map.getSize();
    if (size.x <= 0 || size.y <= 0) return;
    const bounds = mainBounds(this.points());
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
