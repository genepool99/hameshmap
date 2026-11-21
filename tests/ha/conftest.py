"""Fixtures for the Home Assistant level tests."""

from pathlib import Path

import pytest
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    MockModule,
    mock_config_flow,
    mock_integration,
    mock_platform,
)

from homeassistant.config_entries import ConfigFlow
from homeassistant.core import HomeAssistant, SupportsResponse
from homeassistant.setup import async_setup_component

from custom_components.meshcore_map import panel
from custom_components.meshcore_map.const import DOMAIN

KEY_A = "a1" + "0" * 62
KEY_B = "b2" + "1" * 62
KEY_C = "c3" + "2" * 62


def contact(key: str, **extra) -> dict:
    """Return a get_contacts record."""
    record = {
        "public_key": key,
        "pubkey_prefix": key[:12],
        "adv_name": "node " + key[:2],
        "type": 2,
        "flags": 0,
        "adv_lat": 52.1,
        "adv_lon": 4.3,
        "last_advert": 1795000000,
        "lastmod": 1795000000,
        "out_path_len": -1,
        "out_path": "",
        "out_path_hash_mode": -1,
        "added_to_node": True,
    }
    record.update(extra)
    return record


class FakeMeshCoreFlow(ConfigFlow):
    """Config flow handler of the fake meshcore integration."""


class FakeMeshCore:
    """A stand-in for the meshcore integration."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.responses: dict[str, object] = {}
        self.calls: list[str | None] = []

    def add_entry(self, title: str, contacts: list | None = None) -> MockConfigEntry:
        """Add a meshcore config entry with its contacts."""
        entry = MockConfigEntry(domain="meshcore", title=title)
        entry.add_to_hass(self.hass)
        if contacts is not None:
            self.responses[entry.entry_id] = {"contacts": contacts}
        return entry

    async def add_loaded_entry(self, title: str, contacts: list) -> MockConfigEntry:
        """Add a meshcore config entry through the config entry manager."""
        entry = MockConfigEntry(domain="meshcore", title=title)
        self.responses[entry.entry_id] = {"contacts": contacts}
        await self.hass.config_entries.async_add(entry)
        await self.hass.async_block_till_done()
        return entry

    async def get_contacts(self, call):
        """Answer meshcore.get_contacts."""
        entry_id = call.data.get("entry_id")
        self.calls.append(entry_id)
        response = self.responses.get(
            entry_id, {"contacts": [], "error": "no_coordinator"}
        )
        if isinstance(response, Exception):
            raise response
        return response

    def register_service(self) -> None:
        """Register meshcore.get_contacts."""
        self.hass.services.async_register(
            "meshcore",
            "get_contacts",
            self.get_contacts,
            supports_response=SupportsResponse.ONLY,
        )


@pytest.fixture(autouse=True)
def _custom_integrations(enable_custom_integrations):
    """Let Home Assistant load custom_components/meshcore_map."""


@pytest.fixture(autouse=True)
def bundle(tmp_path, monkeypatch) -> Path:
    """Point the panel at a temporary bundle file."""
    path = tmp_path / "meshcore-map-panel.js"
    path.write_text("// test bundle\n")
    monkeypatch.setattr(panel, "BUNDLE_PATH", path)
    return path


@pytest.fixture
async def meshcore(hass: HomeAssistant) -> FakeMeshCore:
    """Provide a fake meshcore integration and the real http and websocket_api."""

    async def _ok(hass, entry):
        return True

    mock_integration(
        hass, MockModule("meshcore", async_setup_entry=_ok, async_unload_entry=_ok)
    )
    mock_platform(hass, "meshcore.config_flow", None)
    hass.config.components.add("frontend")
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "websocket_api", {})
    fake = FakeMeshCore(hass)
    fake.register_service()
    with mock_config_flow("meshcore", FakeMeshCoreFlow):
        yield fake


@pytest.fixture
def setup_map(hass: HomeAssistant):
    """Return a function that sets up MeshMap with the given options."""

    async def _setup(**options) -> MockConfigEntry:
        entry = MockConfigEntry(domain=DOMAIN, title="MeshMap", options=options)
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        return entry

    return _setup


def snapshot(hass: HomeAssistant) -> dict:
    """Return the current MeshMap snapshot."""
    return hass.data[DOMAIN].snapshot()
