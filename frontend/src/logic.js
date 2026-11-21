// Pure panel logic. No DOM or Leaflet imports.
import { S } from "./strings.js";

export const TYPES = ["client", "repeater", "room_server", "sensor", "unknown"];
export const FRESHNESS = ["fresh", "stale", "unknown"];

const HTML_CHARS = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const HOUR_MS = 3600000;
// A node clock this far ahead of the current time counts as wrong.
const CLOCK_AHEAD_MS = 600000;
// Advert times before 2020 mean the node clock was never set.
const CLOCK_UNSET_BEFORE_MS = Date.UTC(2020, 0, 1);

// Escapes text for use in HTML.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_CHARS[c]);
}

// True when the object has a usable lat/lon pair.
export function hasPosition(o) {
  return (
    !!o &&
    Number.isFinite(o.lat) &&
    Number.isFinite(o.lon) &&
    Math.abs(o.lat) <= 90 &&
    Math.abs(o.lon) <= 180
  );
}

// State of the node clock behind last_advert:
// "none" (no advert time), "unset" (before 2020), "ahead" (in the future) or "ok".
export function advertClock(node, now) {
  const time = node.last_advert ? Date.parse(node.last_advert) : NaN;
  if (!Number.isFinite(time)) return "none";
  if (time < CLOCK_UNSET_BEFORE_MS) return "unset";
  return time > now + CLOCK_AHEAD_MS ? "ahead" : "ok";
}

// Newer of last_advert and last_heard in ms, or null.
// last_advert counts only when the node clock is "ok"; last_heard is Home Assistant's clock.
// The result is never later than now.
export function lastSeen(node, now) {
  const times = [];
  if (advertClock(node, now) === "ok") times.push(Math.min(Date.parse(node.last_advert), now));
  const heard = node.last_heard ? Date.parse(node.last_heard) : NaN;
  if (Number.isFinite(heard)) times.push(Math.min(heard, now));
  return times.length ? Math.max(...times) : null;
}

// Returns "fresh", "stale" or "unknown".
export function freshness(node, staleAfterHours, now) {
  const seen = lastSeen(node, now);
  if (seen === null) return "unknown";
  return now - seen <= staleAfterHours * HOUR_MS ? "fresh" : "stale";
}

// One list item per node of the selected entries (entryId null = all), sorted by name.
export function flattenNodes(entries, entryId, staleAfterHours, now) {
  const items = [];
  for (const entry of entries) {
    if (entryId && entry.entry_id !== entryId) continue;
    for (const node of entry.nodes || []) {
      items.push({
        key: `${entry.entry_id}:${node.public_key}`,
        entry,
        node,
        type: TYPES.includes(node.type) ? node.type : "unknown",
        located: hasPosition(node),
        fresh: freshness(node, staleAfterHours, now),
        seen: lastSeen(node, now),
      });
    }
  }
  return items.sort((a, b) =>
    String(a.node.name).localeCompare(String(b.node.name), undefined, { sensitivity: "base" }),
  );
}

export const SORTS = ["name", "type", "seen"];
export const POSITIONS = ["mapped", "unmapped"];

// Returns the items sorted by "name", by "type" (then name) or by "seen" (newest first, unknown last).
export function sortItems(items, by) {
  const name = (a, b) => String(a.node.name).localeCompare(String(b.node.name), undefined, { sensitivity: "base" });
  const sorted = [...items];
  if (by === "type") return sorted.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || name(a, b));
  if (by === "seen") return sorted.sort((a, b) => (b.seen ?? -Infinity) - (a.seen ?? -Infinity) || name(a, b));
  return sorted.sort(name);
}

// Applies search (name part or public key prefix), type, freshness and position ("mapped"/"unmapped") filters.
export function filterItems(items, { search = "", type = "", fresh = "", position = "" } = {}) {
  const q = search.trim().toLowerCase();
  return items.filter((item) => {
    if (type && item.type !== type) return false;
    if (fresh && item.fresh !== fresh) return false;
    if (position && item.located !== (position === "mapped")) return false;
    if (!q) return true;
    return (
      String(item.node.name).toLowerCase().includes(q) ||
      String(item.node.public_key).toLowerCase().startsWith(q)
    );
  });
}

