import test from "node:test";
import assert from "node:assert/strict";
import {
  ringOffsets,
  sortItems,
  advertClock,
  clusterPoints,
  lastSeen,
  mainBounds,
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

test("mainBounds leaves out far-away points only when there are many", () => {
  const near = Array.from({ length: 40 }, (_, i) => ({ lat: 47 + i * 0.01, lon: -122 + i * 0.01 }));
  const far = { lat: 39.9, lon: 116.4 };
  const [[south, west], [north, east]] = mainBounds([...near, far]);
  assert.ok(south >= 47 && north <= 47.4 && west >= -122 && east <= -121.6);
  assert.deepEqual(mainBounds([near[0], far]), [
    [39.9, -122],
    [47, 116.4],
  ]);
  assert.equal(mainBounds([]), null);
});

test("advertClock tells a usable node clock from one that is ahead or not set", () => {
  assert.equal(advertClock(node({ last_advert: null }), NOW), "none");
  assert.equal(advertClock(node({ last_advert: "not a date" }), NOW), "none");
  assert.equal(advertClock(node({ last_advert: ago(1) }), NOW), "ok");
  assert.equal(advertClock(node({ last_advert: ago(-0.1) }), NOW), "ok");
  assert.equal(advertClock(node({ last_advert: ago(-0.5) }), NOW), "ahead");
  assert.equal(advertClock(node({ last_advert: "1970-01-02T00:00:00+00:00" }), NOW), "unset");
});

test("a node clock that is ahead or not set never makes a node fresh", () => {
  assert.equal(freshness(node({ last_advert: ago(-0.5) }), 24, NOW), "unknown");
  assert.equal(freshness(node({ last_advert: ago(-1000) }), 24, NOW), "unknown");
  assert.equal(freshness(node({ last_advert: "1970-01-02T00:00:00+00:00" }), 24, NOW), "unknown");
  assert.equal(lastSeen(node({ last_advert: ago(-0.5), last_heard: ago(3) }), NOW), NOW - 3 * 3600000);
  assert.equal(freshness(node({ last_advert: ago(-0.5), last_heard: ago(3) }), 24, NOW), "fresh");
  assert.equal(freshness(node({ last_advert: ago(-0.5), last_heard: ago(30) }), 24, NOW), "stale");
});

test("clusterPoints groups nearby points and separates them when zoomed in", () => {
  const points = [
    { key: "a", lat: 45.5, lon: -122.6 },
    { key: "b", lat: 45.51, lon: -122.61 },
    { key: "c", lat: 47.6, lon: -122.3 },
  ];
  const far = clusterPoints(points, 2, 64);
  assert.equal(far.length, 1);
  assert.deepEqual(far[0].keys, ["a", "b", "c"]);
  assert.deepEqual([far[0].south, far[0].west, far[0].north, far[0].east], [45.5, -122.61, 47.6, -122.3]);
  const mid = clusterPoints(points, 8, 64);
  assert.deepEqual(mid.map((g) => g.keys).sort(), [["a", "b"], ["c"]]);
  assert.ok(Math.abs(mid.find((g) => g.keys.length === 2).lat - 45.505) < 1e-9);
  assert.equal(clusterPoints(points, 16, 64).length, 3);
});

test("clusterPoints keeps the selected point out of clusters and handles cell 0", () => {
  const same = [
    { key: "a", lat: 45.5, lon: -122.6 },
    { key: "b", lat: 45.5, lon: -122.6 },
    { key: "c", lat: 45.5, lon: -122.6 },
  ];
  assert.deepEqual(clusterPoints(same, 10, 64, "b").map((g) => g.keys).sort(), [["a", "c"], ["b"]]);
  assert.equal(clusterPoints(same, 10, 0).length, 3);
  assert.deepEqual(clusterPoints([], 10, 64), []);
  assert.equal(clusterPoints([{ key: "p", lat: 90, lon: 0 }], 3, 64).length, 1);
});

test("sortItems sorts by name, by type and by last seen", () => {
  const item = (name, type, seen) => ({ node: { name }, type, seen });
  const items = [item("beta", "repeater", 300), item("Alpha", "client", null), item("gamma", "client", 900)];
  const names = (by) => sortItems(items, by).map((i) => i.node.name);
  assert.deepEqual(names("name"), ["Alpha", "beta", "gamma"]);
  assert.deepEqual(names("type"), ["Alpha", "gamma", "beta"]);
  assert.deepEqual(names("seen"), ["gamma", "beta", "Alpha"]);
  assert.deepEqual(names("other"), ["Alpha", "beta", "gamma"]);
  assert.equal(items[0].node.name, "beta");
});

test("flattenNodes records when a node was last seen, ignoring a clock that is ahead", () => {
  const entries = [{ entry_id: "e", nodes: [node({ last_advert: ago(-5), last_heard: ago(2) }), node({ last_advert: ago(-5) })] }];
  const seen = flattenNodes(entries, null, 24, NOW).map((i) => i.seen);
  assert.deepEqual(seen.sort(), [NOW - 2 * 3600000, null].sort());
});

test("filterItems filters on having a position", () => {
  const items = [{ node: { name: "a", public_key: "aa" }, located: true }, { node: { name: "b", public_key: "bb" }, located: false }];
  assert.deepEqual(filterItems(items, { position: "mapped" }).map((i) => i.node.name), ["a"]);
  assert.deepEqual(filterItems(items, { position: "unmapped" }).map((i) => i.node.name), ["b"]);
  assert.equal(filterItems(items, {}).length, 2);
});

test("ringOffsets places markers evenly around the middle", () => {
  assert.deepEqual(ringOffsets(4, 20), [[0, -20], [20, 0], [0, 20], [-20, 0]]);
  assert.equal(new Set(ringOffsets(7, 24).map(String)).size, 7);
  assert.deepEqual(ringOffsets(0, 24), []);
});

test("lastSeen is never later than now", () => {
  assert.equal(lastSeen(node({ last_advert: ago(-0.1) }), NOW), NOW);
  assert.equal(lastSeen(node({ last_heard: ago(-0.1) }), NOW), NOW);
});
