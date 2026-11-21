"""Tests for model.py. Run with plain pytest; Home Assistant is not needed."""

import importlib.util
from pathlib import Path

_PATH = Path(__file__).parent.parent / "custom_components/meshcore_map/model.py"
_SPEC = importlib.util.spec_from_file_location("meshcore_map_model", _PATH)
model = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(model)

NOW = 1795000000
A = "a1" + "0" * 62
B = "b2c3" + "1" * 60
C = "c4d5e6" + "2" * 58
D = "a1ff" + "3" * 60


def contact(key, **extra):
    record = {
        "public_key": key,
        "adv_name": "node " + key[:2],
        "type": 2,
        "adv_lat": 52.1,
        "adv_lon": 4.3,
        "last_advert": NOW - 60,
        "out_path_len": -1,
        "out_path": "",
        "out_path_hash_mode": -1,
        "added_to_node": True,
    }
    record.update(extra)
    return record


def by_key(nodes):
    return {node["public_key"]: node for node in nodes}


def test_valid_position_accepts_real_coordinates():
    assert model.valid_position(52.1, 4.3) == (52.1, 4.3)
    assert model.valid_position(-33, 151) == (-33.0, 151.0)
    assert model.valid_position(0, 4.3) == (0.0, 4.3)
    assert model.valid_position(-90, 180) == (-90.0, 180.0)


def test_valid_position_rejects_unset_and_invalid():
    none = (None, None)
    assert model.valid_position(0, 0) == none
    assert model.valid_position(0.0, 0.0) == none
    assert model.valid_position(None, 4.3) == none
    assert model.valid_position(52.1, None) == none
    assert model.valid_position("52.1", "4.3") == none
    assert model.valid_position(True, 4.3) == none
    assert model.valid_position(90.01, 4.3) == none
    assert model.valid_position(52.1, -180.5) == none
    assert model.valid_position(float("nan"), 4.3) == none
    assert model.valid_position(52.1, float("inf")) == none


def test_node_type():
    assert [model.node_type(value) for value in (1, 2, 3, 4)] == [
        "client",
        "repeater",
        "room_server",
        "sensor",
    ]
    for value in (0, 5, None, "2", 2.0, True):
        assert model.node_type(value) == "unknown"


def test_advert_time():
    assert model.advert_time(1795000000, NOW) == "2026-11-18T11:06:40+00:00"
    assert model.advert_time(1795000000.9, NOW) == "2026-11-18T11:06:40+00:00"
    for value in (0, -1, 12345, None, "1795000000", True, float("nan")):
        assert model.advert_time(value, NOW) is None
    assert model.advert_time(NOW + 3600, NOW) is not None
    assert model.advert_time(NOW + 2 * 86400, NOW) is None
    assert model.advert_time(4102444800, NOW) is None


def test_split_hops_by_hash_mode():
    assert model.split_hops("a1b2c3", 0, 3) == ["a1", "b2", "c3"]
    assert model.split_hops("A1B2c3d4", 1, 2) == ["a1b2", "c3d4"]
    assert model.split_hops("a1b2c3d4e5f6", 2, 2) == ["a1b2c3", "d4e5f6"]
    assert model.split_hops("a1b2c3", 0, 2) == ["a1", "b2"]


def test_split_hops_rejects_bad_input():
    assert model.split_hops("a1", 0, 2) is None
    assert model.split_hops("a1b", 1, 1) is None
    assert model.split_hops("zz", 0, 1) is None
    assert model.split_hops("a1", -1, 1) is None
    assert model.split_hops("a1", 3, 1) is None
    assert model.split_hops(None, 0, 1) is None


def test_normalise_contact():
    node = model.normalise_contact(contact(A.upper(), adv_name=" Hill "), NOW)
    assert node == {
        "public_key": A,
        "pubkey_prefix": A[:12],
        "name": "Hill",
        "type": "repeater",
        "lat": 52.1,
        "lon": 4.3,
        "added_to_node": True,
        "last_advert": "2026-11-18T11:05:40+00:00",
        "last_heard": None,
        "last_snr": None,
        "last_hop_count": None,
        "route": {"state": "none", "hops": []},
    }


def test_normalise_contact_without_position_or_extras():
    node = model.normalise_contact({"public_key": A}, NOW)
    assert node["lat"] is None and node["lon"] is None
    assert node["name"] == ""
    assert node["type"] == "unknown"
    assert node["added_to_node"] is False
    assert node["last_advert"] is None
    unset = model.normalise_contact(contact(A, adv_lat=0.0, adv_lon=0.0), NOW)
    assert unset["lat"] is None and unset["lon"] is None


