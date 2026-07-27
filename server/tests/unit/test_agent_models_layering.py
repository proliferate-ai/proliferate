"""Unit tests for the pure model-layering helpers (parse + override apply).

Tier 1 (pure functions, no IO). The entry parser replaces the pre-B4
models-only ``parse_models_json``: the stored payload is now one
machine-document entry (model-catalog.md §Wire schema), so the shape check moved
from "array of models" to "object with models/modes lists".
"""

from __future__ import annotations

import json

import pytest

from proliferate.server.cloud.agent_models.overrides import (
    apply_override,
    parse_patch_json,
    validate_auth_context_id,
    validate_harness_kind,
)
from proliferate.server.cloud.agent_models.snapshots import parse_snapshot_entry
from proliferate.server.cloud.errors import CloudApiError


class TestParseSnapshotEntry:
    def test_normalizes_string_model_and_mode_entries(self) -> None:
        entry = parse_snapshot_entry(
            json.dumps(
                {
                    "probedAt": "2026-07-24T09:12:03Z",
                    "models": ["a", {"id": "b", "name": "B"}],
                    "modes": ["build"],
                }
            )
        )
        assert entry["models"] == [{"id": "a"}, {"id": "b", "name": "B"}]
        assert entry["modes"] == [{"id": "build"}]

    def test_preserves_unknown_entry_fields_verbatim(self) -> None:
        """A newer runtime's extra diagnostics must survive the round trip.

        ``snapshot_json`` is stored verbatim so the cloud tier serves exactly
        what the machine observed; rejecting or stripping unknown fields would
        make an older server lose a newer runtime's observation.
        """
        entry = parse_snapshot_entry(
            json.dumps(
                {
                    "probedAt": "2026-07-24T09:12:03Z",
                    "mechanism": "acp",
                    "attestation": {"name": "opencode", "version": "0.3.112"},
                    "authFingerprint": "sha256:9f2c",
                    "warnings": ["slow"],
                    "somethingNewer": {"nested": True},
                    "models": [],
                }
            )
        )
        assert entry["attestation"] == {"name": "opencode", "version": "0.3.112"}
        assert entry["somethingNewer"] == {"nested": True}
        assert entry["warnings"] == ["slow"]

    def test_absent_models_and_modes_default_to_empty(self) -> None:
        entry = parse_snapshot_entry(json.dumps({"probedAt": "2026-07-24T09:12:03Z"}))
        assert entry["models"] == []
        assert entry["modes"] == []

    @pytest.mark.parametrize(
        "payload",
        [
            "not-json",
            json.dumps(["an", "array"]),
            json.dumps({"models": {"id": "a"}}),
            json.dumps({"models": [42]}),
            json.dumps({"models": [{"name": "no-id"}]}),
            json.dumps({"modes": [{"name": "no-id"}]}),
        ],
    )
    def test_rejects_invalid_payloads(self, payload: str) -> None:
        with pytest.raises(ValueError):
            parse_snapshot_entry(payload)


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


class TestIdentifierBounds:
    """Both scope ids are String(64): an over-long value must 400, never 500."""

    @pytest.mark.parametrize("value", ["", "x" * 65, "has space", "semi;colon"])
    def test_rejects_bad_harness_kind(self, value: str) -> None:
        with pytest.raises(CloudApiError) as excinfo:
            validate_harness_kind(value)
        assert excinfo.value.code == "invalid_agent_harness_kind"
        assert excinfo.value.status_code == 400

    @pytest.mark.parametrize("value", ["", "x" * 65, "has space", "semi;colon"])
    def test_rejects_bad_auth_context_id(self, value: str) -> None:
        with pytest.raises(CloudApiError) as excinfo:
            validate_auth_context_id(value)
        assert excinfo.value.code == "invalid_agent_auth_context_id"
        assert excinfo.value.status_code == 400

    @pytest.mark.parametrize(
        "value",
        ["anthropic-api", "anthropic-oauth", "bedrock", "gateway", "baseline", "cursor-login"],
    )
    def test_accepts_catalog_declared_context_ids(self, value: str) -> None:
        """The vocabulary is the catalog's, not a new one (model-catalog.md)."""
        assert validate_auth_context_id(value) == value
