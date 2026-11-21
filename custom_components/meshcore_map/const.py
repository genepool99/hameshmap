"""Constants for MeshMap."""

DOMAIN = "meshcore_map"
MESHCORE_DOMAIN = "meshcore"

CONF_ENTRIES = "entries"
CONF_STALE_AFTER_HOURS = "stale_after_hours"
CONF_REFRESH_SECONDS = "refresh_seconds"
CONF_TILE_URL = "tile_url"
CONF_TILE_ATTRIBUTION = "tile_attribution"

DEFAULT_STALE_AFTER_HOURS = 24
DEFAULT_REFRESH_SECONDS = 60
DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
DEFAULT_TILE_ATTRIBUTION = "© OpenStreetMap contributors"
