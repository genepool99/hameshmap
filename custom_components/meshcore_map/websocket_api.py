"""WebSocket API for the MeshMap panel."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .collector import options_snapshot
from .const import DOMAIN

_SUBSCRIBERS = f"{DOMAIN}_subscribers"


@callback
def async_register(hass: HomeAssistant) -> None:
    """Register the WebSocket commands."""
    websocket_api.async_register_command(hass, ws_snapshot)
    websocket_api.async_register_command(hass, ws_subscribe)


@callback
def async_snapshot(hass: HomeAssistant) -> dict:
    """Return the current snapshot, empty when the integration is not loaded."""
    data = hass.data.get(DOMAIN)
    if data is None:
        return {"entries": [], **options_snapshot({})}
    return data.snapshot()


@callback
def async_notify(hass: HomeAssistant) -> None:
    """Send the current snapshot to every subscriber."""
    subscribers = hass.data.get(_SUBSCRIBERS)
    if not subscribers:
        return
    snapshot = async_snapshot(hass)
    for send in list(subscribers):
        send(snapshot)


@websocket_api.websocket_command({vol.Required("type"): "meshcore_map/snapshot"})
@callback
def ws_snapshot(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Return the current snapshot."""
    connection.send_result(msg["id"], async_snapshot(hass))


@websocket_api.websocket_command({vol.Required("type"): "meshcore_map/subscribe"})
@callback
def ws_subscribe(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Return the current snapshot and push every later one."""
    subscribers: set = hass.data.setdefault(_SUBSCRIBERS, set())

    @callback
    def send(snapshot: dict) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], snapshot))

    subscribers.add(send)
    connection.subscriptions[msg["id"]] = lambda: subscribers.discard(send)
    connection.send_result(msg["id"], async_snapshot(hass))
