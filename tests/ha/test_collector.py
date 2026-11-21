"""Collector tests against a fake meshcore integration."""

from datetime import timedelta

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util

from .conftest import KEY_A, KEY_B, KEY_C, contact, snapshot


async def tick(hass, seconds=61):
    """Advance time past the refresh interval."""
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=seconds))
    await hass.async_block_till_done()


def message(entry_id, key, **extra):
    """Return meshcore_message event data for an incoming direct message."""
    data = {
        "entry_id": entry_id,
        "device_id": None,
        "message": "hello",
        "pubkey_prefix": key[:12],
        "timestamp": "2026-11-18T10:00:00.5+00:00",
        "message_type": "direct",
        "hop_count": 2,
        "snr": 6.25,
    }
    data.update(extra)
    return data


def add_companion_sensors(hass, entry, lat="52.5", lon="4.9", status="online"):
    """Register the companion sensors the way MeshCore names them."""
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={("meshcore", entry.entry_id)},
        name="MeshCore Base Station (abc123)",
    )
    registry = er.async_get(hass)
    for key, value in (("node_status", status), ("latitude", lat), ("longitude", lon)):
        entity = registry.async_get_or_create(
            "sensor",
            "meshcore",
            f"{entry.entry_id}_{key}_abc123",
            suggested_object_id=f"meshcore_abc123_{key}_base_station",
            config_entry=entry,
            device_id=device.id,
        )
        hass.states.async_set(entity.entity_id, value)
    # A tracked node sensor that must not be taken for the companion.
    other = registry.async_get_or_create(
        "sensor",
        "meshcore",
        f"{entry.entry_id}_latitude_def456abc0",
        suggested_object_id="meshcore_def456abc0_latitude_hill",
        config_entry=entry,
    )
    hass.states.async_set(other.entity_id, "10.0")


async def test_snapshot_from_get_contacts(hass, meshcore, setup_map):
    base = meshcore.add_entry(
        "Base",
        [
            contact(KEY_A),
            contact(KEY_B, type=1, adv_lat=0.0, adv_lon=0.0, added_to_node=False),
            contact(
                KEY_C, type=4, out_path_len=2, out_path="a1b2", out_path_hash_mode=0
            ),
        ],
    )
    await setup_map()

    snap = snapshot(hass)
    assert snap["stale_after_hours"] == 24
    assert snap["tile_url"] == "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    assert snap["tile_attribution"] == "© OpenStreetMap contributors"
    assert meshcore.calls == [base.entry_id]

    (entry,) = snap["entries"]
    assert entry["entry_id"] == base.entry_id
    assert entry["title"] == "Base"
    assert entry["error"] is None
    assert entry["connected"] is None
    assert entry["companion"] is None
    assert entry["updated"] is not None
    nodes = {node["public_key"]: node for node in entry["nodes"]}
    assert set(nodes) == {KEY_A, KEY_B, KEY_C}
    assert nodes[KEY_A] == {
        "public_key": KEY_A,
        "pubkey_prefix": KEY_A[:12],
        "name": "node a1",
        "type": "repeater",
        "lat": 52.1,
        "lon": 4.3,
        "added_to_node": True,
        "last_advert": "2026-11-18T11:06:40+00:00",
        "last_heard": None,
        "last_snr": None,
        "last_hop_count": None,
        "route": {"state": "none", "hops": []},
    }
    assert nodes[KEY_C]["type"] == "sensor"
    assert nodes[KEY_C]["route"]["state"] == "resolved"
    assert [hop["public_key"] for hop in nodes[KEY_C]["route"]["hops"]] == [
        KEY_A,
        KEY_B,
    ]


async def test_contact_without_location_has_null_position(hass, meshcore, setup_map):
    record = contact(KEY_A)
    del record["adv_lat"], record["adv_lon"]
    meshcore.add_entry("Base", [record, contact(KEY_B, adv_lat=0.0, adv_lon=0.0)])
    await setup_map()
    for node in snapshot(hass)["entries"][0]["nodes"]:
        assert node["lat"] is None
        assert node["lon"] is None


async def test_service_error_keeps_last_data(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [contact(KEY_A)])
    await setup_map()
    updated = snapshot(hass)["entries"][0]["updated"]

    meshcore.responses[base.entry_id] = {"contacts": [], "error": "coordinator_error"}
    await tick(hass)
    entry = snapshot(hass)["entries"][0]
    assert entry["error"] == "coordinator_error"
    assert [node["public_key"] for node in entry["nodes"]] == [KEY_A]
    assert entry["updated"] != updated

    meshcore.responses[base.entry_id] = HomeAssistantError("boom")
    await tick(hass)
    entry = snapshot(hass)["entries"][0]
    assert entry["error"] == "service_failed"
    assert len(entry["nodes"]) == 1

    meshcore.responses[base.entry_id] = {"contacts": [contact(KEY_B)]}
    await tick(hass)
    entry = snapshot(hass)["entries"][0]
    assert entry["error"] is None
    assert [node["public_key"] for node in entry["nodes"]] == [KEY_B]


