"""MeshMap data model and route resolution. No Home Assistant imports."""

from __future__ import annotations

from datetime import datetime, timezone
import math
import time

NODE_TYPES = {1: "client", 2: "repeater", 3: "room_server", 4: "sensor"}

# Advert times outside this window are treated as a wrong node clock.
MIN_ADVERT_TIME = 1577836800  # 2020-01-01 UTC
MAX_CLOCK_AHEAD = 86400

MAX_HOPS = 64
_HEX = frozenset("0123456789abcdef")


def number(value) -> float | None:
    """Return a finite int or float as float, else None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def valid_position(lat, lon) -> tuple[float | None, float | None]:
    """Return (lat, lon) in degrees, or (None, None) when unset or invalid."""
    lat, lon = number(lat), number(lon)
    if lat is None or lon is None:
        return None, None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None, None
    if lat == 0 and lon == 0:
        return None, None
    return lat, lon


def node_type(value) -> str:
    """Map the numeric contact type to its name."""
    if isinstance(value, bool) or not isinstance(value, int):
        return "unknown"
    return NODE_TYPES.get(value, "unknown")


def advert_time(value, now: float | None = None) -> str | None:
    """Convert Unix seconds to ISO 8601 UTC, or None when unset or absurd."""
    ts = number(value)
    if now is None:
        now = time.time()
    if ts is None or ts < MIN_ADVERT_TIME or ts > now + MAX_CLOCK_AHEAD:
        return None
    return datetime.fromtimestamp(int(ts), timezone.utc).isoformat()


def clean_key(value) -> str | None:
    """Return a public key as lowercase hex, or None when it is not one."""
    if not isinstance(value, str):
        return None
    key = value.strip().lower()
    if len(key) < 12 or not set(key) <= _HEX:
        return None
    return key


def split_hops(out_path, hash_mode, path_len: int) -> list[str] | None:
    """Split the route hex into hop hashes, first hop nearest the companion."""
    if isinstance(hash_mode, bool) or hash_mode not in (0, 1, 2):
        return None
    if not isinstance(out_path, str):
        return None
    width = (hash_mode + 1) * 2
    path = out_path.lower()[: path_len * width]
    if len(path) < path_len * width or not set(path) <= _HEX:
        return None
    return [path[i : i + width] for i in range(0, len(path), width)]


def resolve_route(record: dict, own_key: str, nodes: list[dict]) -> dict:
    """Build the route of one contact, matching hop hashes to known nodes."""
    path_len = record.get("out_path_len")
    if isinstance(path_len, bool) or not isinstance(path_len, int) or path_len < 0:
        return {"state": "none", "hops": []}
    if path_len == 0:
        return {"state": "direct", "hops": []}
    if path_len > MAX_HOPS:
        return {"state": "unresolved", "hops": []}
    hashes = split_hops(
        record.get("out_path"), record.get("out_path_hash_mode"), path_len
    )
    if hashes is None:
        return {"state": "unresolved", "hops": []}

    hops = []
    resolved = True
    for hop_hash in hashes:
        matches = [
            node
            for node in nodes
            if node["public_key"] != own_key and node["public_key"].startswith(hop_hash)
        ]
        if len(matches) == 1:
            match = matches[0]
            hops.append(
                {
                    "hash": hop_hash,
                    "public_key": match["public_key"],
                    "name": match["name"],
                    "lat": match["lat"],
                    "lon": match["lon"],
                }
            )
        else:
            resolved = False
            hops.append(
                {
                    "hash": hop_hash,
                    "public_key": None,
                    "name": None,
                    "lat": None,
                    "lon": None,
                }
            )
    return {"state": "resolved" if resolved else "unresolved", "hops": hops}


def normalise_contact(record, now: float | None = None) -> dict | None:
    """Turn one get_contacts record into a node, without heard data or route."""
    if not isinstance(record, dict):
        return None
    key = clean_key(record.get("public_key"))
    if key is None:
        return None
    name = record.get("adv_name")
    lat, lon = valid_position(record.get("adv_lat"), record.get("adv_lon"))
    return {
        "public_key": key,
        "pubkey_prefix": key[:12],
        "name": name.strip() if isinstance(name, str) else "",
        "type": node_type(record.get("type")),
        "lat": lat,
        "lon": lon,
        "added_to_node": record.get("added_to_node") is True,
        "last_advert": advert_time(record.get("last_advert"), now),
        "last_heard": None,
        "last_snr": None,
        "last_hop_count": None,
        "route": {"state": "none", "hops": []},
    }


def build_nodes(
    contacts, heard: dict[str, dict] | None = None, now: float | None = None
) -> list[dict]:
    """Build the node list of one entry from its contact records."""
    pairs = {}
    for record in contacts:
        node = normalise_contact(record, now)
        if node is not None:
            pairs[node["public_key"]] = (node, record)
    nodes = [node for node, _ in pairs.values()]
    for node, record in pairs.values():
        node["route"] = resolve_route(record, node["public_key"], nodes)
        seen = (heard or {}).get(node["pubkey_prefix"])
        if seen:
            node["last_heard"] = seen.get("last_heard")
            node["last_snr"] = seen.get("last_snr")
            node["last_hop_count"] = seen.get("last_hop_count")
    return sorted(nodes, key=lambda node: node["public_key"])
