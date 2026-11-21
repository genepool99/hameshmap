// Pure panel logic. No DOM or Leaflet imports.
import { S } from "./strings.js";

export const TYPES = ["client", "repeater", "room_server", "sensor", "unknown"];
export const FRESHNESS = ["fresh", "stale", "unknown"];

const HTML_CHARS = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const HOUR_MS = 3600000;

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

// Newer of last_advert and last_heard in ms, or null.
// Times more than one hour ahead of now are ignored.
export function lastSeen(node, now) {
  const times = [node.last_advert, node.last_heard]
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((t) => Number.isFinite(t) && t <= now + HOUR_MS);
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
      });
    }
  }
  return items.sort((a, b) =>
    String(a.node.name).localeCompare(String(b.node.name), undefined, { sensitivity: "base" }),
  );
}

// Applies search (name part or public key prefix), type and freshness filters.
export function filterItems(items, { search = "", type = "", fresh = "" } = {}) {
  const q = search.trim().toLowerCase();
  return items.filter((item) => {
    if (type && item.type !== type) return false;
    if (fresh && item.fresh !== fresh) return false;
    if (!q) return true;
    return (
      String(item.node.name).toLowerCase().includes(q) ||
      String(item.node.public_key).toLowerCase().startsWith(q)
    );
  });
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
