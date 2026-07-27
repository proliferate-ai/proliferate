"""Unit tests for the pure model-layering helpers (parse + override apply).

Tier 1 (pure functions, no IO). The document parser accepts one composed
machine document (model-catalog.md §Wire schema): an object with models/modes
lists, everything else carried verbatim. ``schemaVersion`` is enforced at
ingest, not by the parser — stored rows must stay readable.
"""

from __future__ import annotations

import json

import pytest

from proliferate.server.cloud.agent_models.overrides import (
    apply_override,
    parse_patch_json,
    validate_harness_kind,
)
from proliferate.server.cloud.agent_models.snapshots import parse_snapshot_document
from proliferate.server.cloud.errors import CloudApiError


class TestParseSnapshotDocument:
    def test_normalizes_string_model_and_mode_entries(self) -> None:
        document = parse_snapshot_document(
            json.dumps(
                {
                    "schemaVersion": 2,
                    "probedAt": "2026-07-24T09:12:03Z",
                    "models": ["a", {"id": "b", "name": "B"}],
                    "modes": ["build"],
                }
            )
        )
        assert document["models"] == [{"id": "a"}, {"id": "b", "name": "B"}]
        assert document["modes"] == [{"id": "build"}]

    def test_preserves_unknown_document_fields_verbatim(self) -> None:
        """A newer runtime's extra diagnostics must survive the round trip.

        ``snapshot_json`` is stored verbatim so the cloud tier serves exactly
        what the machine observed; rejecting or stripping unknown fields would
        make an older server lose a newer runtime's observation.
        """
        document = parse_snapshot_document(
            json.dumps(
                {
                    "schemaVersion": 2,
                    "agent": "opencode",
                    "probedAt": "2026-07-24T09:12:03Z",
                    "attestation": {"name": "opencode", "version": "0.3.112"},
                    "installIdentity": {"role": "agent_process"},
                    "stateRevision": 1721820000000,
                    "warnings": ["slow"],
                    "somethingNewer": {"nested": True},
                    "models": [],
                }
            )
        )
        assert document["attestation"] == {"name": "opencode", "version": "0.3.112"}
        assert document["installIdentity"] == {"role": "agent_process"}
        assert document["somethingNewer"] == {"nested": True}
        assert document["warnings"] == ["slow"]

    def test_absent_models_and_modes_default_to_empty(self) -> None:
        document = parse_snapshot_document(json.dumps({"probedAt": "2026-07-24T09:12:03Z"}))
        assert document["models"] == []
        assert document["modes"] == []

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
            parse_snapshot_document(payload)


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
    """The scope id is String(64): an over-long value must 400, never 500."""

    @pytest.mark.parametrize("value", ["", "x" * 65, "has space", "semi;colon"])
    def test_rejects_bad_harness_kind(self, value: str) -> None:
        with pytest.raises(CloudApiError) as excinfo:
            validate_harness_kind(value)
        assert excinfo.value.code == "invalid_agent_harness_kind"
        assert excinfo.value.status_code == 400

    @pytest.mark.parametrize("value", ["claude", "codex", "opencode", "cursor-agent"])
    def test_accepts_harness_slugs(self, value: str) -> None:
        assert validate_harness_kind(value) == value