async def test_error_at_setup_gives_empty_entry(hass, meshcore, setup_map):
    meshcore.add_entry("Base")
    await setup_map()
    entry = snapshot(hass)["entries"][0]
    assert entry["error"] == "no_coordinator"
    assert entry["nodes"] == []


async def test_service_missing(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [contact(KEY_A)])
    hass.services.async_remove("meshcore", "get_contacts")
    await setup_map()
    assert snapshot(hass)["entries"][0]["error"] == "service_unavailable"

    meshcore.register_service()
    await tick(hass)
    entry = snapshot(hass)["entries"][0]
    assert entry["error"] is None
    assert len(entry["nodes"]) == 1
    assert meshcore.calls == [base.entry_id]


async def test_refresh_interval_option(hass, meshcore, setup_map):
    meshcore.add_entry("Base", [contact(KEY_A)])
    await setup_map(refresh_seconds=300)
    await tick(hass, 61)
    assert len(meshcore.calls) == 1
    await tick(hass, 301)
    assert len(meshcore.calls) == 2


async def test_unchanged_refresh_does_not_notify(hass, meshcore, setup_map):
    meshcore.add_entry("Base", [contact(KEY_A)])
    await setup_map()
    updated = snapshot(hass)["entries"][0]["updated"]
    await tick(hass)
    assert len(meshcore.calls) == 2
    assert snapshot(hass)["entries"][0]["updated"] == updated


async def test_message_updates_only_matching_entry(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [contact(KEY_A), contact(KEY_B)])
    car = meshcore.add_entry("Car", [contact(KEY_A)])
    await setup_map()

    hass.bus.async_fire("meshcore_message", message(base.entry_id, KEY_A))
    hass.bus.async_fire("meshcore_message", message("other", KEY_B))
    hass.bus.async_fire("meshcore_message", {"message": "no entry"})
    await hass.async_block_till_done()

    entries = {item["entry_id"]: item for item in snapshot(hass)["entries"]}
    nodes = {node["public_key"]: node for node in entries[base.entry_id]["nodes"]}
    assert nodes[KEY_A]["last_heard"] == "2026-11-18T10:00:00.500000+00:00"
    assert nodes[KEY_A]["last_snr"] == 6.25
    assert nodes[KEY_A]["last_hop_count"] == 2
    assert nodes[KEY_B]["last_heard"] is None
    assert entries[car.entry_id]["nodes"][0]["last_heard"] is None


async def test_message_without_experimental_fields(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [contact(KEY_A)])
    await setup_map()
    data = message(base.entry_id, KEY_A)
    del data["snr"], data["hop_count"], data["timestamp"]
    hass.bus.async_fire("meshcore_message", data)
    await hass.async_block_till_done()
    node = snapshot(hass)["entries"][0]["nodes"][0]
    assert node["last_heard"] is not None
    assert node["last_snr"] is None
    assert node["last_hop_count"] is None


async def test_outgoing_and_prefixless_messages_are_ignored(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [contact(KEY_A)])
    await setup_map()
    hass.bus.async_fire(
        "meshcore_message", message(base.entry_id, KEY_A, outgoing=True)
    )
    data = message(base.entry_id, KEY_A)
    del data["pubkey_prefix"]
    hass.bus.async_fire("meshcore_message", data)
    await hass.async_block_till_done()
    assert snapshot(hass)["entries"][0]["nodes"][0]["last_heard"] is None


async def test_connected_and_disconnected_events(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [contact(KEY_A)])
    car = meshcore.add_entry("Car", [])
    await setup_map()

    def connected():
        return {
            item["entry_id"]: item["connected"] for item in snapshot(hass)["entries"]
        }

    assert connected() == {base.entry_id: None, car.entry_id: None}

    meshcore.responses[base.entry_id] = {"contacts": [contact(KEY_A), contact(KEY_B)]}
    hass.bus.async_fire(
        "meshcore_connected", {"entry_id": base.entry_id, "connection_type": "tcp"}
    )
    await hass.async_block_till_done()
    assert connected() == {base.entry_id: True, car.entry_id: None}
    assert meshcore.calls.count(base.entry_id) == 2
    assert meshcore.calls.count(car.entry_id) == 1
    assert len(snapshot(hass)["entries"][0]["nodes"]) == 2

    hass.bus.async_fire(
        "meshcore_disconnected", {"entry_id": base.entry_id, "unexpected": True}
    )
    hass.bus.async_fire("meshcore_disconnected", {"entry_id": "other"})
    await hass.async_block_till_done()
    assert connected() == {base.entry_id: False, car.entry_id: None}


