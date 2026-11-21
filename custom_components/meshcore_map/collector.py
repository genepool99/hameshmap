"""Collects MeshCore contacts and events for the map."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
import logging
import re

from homeassistant.config_entries import SIGNAL_CONFIG_ENTRY_CHANGED, ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import (
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.util import dt as dt_util

from .const import (
    CONF_ENTRIES,
    CONF_REFRESH_SECONDS,
    CONF_STALE_AFTER_HOURS,
    CONF_TILE_ATTRIBUTION,
    CONF_TILE_URL,
    DEFAULT_REFRESH_SECONDS,
    DEFAULT_STALE_AFTER_HOURS,
    DEFAULT_TILE_ATTRIBUTION,
    DEFAULT_TILE_URL,
    MESHCORE_DOMAIN,
)
from .model import build_nodes, number, valid_position

_LOGGER = logging.getLogger(__name__)

SERVICE_GET_CONTACTS = "get_contacts"
EVENT_MESSAGE = "meshcore_message"
EVENT_CONNECTED = "meshcore_connected"
EVENT_DISCONNECTED = "meshcore_disconnected"

_SENSOR_RE = re.compile(
    r"^sensor\.meshcore_[0-9a-f]{6}_(node_status|latitude|longitude)(?:_|$)"
)
_DEVICE_NAME_RE = re.compile(r"^MeshCore (.+) \([0-9a-f]{6}\)$")


def options_snapshot(options) -> dict:
    """Return the map settings sent to the panel."""
    return {
        "stale_after_hours": options.get(
            CONF_STALE_AFTER_HOURS, DEFAULT_STALE_AFTER_HOURS
        ),
        "tile_url": options.get(CONF_TILE_URL, DEFAULT_TILE_URL),
        "tile_attribution": options.get(
            CONF_TILE_ATTRIBUTION, DEFAULT_TILE_ATTRIBUTION
        ),
    }


def _iso_utc(value) -> str:
    """Return an event timestamp as ISO 8601 UTC, or the current time."""
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            parsed = None
        if parsed is not None and parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).isoformat()
    return dt_util.utcnow().isoformat()


class EntryCollector:
    """Holds the map data of one MeshCore config entry."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry_id: str,
        title: str,
        on_change: Callable[[], None],
    ) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.title = title
        self._on_change = on_change
        self._contacts: list = []
        self._heard: dict[str, dict] = {}
        self._connected: bool | None = None
        self._error: str | None = None
        self._sensors: dict[str, str] = {}
        self._unsubs: list[Callable[[], None]] = []
        self._unsub_sensors: Callable[[], None] | None = None
        self._lock = asyncio.Lock()
        self._stopped = False
        self._updated: str | None = None
        self._data = self._build()

    @property
    def snapshot(self) -> dict:
        """Return the current entry snapshot."""
        data = self._data
        return {
            "entry_id": data["entry_id"],
            "title": data["title"],
            "connected": data["connected"],
            "error": data["error"],
            "updated": self._updated,
            "companion": data["companion"],
            "nodes": data["nodes"],
        }

    @callback
    def start(self) -> None:
        """Listen for MeshCore events."""
        bus = self.hass.bus
        self._unsubs = [
            bus.async_listen(EVENT_MESSAGE, self._on_message),
            bus.async_listen(EVENT_CONNECTED, self._on_connected),
            bus.async_listen(EVENT_DISCONNECTED, self._on_disconnected),
        ]
        self._watch_sensors()

    @callback
    def stop(self) -> None:
        """Remove every listener."""
        self._stopped = True
        for unsub in self._unsubs:
            unsub()
        self._unsubs = []
        if self._unsub_sensors is not None:
            self._unsub_sensors()
            self._unsub_sensors = None

    @callback
    def set_title(self, title: str) -> None:
        """Update the entry title."""
        self.title = title
        self._publish()

    async def async_refresh(self) -> None:
        """Load the contacts from MeshCore and publish the result."""
        async with self._lock:
            if self._stopped:
                return
            contacts, error = await self._fetch_contacts()
            if self._stopped:
                return
            if contacts is not None:
                self._contacts = contacts
                known = {
                    str(record.get("public_key", ""))[:12].lower()
                    for record in contacts
                    if isinstance(record, dict)
                }
                self._heard = {
                    prefix: seen
                    for prefix, seen in self._heard.items()
                    if prefix in known
                }
            if error != self._error:
                _LOGGER.debug("Contact refresh result changed to %s", error or "ok")
            self._error = error
            self._watch_sensors()
            self._publish()

    async def _fetch_contacts(self) -> tuple[list | None, str | None]:
        """Call meshcore.get_contacts and return (contacts, error)."""
        if not self.hass.services.has_service(MESHCORE_DOMAIN, SERVICE_GET_CONTACTS):
            return None, "service_unavailable"
        try:
            response = await self.hass.services.async_call(
                MESHCORE_DOMAIN,
                SERVICE_GET_CONTACTS,
                {"entry_id": self.entry_id},
                blocking=True,
                return_response=True,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("meshcore.get_contacts failed: %s", type(err).__name__)
            return None, "service_failed"
        if not isinstance(response, dict):
            return None, "invalid_response"
        if response.get("error"):
            return None, str(response["error"])
        contacts = response.get("contacts")
        if not isinstance(contacts, list):
            return None, "invalid_response"
        return contacts, None

    @callback
    def _on_message(self, event: Event) -> None:
        """Record when a contact was last heard."""
        data = event.data
        if data.get("entry_id") != self.entry_id or data.get("outgoing"):
            return
        prefix = data.get("pubkey_prefix")
        if not isinstance(prefix, str) or not prefix:
            return
        hop_count = data.get("hop_count")
        if isinstance(hop_count, bool) or not isinstance(hop_count, int):
            hop_count = None
        self._heard[prefix.lower()] = {
            "last_heard": _iso_utc(data.get("timestamp")),
            "last_snr": number(data.get("snr")),
            "last_hop_count": hop_count,
        }
        self._publish()

    @callback
    def _on_connected(self, event: Event) -> None:
        """Mark the companion connected and reload the contacts."""
        if event.data.get("entry_id") != self.entry_id:
            return
        self._connected = True
        self._publish()
        self.hass.async_create_task(self.async_refresh())

    @callback
    def _on_disconnected(self, event: Event) -> None:
        """Mark the companion disconnected."""
        if event.data.get("entry_id") != self.entry_id:
            return
        self._connected = False
        self._publish()

    @callback
    def _watch_sensors(self) -> None:
        """Find the companion sensors of this entry and follow their state."""
        registry = er.async_get(self.hass)
        sensors = {}
        for entity in er.async_entries_for_config_entry(registry, self.entry_id):
            match = _SENSOR_RE.match(entity.entity_id)
            if match and entity.platform == MESHCORE_DOMAIN:
                sensors.setdefault(match.group(1), entity.entity_id)
        if sensors == self._sensors:
            return
        if self._unsub_sensors is not None:
            self._unsub_sensors()
            self._unsub_sensors = None
        self._sensors = sensors
        if sensors:
            self._unsub_sensors = async_track_state_change_event(
                self.hass, list(sensors.values()), self._on_sensor
            )
        if "node_status" in sensors:
            self._set_status(self.hass.states.get(sensors["node_status"]))

    @callback
    def _on_sensor(self, event: Event) -> None:
        """Apply a companion sensor state change."""
        if event.data["entity_id"] == self._sensors.get("node_status"):
            self._set_status(event.data["new_state"])
        self._publish()

    def _set_status(self, state) -> None:
        """Derive the link state from the node status sensor."""
        if state is None:
            return
        if state.state == "online":
            self._connected = True
        elif state.state in ("offline", "unavailable"):
            self._connected = False

    def _sensor_float(self, key: str) -> float | None:
        """Read a companion sensor state as a number."""
        entity_id = self._sensors.get(key)
        state = self.hass.states.get(entity_id) if entity_id else None
        if state is None:
            return None
        try:
            return float(state.state)
        except ValueError:
            return None

    def _companion_name(self) -> str | None:
        """Read the companion name from its device name."""
        registry = er.async_get(self.hass)
        for entity_id in self._sensors.values():
            entity = registry.async_get(entity_id)
            if entity is None or entity.device_id is None:
                continue
            device = dr.async_get(self.hass).async_get(entity.device_id)
            match = _DEVICE_NAME_RE.match(device.name or "") if device else None
            if match:
                return match.group(1)
        return None

    def _build(self) -> dict:
        """Build the entry data without the update time."""
        companion = None
        if self._sensors:
            lat, lon = valid_position(
                self._sensor_float("latitude"), self._sensor_float("longitude")
            )
            companion = {"name": self._companion_name(), "lat": lat, "lon": lon}
        return {
            "entry_id": self.entry_id,
            "title": self.title,
            "connected": self._connected,
            "error": self._error,
            "companion": companion,
            "nodes": build_nodes(self._contacts, self._heard),
        }

    @callback
    def _publish(self) -> None:
        """Rebuild the entry data and notify when it changed."""
        data = self._build()
        if data == self._data and self._updated is not None:
            return
        self._data = data
        self._updated = dt_util.utcnow().isoformat()
        self._on_change()


class MapData:
    """Keeps one collector for each selected MeshCore config entry."""

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, on_change: Callable[[], None]
    ) -> None:
        self.hass = hass
        self._entry = entry
        self._on_change = on_change
        self._collectors: dict[str, EntryCollector] = {}
        self._unsubs: list[Callable[[], None]] = []

    @property
    def collectors(self) -> list[EntryCollector]:
        """Return the collectors ordered by title."""
        return sorted(
            self._collectors.values(), key=lambda item: (item.title, item.entry_id)
        )

    def snapshot(self) -> dict:
        """Return the full snapshot for the panel."""
        return {
            "entries": [collector.snapshot for collector in self.collectors],
            **options_snapshot(self._entry.options),
        }

    async def async_start(self) -> None:
        """Create the collectors, load them and start the refresh timer."""
        refresh = self._entry.options.get(CONF_REFRESH_SECONDS, DEFAULT_REFRESH_SECONDS)
        self._unsubs = [
            async_dispatcher_connect(
                self.hass, SIGNAL_CONFIG_ENTRY_CHANGED, self._on_entry_changed
            ),
            async_track_time_interval(
                self.hass, self._on_timer, timedelta(seconds=refresh)
            ),
        ]
        await self._async_refresh(self._sync())

    @callback
    def stop(self) -> None:
        """Stop every collector, listener and timer."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs = []
        for collector in self._collectors.values():
            collector.stop()
        self._collectors = {}

    @callback
    def _sync(self) -> list[EntryCollector]:
        """Match the collectors to the MeshCore entries and return new ones."""
        selected = self._entry.options.get(CONF_ENTRIES) or []
        wanted = {
            entry.entry_id: entry.title
            for entry in self.hass.config_entries.async_entries(MESHCORE_DOMAIN)
            if not entry.disabled_by and (not selected or entry.entry_id in selected)
        }
        removed = [entry_id for entry_id in self._collectors if entry_id not in wanted]
        for entry_id in removed:
            self._collectors.pop(entry_id).stop()
        added = []
        for entry_id, title in wanted.items():
            collector = self._collectors.get(entry_id)
            if collector is None:
                collector = EntryCollector(self.hass, entry_id, title, self._on_change)
                self._collectors[entry_id] = collector
                collector.start()
                added.append(collector)
            elif collector.title != title:
                collector.set_title(title)
        if removed:
            self._on_change()
        return added

    async def _async_refresh(self, collectors: list[EntryCollector]) -> None:
        """Refresh the given collectors."""
        for collector in collectors:
            await collector.async_refresh()

    async def _on_timer(self, _now: datetime) -> None:
        """Refresh every collector."""
        self._sync()
        await self._async_refresh(list(self._collectors.values()))

    @callback
    def _on_entry_changed(self, _change, entry: ConfigEntry) -> None:
        """Follow MeshCore entries being added, removed, loaded or unloaded."""
        if entry.domain != MESHCORE_DOMAIN:
            return
        self._sync()
        collector = self._collectors.get(entry.entry_id)
        if collector is not None:
            self.hass.async_create_task(collector.async_refresh())
