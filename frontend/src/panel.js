// <meshcore-map-panel>: Home Assistant sidebar panel showing MeshCore nodes on a map.
import { MapView } from "./map.js";
import { STYLE } from "./styles.js";
import { S } from "./strings.js";
import { ICONS, shapeSvg } from "./icons.js";
import {
  advertClock,
  FRESHNESS,
  POSITIONS,
  SORTS,
  TYPES,
  filterItems,
  sortItems,
  flattenNodes,
  formatAge,
  hasPosition,
  routePlan,
  routeWords,
} from "./logic.js";

// Creates an element. "on*" props are listeners, other props are attributes, children are text or nodes.
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props || {})) {
    if (name.startsWith("on")) el.addEventListener(name.slice(2), value);
    else if (value === true) el.setAttribute(name, "");
    else if (value !== false && value != null) el.setAttribute(name, value);
  }
  el.append(...children.filter((child) => child != null && child !== false));
  return el;
}

// Element holding static SVG markup from icons.js.
function svgBox(tag, props, markup) {
  const el = h(tag, props);
  el.innerHTML = markup;
  return el;
}

const shape = (type, fresh) => svgBox("span", { class: `mm-shape t-${type} f-${fresh}` }, shapeSvg(type));

class MeshcoreMapPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._data = null;
    this._error = null;
    this._entryId = null;
    this._selected = null;
    this._filters = { search: "", type: "", fresh: "", position: "" };
    this._sort = "name";
    this._drawerOpen = false;
    this._entriesKey = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.isConnected) return;
    this._start();
    this._renderMenu();
  }

  get hass() {
    return this._hass;
  }

  set narrow(narrow) {
    this._narrow = !!narrow;
    this.toggleAttribute("narrow", this._narrow);
    if (this.isConnected) this._layout();
  }

  get narrow() {
    return this._narrow;
  }

  connectedCallback() {
    this._build();
    this._mapView = new MapView(this._el.map, (key) => this._select(key, false), this._el.legend);
    this._resizeObserver = new ResizeObserver(() => this._mapView.resized());
    this._resizeObserver.observe(this._el.map);
    this._timer = setInterval(() => this._render(), 60000);
    this._layout();
    this._render();
    this._start();
  }

  disconnectedCallback() {
    this._stop();
    clearInterval(this._timer);
    this._resizeObserver.disconnect();
    this._mapView.destroy();
    this._mapView = null;
    this.shadowRoot.replaceChildren();
  }

  // Builds the static DOM.
  _build() {
    const el = (this._el = {});
    el.menu = svgBox(
      "button",
      { class: "icon-button menu", type: "button", "aria-label": S.menu, title: S.menu, onclick: () => this._toggleMenu() },
      ICONS.menu,
    );
    el.entrySelect = h("select", {
      "aria-label": S.entrySelect,
      hidden: true,
      onchange: () => {
        this._entryId = el.entrySelect.value || null;
        this._render();
      },
    });
    el.listToggle = svgBox(
      "button",
      {
        class: "icon-button list-toggle",
        type: "button",
        "aria-label": S.toggleList,
        title: S.toggleList,
        onclick: () => this._setDrawer(!this._drawerOpen),
      },
      ICONS.list,
    );
    el.status = h("div", { class: "status" });
    el.banner = h("div", { class: "banner", role: "status", hidden: true });
    el.map = h("div", { class: "map", role: "region", "aria-label": S.mapLabel });
    el.main = h("div", { class: "main" }, el.banner, el.map);

    const option = (value, label) => h("option", { value }, label);
    el.search = h("input", {
      type: "search",
      placeholder: S.search,
      "aria-label": S.search,
      oninput: () => this._setFilter("search", el.search.value),
    });
    el.type = h(
      "select",
      { "aria-label": S.typeFilter, onchange: () => this._setFilter("type", el.type.value) },
      option("", S.allTypes),
      ...TYPES.map((type) => option(type, S.types[type])),
    );
    el.fresh = h(
      "select",
      { "aria-label": S.freshFilter, onchange: () => this._setFilter("fresh", el.fresh.value) },
      option("", S.allAges),
      ...FRESHNESS.map((fresh) => option(fresh, S.fresh[fresh])),
    );
    el.position = h(
      "select",
      { "aria-label": S.positionFilter, onchange: () => this._setFilter("position", el.position.value) },
      option("", S.allPositions),
      ...POSITIONS.map((position) => option(position, S.positions[position])),
    );
    el.sort = h(
      "select",
      {
        "aria-label": S.sortBy,
        onchange: () => {
          this._sort = el.sort.value;
          this._render();
        },
      },
      ...SORTS.map((sort) => option(sort, S.sorts[sort])),
    );
    el.counts = h("div", { class: "counts", role: "status" });
    el.list = h("ul", { class: "list", "aria-label": S.nodeList });
    const legendItem = (type, fresh, label) => h("li", null, shape(type, fresh), label);
    el.legend = h(
      "details",
      { class: "legend" },
      h("summary", null, S.legend),
      h("p", null, S.legendHint),
      h(
        "ul",
        null,
        ...TYPES.map((type) => legendItem(type, "fresh", S.types[type])),
        legendItem("companion", "fresh", S.companion),
      ),
      h(
        "ul",
        null,
        ...FRESHNESS.map((fresh) => legendItem("client", fresh, `${S.fresh[fresh]} (${S.freshHint[fresh]})`)),
      ),
      h(
        "ul",
        null,
        h("li", null, h("span", { class: "mm-cluster legend-cluster" }, "5"), S.cluster),
        h("li", null, h("span", { class: "legend-route" }), S.legendRoute),
      ),
    );
    el.details = h("section", { class: "details", "aria-label": S.details, hidden: true });
    el.aside = h(
      "aside",
      { "aria-label": S.nodes },
      h("div", { class: "filters" }, el.search, el.type, el.fresh, el.position, el.sort),
      el.counts,
      el.list,
    );

    this.shadowRoot.replaceChildren(
      h("style", null, STYLE),
      h(
        "div",
        { class: "panel", onkeydown: (ev) => ev.key === "Escape" && this._escape() },
        h("header", null, el.menu, h("h1", null, S.title), el.entrySelect, el.listToggle),
        el.status,
        h("div", { class: "body" }, el.main, el.aside),
      ),
    );
  }

  // Subscribes to snapshots on the current connection.
  _start() {
    const conn = this._hass?.connection;
    if (!conn || conn === this._conn) return;
    this._stop();
    this._conn = conn;
    this._error = null;
    const token = (this._token = {});
    const active = () => this._token === token;
    const fail = (err) => {
      if (!active()) return;
      this._error = err?.message || String(err);
      this._render();
    };
    let pushed = false;
    conn
      .subscribeMessage(
        (snapshot) => {
          if (!active()) return;
          pushed = true;
          this._setData(snapshot);
        },
        { type: "meshcore_map/subscribe" },
      )
      .then((unsubscribe) => {
        if (active()) this._unsubscribe = unsubscribe;
        else unsubscribe();
      }, fail);
    conn.sendMessagePromise({ type: "meshcore_map/snapshot" }).then((snapshot) => {
      if (active() && !pushed) this._setData(snapshot);
    }, fail);
  }

  _stop() {
    this._token = null;
    this._conn = null;
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = null;
  }

  _retry() {
    this._stop();
    this._error = null;
    this._render();
    this._start();
  }

  _setData(snapshot) {
    this._data = snapshot;
    this._error = null;
    this._render();
  }

  _setFilter(name, value) {
    this._filters[name] = value;
    this._render();
  }

  _toggleMenu() {
    this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  _setDrawer(open) {
    this._drawerOpen = open;
    this._layout();
  }

  _escape() {
    if (this._narrow && this._drawerOpen) this._setDrawer(false);
    else if (this._selected) this._select(null, false);
  }

  // Selects a node by key. pan moves the map to its marker.
  _select(key, pan) {
    this._selected = key;
    if (pan && this._narrow) this._setDrawer(false);
    this._render();
    if (!key) return;
    this._mapView.resized();
    if (pan) this._mapView.panTo(key);
    else this._el.list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }

  // Applies the narrow layout: drawer state and where the details pane sits.
  _layout() {
    const el = this._el;
    el.aside.classList.toggle("open", this._drawerOpen);
    el.listToggle.setAttribute("aria-expanded", String(this._drawerOpen));
    const parent = this._narrow ? el.main : el.aside;
    if (el.details.parentNode !== parent) parent.append(el.details);
    if (!this._legendSet) {
      this._legendSet = true;
      el.legend.open = !this._narrow;
    }
    this._renderMenu();
  }

  _renderMenu() {
    this._el.menu.hidden = !(this._narrow || this._hass?.dockedSidebar === "always_hidden");
  }

  _render() {
    const el = this._el;
    const now = Date.now();
    const entries = this._data?.entries || [];
    if (this._entryId && !entries.some((entry) => entry.entry_id === this._entryId)) this._entryId = null;

    const all = flattenNodes(entries, this._entryId, this._data?.stale_after_hours ?? 24, now);
    const items = sortItems(filterItems(all, this._filters), this._sort);
    if (this._selected && !items.some((item) => item.key === this._selected)) this._selected = null;
    const selected = items.find((item) => item.key === this._selected) || null;
    const shown = entries.filter((entry) => !this._entryId || entry.entry_id === this._entryId);

    const focusId = this.shadowRoot.activeElement?.dataset?.focusId;
    this._renderEntrySelect(entries);
    this._renderStatus(shown, now);
    this._renderBanner(entries, all);
    this._renderList(items, all, entries.length > 1 && !this._entryId, now);
    this._renderDetails(selected, entries.length > 1, now);
    if (focusId) this.shadowRoot.querySelector(`[data-focus-id="${CSS.escape(focusId)}"]`)?.focus();

    if (this._data) this._mapView.setTiles(this._data.tile_url, this._data.tile_attribution);
    this._mapView.setCompanions(
      shown
        .filter((entry) => hasPosition(entry.companion))
        .map((entry) => ({ ...entry.companion, name: entry.companion.name || entry.title })),
    );
    this._mapView.setNodes(items, this._selected);
    this._mapView.setRoute(selected ? routePlan(selected.node, selected.entry.companion).points : null);
  }

  _renderEntrySelect(entries) {
    const select = this._el.entrySelect;
    const key = JSON.stringify(entries.map((entry) => [entry.entry_id, entry.title]));
    if (key !== this._entriesKey) {
      this._entriesKey = key;
      select.replaceChildren(
        h("option", { value: "" }, S.allEntries),
        ...entries.map((entry) => h("option", { value: entry.entry_id }, entry.title)),
      );
    }
    select.value = this._entryId || "";
    select.hidden = entries.length < 2;
  }

  _renderStatus(entries, now) {
    this._el.status.replaceChildren(
      ...entries.map((entry) => {
        const state =
          entry.connected === true ? "connected" : entry.connected === false ? "disconnected" : "unknown";
        const label = { connected: S.connected, disconnected: S.disconnected, unknown: S.connectionUnknown }[state];
        const age = formatAge(entry.updated, now);
        return h(
          "span",
          { class: "entry-status" },
          h("span", { class: `dot ${state}` }),
          h("b", null, entry.title),
          `: ${label}`,
          state === "disconnected" && age ? `, ${S.lastData(age)}` : null,
          entry.error ? h("span", { class: "entry-error" }, ` — ${S.entryError(entry.error)}`) : null,
        );
      }),
    );
  }

  _renderBanner(entries, all) {
    const banner = this._el.banner;
    let text = null;
    if (this._error) text = S.loadFailed(this._error);
    else if (!this._data) text = S.loading;
    else if (!entries.length) text = S.noEntries;
    else if (!all.length) text = S.noContacts;
    else if (!all.some((item) => item.located)) text = S.noPositions(all.length);
    banner.hidden = !text;
    banner.classList.toggle("error", !!this._error);
    banner.replaceChildren(h("span", null, text || ""));
    if (this._error) {
      banner.append(h("button", { type: "button", "data-focus-id": "retry", onclick: () => this._retry() }, S.retry));
    }
  }

  _renderList(items, all, showEntry, now) {
    const el = this._el;
    const located = items.filter((item) => item.located).length;
    el.counts.textContent =
      items.length === all.length
        ? S.counts(items.length, located)
        : S.countsFiltered(items.length, located, all.length);
    if (!items.length) {
      el.list.replaceChildren(all.length ? h("li", { class: "empty" }, S.noMatches) : "");
      return;
    }
    el.list.replaceChildren(
      ...items.map((item) => {
        const name = item.node.name || item.node.pubkey_prefix;
        const sub = [S.types[item.type], S.fresh[item.fresh].toLowerCase()];
        if (item.seen !== null) sub.push(formatAge(new Date(item.seen).toISOString(), now));
        if (showEntry) sub.push(item.entry.title);
        return h(
          "li",
          null,
          h(
            "button",
            {
              class: item.located ? "item" : "item unmapped",
              type: "button",
              title: name,
              "data-focus-id": item.key,
              "aria-current": item.key === this._selected ? "true" : null,
              onclick: () => this._select(item.key, true),
            },
            shape(item.type, item.fresh),
            h(
              "span",
              { class: "text" },
              h("span", { class: "name" }, name),
              h("span", { class: "sub" }, sub.join(" · ")),
            ),
            item.located ? null : h("span", { class: "badge" }, S.noPosition),
          ),
        );
      }),
    );
  }

  _renderDetails(item, showEntry, now) {
    const details = this._el.details;
    details.hidden = !item;
    if (!item) {
      details.replaceChildren();
      return;
    }
    const node = item.node;
    const when = (iso) => {
      const age = formatAge(iso, now);
      if (!age) return S.never;
      return `${new Date(iso).toLocaleString(this._hass?.locale?.language)} (${age})`;
    };
    const row = (label, ...value) => [h("dt", null, label), h("dd", null, ...value)];
    // Reported advert time, with a note when the node clock is ahead or not set.
    const advertCell = () => {
      const clock = advertClock(node, now);
      if (clock === "none") return [S.never];
      const cell = [when(node.last_advert), " ", h("span", { class: "note" }, S.lastAdvertNote)];
      if (clock !== "ok") cell.push(h("div", { class: "note" }, clock === "ahead" ? S.clockAhead : S.clockUnset));
      return cell;
    };
    const plan = routePlan(node, item.entry.companion);
    details.replaceChildren(
      h(
        "div",
        { class: "details-head" },
        h("h2", null, node.name || node.pubkey_prefix),
        svgBox(
          "button",
          {
            class: "icon-button",
            type: "button",
            "aria-label": S.close,
            title: S.close,
            "data-focus-id": "close-details",
            onclick: () => this._select(null, false),
          },
          ICONS.close,
        ),
      ),
      h(
        "dl",
        null,
        ...row(S.type, `${S.types[item.type]}, ${S.fresh[item.fresh].toLowerCase()}`),
        ...row(
          S.lastHeard,
          ...(node.last_heard
            ? [when(node.last_heard), " ", h("span", { class: "note" }, S.lastHeardNote)]
            : [S.lastHeardNever]),
        ),
        ...(node.last_snr != null ? row(S.snr, S.snrValue(node.last_snr)) : []),
        ...(node.last_hop_count != null ? row(S.hopCount, String(node.last_hop_count)) : []),
        ...row(S.lastAdvert, ...advertCell()),
        ...row(S.position, item.located ? `${node.lat.toFixed(5)}, ${node.lon.toFixed(5)}` : S.positionNone),
        ...row(S.route, routeWords(node.route)),
        ...row(S.routeLine, plan.points ? S.routeDrawn : S.routeNotDrawn(plan.reason)),
        ...row(S.onContactList, node.added_to_node ? S.yes : S.no),
        ...row(S.keyPrefix, node.pubkey_prefix),
        ...(showEntry ? row(S.entry, item.entry.title) : []),
      ),
    );
  }
}

if (!customElements.get("meshcore-map-panel")) {
  customElements.define("meshcore-map-panel", MeshcoreMapPanel);
}