// Groups points [{key, lat, lon}] that fall into the same square of `cell` pixels at `zoom`.
// Returns [{keys, lat, lon, south, west, north, east}], lat/lon being the mean of the group.
// The point with key `keep` always forms its own group. cell 0 puts every point in its own group.
export function clusterPoints(points, zoom, cell, keep = null) {
  const scale = 256 * 2 ** zoom;
  const groups = new Map();
  for (const point of points) {
    let id = `key:${point.key}`;
    if (cell > 0 && point.key !== keep) {
      const sin = Math.sin((Math.max(-85.0511, Math.min(85.0511, point.lat)) * Math.PI) / 180);
      const x = ((point.lon + 180) / 360) * scale;
      const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
      id = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
    }
    let group = groups.get(id);
    if (!group) {
      group = { keys: [], lat: 0, lon: 0, south: 90, west: 180, north: -90, east: -180 };
      groups.set(id, group);
    }
    group.keys.push(point.key);
    group.lat += point.lat;
    group.lon += point.lon;
    group.south = Math.min(group.south, point.lat);
    group.north = Math.max(group.north, point.lat);
    group.west = Math.min(group.west, point.lon);
    group.east = Math.max(group.east, point.lon);
  }
  for (const group of groups.values()) {
    group.lat /= group.keys.length;
    group.lon /= group.keys.length;
  }
  return [...groups.values()];
}

// Pixel offsets [[dx, dy], ...] that place `count` markers evenly on a ring, first one at the top.
export function ringOffsets(count, radius) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return [Math.round(radius * Math.cos(angle)), Math.round(radius * Math.sin(angle))];
  });
}

// Bounding box [[south, west], [north, east]] for the first view. With 20 or more points the outer 5%
// on each side is left out, so a few far-away nodes do not zoom the map out to the whole world.
export function mainBounds(points) {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat).sort((a, b) => a - b);
  const lons = points.map((p) => p.lon).sort((a, b) => a - b);
  const cut = points.length >= 20 ? Math.floor(points.length * 0.05) : 0;
  const last = points.length - 1 - cut;
  return [
    [lats[cut], lons[cut]],
    [lats[last], lons[last]],
  ];
}

// Decides whether the stored route can be drawn.
// Returns {points: [[lat, lon], ...], reason: null} or {points: null, reason: text}.
export function routePlan(node, companion) {
  const route = node.route || { state: "none", hops: [] };
  const no = (reason) => ({ points: null, reason });
  if (route.state === "unresolved") return no(S.reasonUnresolved);
  if (route.state !== "direct" && route.state !== "resolved") return no(S.reasonNoRoute);
  if (!hasPosition(companion)) return no(S.reasonCompanionNoPosition);
  if (!hasPosition(node)) return no(S.reasonNodeNoPosition);
  const hops = route.state === "direct" ? [] : route.hops || [];
  if (hops.some((hop) => !hasPosition(hop))) return no(S.reasonHopNoPosition);
  return { points: [companion, ...hops, node].map((p) => [p.lat, p.lon]), reason: null };
}

// Describes the stored route in words.
export function routeWords(route) {
  const state = route?.state;
  if (state === "direct") return S.routeDirect;
  if (state !== "resolved" && state !== "unresolved") return S.routeNone;
  const hops = route.hops || [];
  const names = hops.map((hop) => hop.name || (hop.public_key ? hop.hash : S.hopUnmatched(hop.hash)));
  const path = [S.routeStart, ...names, S.routeEnd].join(" → ");
  return state === "resolved" ? S.routeHops(hops.length, path) : S.routeUnresolved(hops.length, path);
}

// Relative age of an ISO time, or null when it is missing or invalid.
export function formatAge(iso, now) {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return null;
  const minutes = Math.floor((now - time) / 60000);
  if (minutes < -1) return S.inFuture;
  if (minutes < 1) return S.justNow;
  if (minutes < 60) return S.minutesAgo(minutes);
  if (minutes < 60 * 48) return S.hoursAgo(Math.floor(minutes / 60));
  return S.daysAgo(Math.floor(minutes / 1440));
}
