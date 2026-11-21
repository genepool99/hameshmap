"""Setup, unload, panel, WebSocket and diagnostics tests."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from homeassistant.config_entries import ConfigEntryState
from homeassistant.util import dt as dt_util

from custom_components.meshcore_map.const import DOMAIN
from custom_components.meshcore_map.diagnostics import (
    async_get_config_entry_diagnostics,
)

from .conftest import KEY_A, KEY_B, KEY_C, contact, snapshot

EVENTS = ("meshcore_message", "meshcore_connected", "meshcore_disconnected")
PANELS = "frontend_panels"


async def test_panel_is_registered(hass, meshcore, setup_map, hass_client):
    meshcore.add_entry("Base", [])
    await setup_map()
    registered = hass.data[PANELS]["meshcore-map"]
    assert registered.component_name == "custom"
    assert registered.sidebar_title == "MeshMap"
    assert registered.sidebar_icon == "mdi:map-marker-radius"
    assert registered.require_admin is False
    assert registered.config["_panel_custom"] == {
        "name": "meshcore-map-panel",
        "module_url": "/meshcore_map_panel/meshcore-map-panel.js?v=0.1.0",
    }
    client = await hass_client()
    response = await client.get("/meshcore_map_panel/meshcore-map-panel.js?v=0.1.0")
    assert response.status == 200
    assert "test bundle" in await response.text()


async def test_missing_bundle_still_sets_up(hass, meshcore, setup_map, bundle, caplog):
    bundle.unlink()
    meshcore.add_entry("Base", [contact(KEY_A)])
    entry = await setup_map()
    assert entry.state is ConfigEntryState.LOADED
    assert "meshcore-map" not in hass.data.get(PANELS, {})
    assert "bundle" in caplog.text
    assert len(snapshot(hass)["entries"][0]["nodes"]) == 1
    assert await hass.config_entries.async_unload(entry.entry_id)


async def test_unload_removes_listeners_and_panel(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [contact(KEY_A)])
    meshcore.add_entry("Car", [])
    before = {event: hass.bus.async_listeners().get(event, 0) for event in EVENTS}
    entry = await setup_map()
    listeners = hass.bus.async_listeners()
    assert all(listeners[event] == before[event] + 2 for event in EVENTS)
    assert "meshcore-map" in hass.data[PANELS]

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    listeners = hass.bus.async_listeners()
    assert all(listeners.get(event, 0) == before[event] for event in EVENTS)
    assert "meshcore-map" not in hass.data[PANELS]
    assert DOMAIN not in hass.data

    calls = len(meshcore.calls)
    hass.bus.async_fire("meshcore_connected", {"entry_id": base.entry_id})
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=3600))
    await hass.async_block_till_done()
    assert len(meshcore.calls) == calls


async def test_reload_registers_panel_again(hass, meshcore, setup_map):
    meshcore.add_entry("Base", [contact(KEY_A)])
    entry = await setup_map()
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    assert "meshcore-map" in hass.data[PANELS]
    assert len(snapshot(hass)["entries"][0]["nodes"]) == 1


async def test_ws_snapshot(hass, meshcore, setup_map, hass_ws_client):
    base = meshcore.add_entry("Base", [contact(KEY_A)])
    await setup_map(stale_after_hours=12)
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "meshcore_map/snapshot"})
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"] == snapshot(hass)
    assert msg["result"]["stale_after_hours"] == 12
    assert msg["result"]["entries"][0]["entry_id"] == base.entry_id
    assert set(msg["result"]["entries"][0]) == {
        "entry_id",
        "title",
        "connected",
        "error",
        "updated",
        "companion",
        "nodes",
    }


async def test_ws_needs_no_admin(
    hass, meshcore, setup_map, hass_ws_client, hass_read_only_access_token
):
    meshcore.add_entry("Base", [contact(KEY_A)])
    await setup_map()
    client = await hass_ws_client(hass, hass_read_only_access_token)
    await client.send_json({"id": 1, "type": "meshcore_map/snapshot"})
    assert (await client.receive_json())["success"]
    await client.send_json({"id": 2, "type": "meshcore_map/subscribe"})
    assert (await client.receive_json())["success"]


async def test_ws_subscribe_pushes_changes(hass, meshcore, setup_map, hass_ws_client):
    base = meshcore.add_entry("Base", [contact(KEY_A)])
    await setup_map()
    client = await hass_ws_client(hass)
    await client.send_json({"id": 5, "type": "meshcore_map/subscribe"})
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"] == snapshot(hass)

    hass.bus.async_fire(
        "meshcore_message",
        {
            "entry_id": base.entry_id,
            "pubkey_prefix": KEY_A[:12],
            "timestamp": "2026-11-18T10:00:00+00:00",
            "hop_count": 0,
        },
    )
    msg = await client.receive_json()
    assert msg["id"] == 5
    assert msg["type"] == "event"
    assert msg["event"] == snapshot(hass)
    node = msg["event"]["entries"][0]["nodes"][0]
    assert node["last_heard"] == "2026-11-18T10:00:00+00:00"
    assert node["last_hop_count"] == 0

    subscribers = hass.data["meshcore_map_subscribers"]
    assert len(subscribers) == 1
    await client.send_json({"id": 6, "type": "unsubscribe_events", "subscription": 5})
    assert (await client.receive_json())["success"]
    assert len(subscribers) == 0


async def test_ws_subscription_survives_reload_and_unload(
    hass, meshcore, setup_map, hass_ws_client
):
    meshcore.add_entry("Base", [contact(KEY_A)])
    entry = await setup_map()
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "meshcore_map/subscribe"})
    await client.receive_json()

    hass.config_entries.async_update_entry(entry, options={"stale_after_hours": 6})
    await hass.async_block_till_done()
    msg = await client.receive_json()
    while msg["event"]["stale_after_hours"] != 6 or not msg["event"]["entries"]:
        msg = await client.receive_json()
    assert len(msg["event"]["entries"][0]["nodes"]) == 1

    assert await hass.config_entries.async_unload(entry.entry_id)
    msg = await client.receive_json()
    while msg["event"]["entries"]:
        msg = await client.receive_json()
    assert msg["event"]["stale_after_hours"] == 24

    await client.send_json({"id": 2, "type": "meshcore_map/snapshot"})
    msg = await client.receive_json()
    while msg["id"] != 2:
        msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["entries"] == []


async def test_ws_empty_when_no_meshcore_entry_matches(
    hass, meshcore, setup_map, hass_ws_client
):
    meshcore.add_entry("Base", [contact(KEY_A)])
    await setup_map(entries=["gone"])
    client = await hass_ws_client(hass)
    await client.send_json({"id": 1, "type": "meshcore_map/subscribe"})
    msg = await client.receive_json()
    assert msg["success"]
    assert msg["result"]["entries"] == []


async def test_diagnostics_has_counts_only(hass, meshcore, setup_map):
    base = meshcore.add_entry(
        "Secret Base",
        [
            contact(KEY_A, adv_name="Secret Hill"),
            contact(KEY_B, adv_lat=0, adv_lon=0, out_path_len=0),
            contact(KEY_C, out_path_len=1, out_path="ee", out_path_hash_mode=0, type=1),
        ],
    )
    entry = await setup_map(entries=[base.entry_id])
    result = await async_get_config_entry_diagnostics(hass, entry)
    assert result["options"]["entries"] == 1
    (item,) = result["entries"]
    assert item["nodes"] == 3
    assert item["nodes_with_position"] == 2
    assert item["node_types"] == {"repeater": 2, "client": 1}
    assert item["route_states"] == {"none": 1, "direct": 1, "unresolved": 1}
    assert item["error"] is None
    text = str(result)
    for secret in (KEY_A[:12], KEY_B[:12], "Secret", "52.1", "4.3", base.entry_id):
        assert secret not in text