def test_normalise_contact_rejects_bad_records():
    assert model.normalise_contact(None) is None
    assert model.normalise_contact({}) is None
    assert model.normalise_contact({"public_key": "xyz"}) is None
    assert model.normalise_contact({"public_key": "a1"}) is None
    assert model.normalise_contact({"public_key": 12}) is None


def test_route_none_and_direct():
    nodes = by_key(
        model.build_nodes(
            [contact(A), contact(B, out_path_len=0, out_path_hash_mode=0)], now=NOW
        )
    )
    assert nodes[A]["route"] == {"state": "none", "hops": []}
    assert nodes[B]["route"] == {"state": "direct", "hops": []}


def test_route_missing_length_is_none():
    record = contact(A)
    del record["out_path_len"]
    assert model.build_nodes([record], now=NOW)[0]["route"]["state"] == "none"


def test_route_resolved_keeps_hop_order():
    target = contact(C, out_path_len=2, out_path="b2a1", out_path_hash_mode=0, type=1)
    nodes = by_key(
        model.build_nodes(
            [contact(A), contact(B, adv_lat=0, adv_lon=0), target], now=NOW
        )
    )
    route = nodes[C]["route"]
    assert route["state"] == "resolved"
    assert route["hops"] == [
        {"hash": "b2", "public_key": B, "name": "node b2", "lat": None, "lon": None},
        {"hash": "a1", "public_key": A, "name": "node a1", "lat": 52.1, "lon": 4.3},
    ]


def test_route_unresolved_when_hop_unknown():
    target = contact(C, out_path_len=2, out_path="a1ee", out_path_hash_mode=0)
    route = by_key(model.build_nodes([contact(A), target], now=NOW))[C]["route"]
    assert route["state"] == "unresolved"
    assert route["hops"][0]["public_key"] == A
    assert route["hops"][1] == {
        "hash": "ee",
        "public_key": None,
        "name": None,
        "lat": None,
        "lon": None,
    }


def test_route_unresolved_when_hop_ambiguous():
    target = contact(C, out_path_len=1, out_path="a1", out_path_hash_mode=0)
    route = by_key(model.build_nodes([contact(A), contact(D), target], now=NOW))[C][
        "route"
    ]
    assert route["state"] == "unresolved"
    assert route["hops"] == [
        {"hash": "a1", "public_key": None, "name": None, "lat": None, "lon": None}
    ]


def test_route_wider_hash_resolves_ambiguity():
    target = contact(C, out_path_len=1, out_path="a1ff", out_path_hash_mode=1)
    route = by_key(model.build_nodes([contact(A), contact(D), target], now=NOW))[C][
        "route"
    ]
    assert route["state"] == "resolved"
    assert route["hops"][0]["public_key"] == D


def test_route_three_byte_hashes():
    target = contact(A, out_path_len=1, out_path="c4d5e6", out_path_hash_mode=2)
    route = by_key(model.build_nodes([contact(C), target], now=NOW))[A]["route"]
    assert route["state"] == "resolved"
    assert route["hops"][0]["hash"] == "c4d5e6"


def test_route_does_not_match_the_contact_itself():
    target = contact(A, out_path_len=1, out_path="a1", out_path_hash_mode=0)
    route = model.build_nodes([target], now=NOW)[0]["route"]
    assert route["state"] == "unresolved"
    assert route["hops"][0]["public_key"] is None


def test_route_malformed_path_is_unresolved():
    for extra in (
        {"out_path": "a1", "out_path_len": 2, "out_path_hash_mode": 0},
        {"out_path": "a1", "out_path_len": 1, "out_path_hash_mode": 7},
        {"out_path": None, "out_path_len": 1, "out_path_hash_mode": 0},
        {"out_path": "a1" * 80, "out_path_len": 80, "out_path_hash_mode": 0},
    ):
        route = model.build_nodes([contact(A), contact(C, **extra)], now=NOW)[1][
            "route"
        ]
        assert route == {"state": "unresolved", "hops": []}


def test_build_nodes_adds_heard_data_and_sorts():
    heard = {
        B[:12]: {
            "last_heard": "2026-11-18T06:00:00+00:00",
            "last_snr": 7.5,
            "last_hop_count": 2,
        }
    }
    nodes = model.build_nodes([contact(B), contact(A)], heard, NOW)
    assert [node["public_key"] for node in nodes] == [A, B]
    assert nodes[0]["last_heard"] is None
    assert nodes[1]["last_heard"] == "2026-11-18T06:00:00+00:00"
    assert nodes[1]["last_snr"] == 7.5
    assert nodes[1]["last_hop_count"] == 2


def test_build_nodes_skips_bad_records_and_duplicates():
    nodes = model.build_nodes(
        [contact(A), "junk", {"adv_name": "x"}, contact(A)], now=NOW
    )
    assert len(nodes) == 1