async def test_companion_sensors(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [contact(KEY_A)])
    add_companion_sensors(hass, base)
    await setup_map()

    entry = snapshot(hass)["entries"][0]
    assert entry["companion"] == {"name": "Base Station", "lat": 52.5, "lon": 4.9}
    assert entry["connected"] is True

    hass.states.async_set("sensor.meshcore_abc123_node_status_base_station", "offline")
    hass.states.async_set("sensor.meshcore_abc123_latitude_base_station", "53.0")
    await hass.async_block_till_done()
    entry = snapshot(hass)["entries"][0]
    assert entry["connected"] is False
    assert entry["companion"]["lat"] == 53.0

    hass.states.async_set(
        "sensor.meshcore_abc123_node_status_base_station", "unavailable"
    )
    hass.states.async_set("sensor.meshcore_abc123_latitude_base_station", "unknown")
    await hass.async_block_till_done()
    entry = snapshot(hass)["entries"][0]
    assert entry["connected"] is False
    assert entry["companion"] == {"name": "Base Station", "lat": None, "lon": None}


async def test_companion_position_unset(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [])
    add_companion_sensors(hass, base, lat="0.0", lon="0.0", status="offline")
    await setup_map()
    entry = snapshot(hass)["entries"][0]
    assert entry["companion"] == {"name": "Base Station", "lat": None, "lon": None}
    assert entry["connected"] is False


async def test_companion_sensors_found_after_setup(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [])
    await setup_map()
    assert snapshot(hass)["entries"][0]["companion"] is None
    add_companion_sensors(hass, base)
    await tick(hass)
    assert snapshot(hass)["entries"][0]["companion"]["lat"] == 52.5


async def test_two_entries_are_kept_separate(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [contact(KEY_A), contact(KEY_B)])
    car = meshcore.add_entry("Car", [contact(KEY_C)])
    await setup_map()
    entries = snapshot(hass)["entries"]
    assert [item["title"] for item in entries] == ["Base", "Car"]
    assert [item["entry_id"] for item in entries] == [base.entry_id, car.entry_id]
    assert [node["public_key"] for node in entries[0]["nodes"]] == [KEY_A, KEY_B]
    assert [node["public_key"] for node in entries[1]["nodes"]] == [KEY_C]
    assert sorted(meshcore.calls) == sorted([base.entry_id, car.entry_id])


async def test_entry_selection_option(hass, meshcore, setup_map):
    meshcore.add_entry("Base", [contact(KEY_A)])
    car = meshcore.add_entry("Car", [contact(KEY_C)])
    await setup_map(entries=[car.entry_id])
    entries = snapshot(hass)["entries"]
    assert [item["entry_id"] for item in entries] == [car.entry_id]
    assert meshcore.calls == [car.entry_id]

    await meshcore.add_loaded_entry("Van", [contact(KEY_B)])
    assert [item["title"] for item in snapshot(hass)["entries"]] == ["Car"]


async def test_entries_added_and_removed_while_running(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [contact(KEY_A)])
    await setup_map()

    car = await meshcore.add_loaded_entry("Car", [contact(KEY_C)])
    entries = snapshot(hass)["entries"]
    assert [item["title"] for item in entries] == ["Base", "Car"]
    assert entries[1]["nodes"][0]["public_key"] == KEY_C

    meshcore.responses[car.entry_id] = {"contacts": [], "error": "no_coordinator"}
    assert await hass.config_entries.async_unload(car.entry_id)
    await hass.async_block_till_done()
    entry = snapshot(hass)["entries"][1]
    assert entry["error"] == "no_coordinator"
    assert len(entry["nodes"]) == 1

    meshcore.responses[car.entry_id] = {"contacts": [contact(KEY_C), contact(KEY_B)]}
    assert await hass.config_entries.async_setup(car.entry_id)
    await hass.async_block_till_done()
    entry = snapshot(hass)["entries"][1]
    assert entry["error"] is None
    assert len(entry["nodes"]) == 2

    hass.config_entries.async_update_entry(car, title="Auto")
    await hass.async_block_till_done()
    assert [item["title"] for item in snapshot(hass)["entries"]] == ["Auto", "Base"]

    await hass.config_entries.async_remove(base.entry_id)
    await hass.async_block_till_done()
    assert [item["title"] for item in snapshot(hass)["entries"]] == ["Auto"]

    hass.bus.async_fire("meshcore_message", message(base.entry_id, KEY_A))
    await hass.async_block_till_done()
    assert [item["title"] for item in snapshot(hass)["entries"]] == ["Auto"]
