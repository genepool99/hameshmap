"""Sidebar panel registration for MeshMap."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, callback
from homeassistant.loader import async_get_integration

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

BUNDLE_PATH = Path(__file__).parent / "frontend" / "meshcore-map-panel.js"
BUNDLE_URL = "/meshcore_map_panel/meshcore-map-panel.js"
PANEL_URL_PATH = "meshcore-map"
PANEL_ELEMENT = "meshcore-map-panel"
PANEL_TITLE = "MeshMap"
PANEL_ICON = "mdi:map-marker-radius"

_STATIC_REGISTERED = f"{DOMAIN}_static_registered"


async def async_register_panel(hass: HomeAssistant) -> None:
    """Serve the panel bundle and add the sidebar panel."""
    if not await hass.async_add_executor_job(BUNDLE_PATH.is_file):
        _LOGGER.error(
            "Panel bundle %s is missing; the panel is not registered", BUNDLE_PATH
        )
        return
    if not hass.data.get(_STATIC_REGISTERED):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(BUNDLE_URL, str(BUNDLE_PATH), cache_headers=False)]
        )
        hass.data[_STATIC_REGISTERED] = True
    integration = await async_get_integration(hass, DOMAIN)
    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL_PATH,
        config={
            "_panel_custom": {
                "name": PANEL_ELEMENT,
                "module_url": f"{BUNDLE_URL}?v={integration.version}",
            }
        },
        require_admin=False,
    )


@callback
def async_remove_panel(hass: HomeAssistant) -> None:
    """Remove the sidebar panel."""
    frontend.async_remove_panel(hass, PANEL_URL_PATH, warn_if_unknown=False)
