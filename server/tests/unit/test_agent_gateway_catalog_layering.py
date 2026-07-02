"""Unit tests for the pure catalog layering helpers (parse + override apply)."""

from __future__ import annotations

import json

import pytest

from proliferate.server.cloud.agent_gateway.catalog import (
    apply_override,
    parse_models_json,
    parse_patch_json,
)


class TestParseModelsJson:
    def test_normalizes_string_entries(self) -> None:
        models = parse_models_json(json.dumps(["a", {"id": "b", "displayName": "B"}]))
        assert models == [{"id": "a"}, {"id": "b", "displayName": "B"}]

    @pytest.mark.parametrize(
        "payload",
        ["not-json", json.dumps({"id": "a"}), json.dumps([42]), json.dumps([{"name": "x"}])],
    )
    def test_rejects_invalid_payloads(self, payload: str) -> None:
        with pytest.raises(ValueError):
            parse_models_json(payload)


class TestParsePatchJson:
    def test_accepts_all_sections(self) -> None:
        patch = parse_patch_json(
            json.dumps({"remove": ["a"], "update": {"b": {"x": 1}}, "add": ["c"]})
        )
        assert patch["remove"] == ["a"]

    @pytest.mark.parametrize(
        "payload",
        [
            "nope",
            json.dumps(["list"]),
            json.dumps({"unknown": []}),
            json.dumps({"remove": [1]}),
            json.dumps({"update": {"a": "not-a-dict"}}),
            json.dumps({"add": [{"name": "no-id"}]}),
        ],
    )
    def test_rejects_invalid_patches(self, payload: str) -> None:
        with pytest.raises(ValueError):
            parse_patch_json(payload)


class TestApplyOverride:
    def test_remove_update_add_order(self) -> None:
        base = [{"id": "keep"}, {"id": "drop"}]
        patch = parse_patch_json(
            json.dumps(
                {
                    "remove": ["drop"],
                    "update": {"keep": {"displayName": "Kept", "id": "hijack"}},
                    "add": [{"id": "extra"}],
                }
            )
        )
        layered = apply_override(base, patch)
        # update cannot rewrite the id; add appends after base entries.
        assert layered == [{"id": "keep", "displayName": "Kept"}, {"id": "extra"}]

    def test_add_replaces_same_id_entry_in_place(self) -> None:
        base = [{"id": "a", "displayName": "Old"}, {"id": "b"}]
        patch = parse_patch_json(json.dumps({"add": [{"id": "a", "displayName": "New"}]}))
        assert apply_override(base, patch) == [{"id": "a", "displayName": "New"}, {"id": "b"}]

    def test_empty_patch_is_identity(self) -> None:
        base = [{"id": "a"}]
        assert apply_override(base, parse_patch_json("{}")) == base
