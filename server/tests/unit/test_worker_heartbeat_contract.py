"""The Python producer half of the shared Worker heartbeat wire contract (REL-10).

``fixtures/contracts/worker-heartbeat/v1.json`` is one committed golden body that
BOTH languages consume: this suite proves the real Pydantic model serializes to
it exactly, and ``proliferate-worker``'s ``cloud_client`` tests prove the Rust
type parses that same file. A handwritten copy of the payload inside either
language's tests would not bind the two halves together, so neither side may
inline one.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from proliferate.server.cloud.runtime_workers.models import (
    WorkerDesiredVersions,
    WorkerHeartbeatResponse,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_DIR = REPO_ROOT / "fixtures" / "contracts" / "worker-heartbeat"
V1_FIXTURE = CONTRACT_DIR / "v1.json"
V0_LEGACY_FIXTURE = CONTRACT_DIR / "v0-legacy.json"

#: The fixed values the golden body encodes. Kept beside the fixture rather than
#: derived from it, so an accidental fixture edit fails this test instead of
#: silently redefining the contract.
WORKER_ID = "2f5b3c14-8d1e-4a7b-9c60-1f2e3d4a5b6c"
SERVER_TIME = datetime(2026, 8, 18, 0, 0, 0, tzinfo=UTC)
HEARTBEAT_INTERVAL_SECONDS = 30
WORKER_PIN = "0.4.13"
ANYHARNESS_PIN = "0.66.0"


def _v1_response() -> WorkerHeartbeatResponse:
    return WorkerHeartbeatResponse(
        worker_id=WORKER_ID,
        server_time=SERVER_TIME,
        heartbeat_interval_seconds=HEARTBEAT_INTERVAL_SECONDS,
        desired_versions=WorkerDesiredVersions(
            worker=WORKER_PIN,
            anyharness=ANYHARNESS_PIN,
        ),
        launch_options_upload_allowed=True,
    )


class TestSharedGoldenFixture:
    def test_real_model_serializes_to_the_complete_v1_fixture(self) -> None:
        serialized = _v1_response().model_dump(by_alias=True, mode="json")
        assert serialized == json.loads(V1_FIXTURE.read_text())

    def test_the_v1_fixture_carries_the_camel_case_capability_member(self) -> None:
        body = json.loads(V1_FIXTURE.read_text())
        assert body["launchOptionsUploadAllowed"] is True
        assert "launch_options_upload_allowed" not in body

    def test_the_legacy_fixture_is_the_v1_body_minus_the_capability(self) -> None:
        """The supported pre-field shape Rust must decode as ``false`` — identical
        to v1 in every other member, so the Rust default-false proof isolates
        exactly the omission."""
        v1 = json.loads(V1_FIXTURE.read_text())
        legacy = json.loads(V0_LEGACY_FIXTURE.read_text())
        assert "launchOptionsUploadAllowed" not in legacy
        assert legacy == {
            key: value for key, value in v1.items() if key != "launchOptionsUploadAllowed"
        }


class TestCapabilityField:
    def test_the_capability_is_required_and_typed_boolean(self) -> None:
        field = WorkerHeartbeatResponse.model_fields["launch_options_upload_allowed"]
        assert field.is_required(), "every new-server 200 must state the verdict explicitly"
        assert field.annotation is bool
        assert field.alias == "launchOptionsUploadAllowed"

    def test_a_false_verdict_serializes_as_json_false_not_an_omission(self) -> None:
        """Absent and false mean the same thing to a Worker, but a NEW server must
        still say ``false`` out loud, so a mixed-version investigation can tell an
        old server apart from an ineligible target."""
        response = _v1_response().model_copy(update={"launch_options_upload_allowed": False})
        serialized = response.model_dump(by_alias=True, mode="json")
        assert serialized["launchOptionsUploadAllowed"] is False

    def test_the_capability_does_not_disturb_the_convergence_members(self) -> None:
        """The verdict is transport only: binary versions remain the sole desired
        convergence state on this response."""
        serialized = _v1_response().model_dump(by_alias=True, mode="json")
        assert serialized["desiredVersions"] == {
            "worker": WORKER_PIN,
            "anyharness": ANYHARNESS_PIN,
        }
