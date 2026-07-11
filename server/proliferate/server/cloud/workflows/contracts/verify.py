"""Python leg of the cross-language workflow contract check (T1-WF-CONTRACT-01).

`run_all_checks()` parses/serializes every golden fixture, recomputes every
canonical hash, validates the schema profile and its invalid cases, proves the
deterministic legacy UUIDv5 upgrade, and asserts the credential canary is absent
from every non-envelope surface. It raises ``ContractCheckError`` on the first
drift.

Runnable directly (used by scripts/check_workflow_contract_fixtures.py):

    cd server && uv run python -m proliferate.server.cloud.workflows.contracts.verify
"""

from __future__ import annotations

import sys

from . import fixtures
from .canonical import canonicalize, content_hash
from .legacy_upgrade import derive_legacy_id
from .models import (
    CheckpointManifest,
    ExecutionBinding,
    ExecutionEnvelope,
    GatewayCallReceipt,
    MaterializationOffer,
    ObservedRun,
    ResolvedPlan,
    WfContractModel,
    WorkflowControlCommand,
    binding_hash,
    checkpoint_content_hash,
    normalize_checkpoint_manifest,
    plan_hash,
)
from .schema_profile import SchemaProfileError, validate_schema_profile

CANARY_MARKER = "PROLIFERATE_WF_CREDENTIAL_CANARY_c0ffee9a1b2c3d4e"


