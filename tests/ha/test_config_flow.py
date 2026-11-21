"""Config and options flow tests."""

from homeassistant.config_entries import SOURCE_USER, ConfigEntryState
from homeassistant.data_entry_flow import FlowResultType

from custom_components.meshcore_map.const import DOMAIN


async def test_abort_without_meshcore_entries(hass, meshcore):
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "meshcore_not_configured"


async def test_create_entry(hass, meshcore):
    meshcore.add_entry("Base", [])
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "MeshMap"
    assert hass.config_entries.async_entries(DOMAIN)[0].state is ConfigEntryState.LOADED


async def test_second_entry_is_refused(hass, meshcore, setup_map):
    meshcore.add_entry("Base", [])
    await setup_map()
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


async def test_options_flow_stores_values_and_reloads(hass, meshcore, setup_map):
    base = meshcore.add_entry("Base", [])
    meshcore.add_entry("Car", [])
    entry = await setup_map()
    before = hass.data[DOMAIN]

    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            "entries": [base.entry_id],
            "stale_after_hours": 48.0,
            "refresh_seconds": 120.0,
            "tile_url": " https://tiles.example.org/{z}/{x}/{y}.png ",
            "tile_attribution": "Example",
        },
    )
    await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options == {
        "entries": [base.entry_id],
        "stale_after_hours": 48,
        "refresh_seconds": 120,
        "tile_url": "https://tiles.example.org/{z}/{x}/{y}.png",
        "tile_attribution": "Example",
    }
    assert isinstance(entry.options["stale_after_hours"], int)

    after = hass.data[DOMAIN]
    assert after is not before
    snap = after.snapshot()
    assert [item["entry_id"] for item in snap["entries"]] == [base.entry_id]
    assert snap["stale_after_hours"] == 48
    assert snap["tile_url"] == "https://tiles.example.org/{z}/{x}/{y}.png"
    assert snap["tile_attribution"] == "Example"


async def test_options_flow_rejects_bad_tile_url(hass, meshcore, setup_map):
    meshcore.add_entry("Base", [])
    entry = await setup_map()
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            "entries": [],
            "stale_after_hours": 24,
            "refresh_seconds": 60,
            "tile_url": "https://tiles.example.org/map.png",
            "tile_attribution": "Example",
        },
    )
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"tile_url": "invalid_tile_url"}
    assert entry.options == {}
