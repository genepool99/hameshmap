import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  filterItems,
  flattenNodes,
  formatAge,
  freshness,
  hasPosition,
  routePlan,
  routeWords,
} from "../src/logic.js";
import { S } from "../src/strings.js";

const NOW = Date.parse("2026-01-10T12:00:00Z");
const ago = (hours) => new Date(NOW - hours * 3600000).toISOString();
const node = (over = {}) => ({
  public_key: "ab".repeat(32),
  pubkey_prefix: "abababababab",
  name: "Node",
  type: "client",
  lat: 52.1,
  lon: 4.3,
  last_advert: null,
  last_heard: null,
  route: { state: "none", hops: [] },
  ...over,
});
const companion = { name: "Base", lat: 52, lon: 4 };

test("escapeHtml escapes markup characters", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(5), "5");
});

test("hasPosition needs finite coordinates in range", () => {
  assert.equal(hasPosition({ lat: 0, lon: 0 }), true);
  assert.equal(hasPosition({ lat: null, lon: 4 }), false);
  assert.equal(hasPosition({ lat: 91, lon: 4 }), false);
  assert.equal(hasPosition({ lat: "52", lon: 4 }), false);
  assert.equal(hasPosition(null), false);
});

test("freshness uses the newer of last_advert and last_heard", () => {
  assert.equal(freshness(node({ last_advert: ago(30), last_heard: ago(2) }), 24, NOW), "fresh");
  assert.equal(freshness(node({ last_advert: ago(2), last_heard: ago(30) }), 24, NOW), "fresh");
  assert.equal(freshness(node({ last_advert: ago(30), last_heard: ago(25) }), 24, NOW), "stale");
  assert.equal(freshness(node({ last_heard: ago(24) }), 24, NOW), "fresh");
  assert.equal(freshness(node({ last_heard: ago(2) }), 1, NOW), "stale");
});

test("freshness is unknown without a usable time", () => {
  assert.equal(freshness(node(), 24, NOW), "unknown");
  assert.equal(freshness(node({ last_advert: "not a date" }), 24, NOW), "unknown");
  assert.equal(freshness(node({ last_advert: ago(-48) }), 24, NOW), "unknown");
  assert.equal(freshness(node({ last_advert: ago(-48), last_heard: ago(30) }), 24, NOW), "stale");
});

const entries = [
  {
    entry_id: "e1",
    title: "One",
    nodes: [
      node({ name: "bravo", public_key: "11".repeat(32), type: "repeater", last_heard: ago(1) }),
      node({ name: "Alpha", public_key: "22".repeat(32), lat: null, lon: null, last_heard: ago(50) }),
    ],
  },
  { entry_id: "e2", title: "Two", nodes: [node({ name: "Charlie", public_key: "33".repeat(32), type: "odd" })] },
];

test("flattenNodes sorts, classifies and selects entries", () => {
  const all = flattenNodes(entries, null, 24, NOW);
  assert.deepEqual(all.map((i) => i.node.name), ["Alpha", "bravo", "Charlie"]);
  assert.deepEqual(all.map((i) => i.fresh), ["stale", "fresh", "unknown"]);
  assert.deepEqual(all.map((i) => i.located), [false, true, true]);
  assert.equal(all[2].type, "unknown");
  assert.equal(all[1].key, `e1:${"11".repeat(32)}`);
  assert.equal(flattenNodes(entries, "e2", 24, NOW).length, 1);
  assert.deepEqual(flattenNodes([], null, 24, NOW), []);
});

test("filterItems searches by name part and key prefix", () => {
  const all = flattenNodes(entries, null, 24, NOW);
  const names = (filters) => filterItems(all, filters).map((i) => i.node.name);
  assert.deepEqual(names({ search: " RAV " }), ["bravo"]);
  assert.deepEqual(names({ search: "2222" }), ["Alpha"]);
  assert.deepEqual(names({ search: "zz" }), []);
  assert.deepEqual(names({}), ["Alpha", "bravo", "Charlie"]);
});

test("filterItems filters by type and freshness", () => {
  const all = flattenNodes(entries, null, 24, NOW);
  const names = (filters) => filterItems(all, filters).map((i) => i.node.name);
  assert.deepEqual(names({ type: "repeater" }), ["bravo"]);
  assert.deepEqual(names({ type: "unknown" }), ["Charlie"]);
  assert.deepEqual(names({ fresh: "stale" }), ["Alpha"]);
  assert.deepEqual(names({ type: "client", fresh: "fresh" }), []);
});

const hop = (over = {}) => ({ hash: "a1", public_key: "a1".repeat(32), name: "Hop", lat: 52.05, lon: 4.1, ...over });

test("routePlan draws a direct route companion to node", () => {
  const plan = routePlan(node({ route: { state: "direct", hops: [] } }), companion);
  assert.deepEqual(plan, { points: [[52, 4], [52.1, 4.3]], reason: null });
});

test("routePlan draws a resolved route through the hops in order", () => {
  const hops = [hop(), hop({ hash: "b2", lat: 52.07, lon: 4.2 })];
  const plan = routePlan(node({ route: { state: "resolved", hops } }), companion);
  assert.deepEqual(plan.points, [[52, 4], [52.05, 4.1], [52.07, 4.2], [52.1, 4.3]]);
});

test("routePlan draws nothing and gives the reason", () => {
  const reason = (n, c = companion) => {
    const plan = routePlan(n, c);
    assert.equal(plan.points, null);
    return plan.reason;
  };
  assert.equal(reason(node()), S.reasonNoRoute);
  assert.equal(reason(node({ route: undefined })), S.reasonNoRoute);
  assert.equal(reason(node({ route: { state: "unresolved", hops: [hop({ public_key: null })] } })), S.reasonUnresolved);
  assert.equal(reason(node({ route: { state: "resolved", hops: [hop({ lat: null, lon: null })] } })), S.reasonHopNoPosition);
  assert.equal(reason(node({ route: { state: "direct", hops: [] } }), null), S.reasonCompanionNoPosition);
  assert.equal(reason(node({ route: { state: "direct", hops: [] } }), { name: "x", lat: null, lon: null }), S.reasonCompanionNoPosition);
  assert.equal(reason(node({ lat: null, lon: null, route: { state: "direct", hops: [] } })), S.reasonNodeNoPosition);
});

test("routeWords describes each route state", () => {
  assert.equal(routeWords({ state: "none", hops: [] }), "No known route");
  assert.equal(routeWords(undefined), "No known route");
  assert.equal(routeWords({ state: "direct", hops: [] }), "Direct, zero hops");
  assert.equal(routeWords({ state: "resolved", hops: [hop()] }), "1 hop: companion → Hop → this node");
  assert.equal(
    routeWords({ state: "unresolved", hops: [hop(), hop({ hash: "ff", public_key: null, name: null })] }),
    "2 hops, not all matched to a known node: companion → Hop → ff (not matched) → this node",
  );
});

test("formatAge gives relative ages", () => {
  assert.equal(formatAge(null, NOW), null);
  assert.equal(formatAge("garbage", NOW), null);
  assert.equal(formatAge(ago(0), NOW), "just now");
  assert.equal(formatAge(ago(0.5), NOW), "30 min ago");
  assert.equal(formatAge(ago(5), NOW), "5 h ago");
  assert.equal(formatAge(ago(72), NOW), "3 d ago");
  assert.equal(formatAge(ago(-5), NOW), "in the future");
});