class ContractCheckError(AssertionError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractCheckError(message)


def _roundtrip(model_cls: type[WfContractModel], raw: dict) -> None:
    """Strict parse + serialize; canonical bytes must be preserved exactly."""

    parsed = model_cls.model_validate(raw)
    reserialized = parsed.to_wire()
    _require(
        canonicalize(reserialized) == canonicalize(raw),
        f"{model_cls.__name__} did not round-trip its fixture byte-faithfully",
    )


def _check_plan() -> None:
    raw = fixtures.load("resolved-plan-v2.json")
    _roundtrip(ResolvedPlan, raw)
    _require(
        plan_hash(raw) == raw["planHash"],
        "resolved-plan planHash does not match the canonical content hash",
    )
    # A different top-level plan version must fail strictly.
    bad = dict(raw)
    bad["planVersion"] = 99
    try:
        ResolvedPlan.model_validate(bad)
    except Exception:
        pass
    else:
        raise ContractCheckError("unknown planVersion must fail strict parsing")
    # An unknown step kind must fail strictly.
    bad_step = fixtures.load("resolved-plan-v2.json")
    bad_step["spine"][0]["steps"][0]["kind"] = "agent.telepathy"
    try:
        ResolvedPlan.model_validate(bad_step)
    except Exception:
        pass
    else:
        raise ContractCheckError("unknown step kind must fail strict parsing")


def _check_checkpoint_and_binding() -> None:
    manifest = fixtures.load("checkpoint-manifest-v1.json")
    _roundtrip(CheckpointManifest, manifest)
    ckpt_hash = checkpoint_content_hash(manifest)

    binding = fixtures.load("execution-binding-v1.json")
    _roundtrip(ExecutionBinding, binding)
    _require(
        binding["checkpointContentHash"] == ckpt_hash,
        "binding checkpointContentHash does not match the manifest content hash",
    )
    _require(
        binding_hash(binding) == binding["bindingHash"],
        "binding bindingHash does not match the canonical content hash",
    )

    # Restoration/normalization equivalence.
    restoration = fixtures.load("restoration/checkpoint-restoration-v1.json")
    normalized = normalize_checkpoint_manifest(restoration["unsortedManifest"])
    _require(
        content_hash(normalized) == ckpt_hash,
        "restoration manifest does not normalize to the canonical checkpoint hash",
    )
    _require(
        restoration["expectedContentHash"] == ckpt_hash,
        "restoration expectedContentHash is stale",
    )
    # The normalized manifest must equal the canonical manifest exactly.
    _require(
        canonicalize(normalized) == canonicalize(manifest),
        "restoration normalization did not reproduce the canonical manifest",
    )

    # Invalid manifests must all fail strict parsing.
    invalid = fixtures.load("invalid/checkpoint-manifest-invalid-cases.json")
    for case in invalid["cases"]:
        try:
            CheckpointManifest.model_validate(case["document"])
        except Exception:
            continue
        raise ContractCheckError(f"invalid checkpoint manifest '{case['name']}' was accepted")


def _check_offer_and_envelope() -> None:
    plan = fixtures.load("resolved-plan-v2.json")
    binding = fixtures.load("execution-binding-v1.json")

    offer = fixtures.load("materialization-offer-v1.json")
    _roundtrip(MaterializationOffer, offer)
    _require(offer["planHash"] == plan["planHash"], "offer planHash mismatch")

    envelope = fixtures.load("execution-envelope-v1.json")
    _roundtrip(ExecutionEnvelope, envelope)
    _require(envelope["planHash"] == plan["planHash"], "envelope planHash mismatch")
    _require(
        envelope["bindingHash"] == binding["bindingHash"],
        "envelope bindingHash mismatch",
    )
    _require(
        envelope["binding"]["bindingHash"] == binding["bindingHash"],
        "envelope embedded binding hash mismatch",
    )


def _check_observed_receipt_command() -> None:
    plan = fixtures.load("resolved-plan-v2.json")
    binding = fixtures.load("execution-binding-v1.json")

    observed = fixtures.load("observed-run-v2.json")
    _roundtrip(ObservedRun, observed)
    _require(observed["planHash"] == plan["planHash"], "observed planHash mismatch")
    _require(observed["bindingHash"] == binding["bindingHash"], "observed bindingHash mismatch")
    # Sessions are a slot map at every boundary.
    slot_ids = {slot["slotId"] for slot in plan["slots"]}
    _require(
        set(observed["sessions"].keys()) <= slot_ids,
        "observed sessions must be keyed by plan slot ids",
    )

    receipt = fixtures.load("gateway-call-receipt-v1.json")
    _roundtrip(GatewayCallReceipt, receipt)
    _require(receipt["planHash"] == plan["planHash"], "receipt planHash mismatch")

    command = fixtures.load("workflow-control-command-v1.json")
    _roundtrip(WorkflowControlCommand, command)
    _require(command["planHash"] == plan["planHash"], "command planHash mismatch")
    _require(command["bindingHash"] == binding["bindingHash"], "command bindingHash mismatch")


def _check_schema_profile() -> None:
    valid = fixtures.load("workflow-schema-profile-v1-valid.json")
    validate_schema_profile(valid)  # must not raise

    # The plan's inline emit schema must also validate.
    plan = fixtures.load("resolved-plan-v2.json")
    for entry in plan["spine"]:
        for step in entry.get("steps", []):
            if step.get("kind") == "agent.emit":
                validate_schema_profile(step["schema"])

    invalid = fixtures.load("invalid/schema-profile-invalid-cases.json")
    for case in invalid["cases"]:
        try:
            validate_schema_profile(case["document"])
        except SchemaProfileError as exc:
            _require(
                exc.code == case["reasonCode"],
                f"schema case '{case['name']}' failed with {exc.code}, "
                f"expected {case['reasonCode']}",
            )
        else:
            raise ContractCheckError(f"invalid emit schema '{case['name']}' was accepted")


def _check_legacy_upgrade() -> None:
    fixture = fixtures.load("legacy-definition-upgrade-v1.json")
    version = fixture["newWorkflowVersionId"]
    _require(
        fixture["namespace"] == "2b5e907a-2cd8-5b8f-b5ab-5c891bb93263",
        "legacy namespace drift",
    )
    for row in fixture["expectedIds"]:
        derived = derive_legacy_id(version, row["kind"], row["identity"])
        _require(
            derived == row["uuid"],
            f"legacy UUIDv5 for {row['kind']} {row['identity']} = {derived}, "
            f"expected {row['uuid']}",
        )


def _check_canonical_number_vectors() -> None:
    """RFC 8785 §3.2.2.3 float serialization (WS1-follow-up float fix).

    Cross-language shared vectors: every {value, canonical} pair must
    canonicalize to exactly the fixture's expected byte string. The TypeScript
    leg (`contracts.test.ts`) runs the identical fixture; drift between the two
    fails this check group (or the TS one), which is what makes it a
    cross-language guard rather than just a Python unit test.
    """

    data = fixtures.load("canonical-number-vectors-v1.json")
    for vector in data["vectors"]:
        got = canonicalize(vector["value"]).decode("utf-8")
        _require(
            got == vector["canonical"],
            f"canonical-number-vectors: value={vector['value']!r} canonicalized to "
            f"{got!r}, expected {vector['canonical']!r} ({vector.get('note', '')})",
        )


def _check_credential_canary() -> None:
    canary = fixtures.load("credential-canary.json")
    _require(canary["marker"] == CANARY_MARKER, "canary marker drift")
    for name in canary["fixturesThatMustNotContainMarker"]:
        text = fixtures.load_text(name)
        _require(
            CANARY_MARKER not in text,
            f"credential canary marker leaked into {name}",
        )
    # Public (non-envelope) surfaces must carry no dummy credential either.
    for name in ("resolved-plan-v2.json", "observed-run-v2.json", "gateway-call-receipt-v1.json"):
        text = fixtures.load_text(name)
        _require(
            "DUMMY_FAKE" not in text,
            f"a dummy credential leaked into public surface {name}",
        )


CHECKS = (
    _check_plan,
    _check_checkpoint_and_binding,
    _check_offer_and_envelope,
    _check_observed_receipt_command,
    _check_schema_profile,
    _check_legacy_upgrade,
    _check_canonical_number_vectors,
    _check_credential_canary,
)


def run_all_checks() -> None:
    for check in CHECKS:
        check()


def main() -> int:
    try:
        run_all_checks()
    except Exception as exc:  # noqa: BLE001 - report loudly for the checker
        print(f"[python] workflow contract check FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"[python] workflow contract fixtures OK ({len(CHECKS)} check groups)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
