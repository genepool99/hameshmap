"""Diagnostics for MeshMap: counts only."""

from __future__ import annotations

from collections import Counter

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONF_ENTRIES, DOMAIN


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict:
    """Return counts for each MeshCore entry."""
    data = hass.data.get(DOMAIN)
    snapshot = data.snapshot() if data is not None else {"entries": []}
    entries = []
    for item in snapshot["entries"]:
        nodes = item["nodes"]
        entries.append(
            {
                "connected": item["connected"],
                "error": item["error"],
                "updated": item["updated"],
                "companion_has_position": bool(
                    item["companion"] and item["companion"]["lat"] is not None
                ),
                "nodes": len(nodes),
                "nodes_with_position": sum(
                    1 for node in nodes if node["lat"] is not None
                ),
                "node_types": dict(Counter(node["type"] for node in nodes)),
                "route_states": dict(Counter(node["route"]["state"] for node in nodes)),
            }
        )
    options = dict(entry.options)
    options[CONF_ENTRIES] = len(options.get(CONF_ENTRIES) or [])
    return {"options": options, "entries": entries}
