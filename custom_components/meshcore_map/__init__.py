"""MeshMap: a map of MeshCore contacts."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from . import panel, websocket_api
from .collector import MapData
from .const import DOMAIN


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Start collecting and register the panel."""
    websocket_api.async_register(hass)
    data = MapData(hass, entry, lambda: websocket_api.async_notify(hass))
    hass.data[DOMAIN] = data
    await data.async_start()
    await panel.async_register_panel(hass)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    websocket_api.async_notify(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Stop collecting and remove the panel."""
    panel.async_remove_panel(hass)
    data: MapData | None = hass.data.pop(DOMAIN, None)
    if data is not None:
        data.stop()
    websocket_api.async_notify(hass)
    return True


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload after an options change."""
    await hass.config_entries.async_reload(entry.entry_id)
