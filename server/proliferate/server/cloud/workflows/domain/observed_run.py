"""Observed-run snapshot projection + delivery-identity matching (spec §5.4).

The runtime (WS5c) reports a whole ``ObservedRun`` snapshot bound to the
immutable delivery identity ``(run_id, plan_hash, binding_hash,
execution_generation)`` plus a strictly increasing ``revision``. This module is
the pure translation layer between that contract snapshot and the legacy
observed fields the run row keeps for the UI (``status`` / ``step_cursor`` /
``step_outputs_json`` / ``anyharness_session_ids`` / cost / error). The stateful
CAS + row writes live in ``worker/service.report_observed_run``; the snapshot is
also stored verbatim in ``observed_snapshot_json`` for replay/audit.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from proliferate.constants.workflows import (
    WORKFLOW_LEGACY_GENERATION_SENTINEL,
    WORKFLOW_LEGACY_HASH_SENTINEL,
    WORKFLOW_OBSERVED_STATE_TO_LEGACY_STATUS,
    WORKFLOW_OBSERVED_TERMINAL_STATES,
)


@dataclass(frozen=True)
class ObservedIdentity:
    """The delivery identity + revision an observation is bound to (§5.4/§5.2)."""

    plan_hash: str
    binding_hash: str
    execution_generation: int
    revision: int


@dataclass(frozen=True)
class ProjectedObservation:
    """The legacy run fields derived from an accepted ``ObservedRun`` snapshot."""

    observed_state: str
    legacy_status: str
    quiescence_state: str | None
    step_cursor: int | None
    step_outputs_json: dict[str, object] | None
    session_ids: list[str] | None
    error_code: str | None
    error_message: str | None
    cost_usd: Decimal | None
    cost_tokens: int | None


class ObservedRunError(Exception):
    """A malformed observation snapshot (missing/ill-typed identity fields)."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def is_observed_terminal(observed_state: str | None) -> bool:
    return observed_state in WORKFLOW_OBSERVED_TERMINAL_STATES


def legacy_status_for(observed_state: str) -> str:
    status = WORKFLOW_OBSERVED_STATE_TO_LEGACY_STATUS.get(observed_state)
    if status is None:
        raise ObservedRunError(
            "unknown_observed_state",
            f"observedState '{observed_state}' has no legacy status mapping.",
        )
    return status


def parse_identity(snapshot: dict[str, object]) -> ObservedIdentity:
    """Pull the delivery identity + revision out of an ObservedRun snapshot."""

    plan_hash = snapshot.get("planHash")
    binding_hash = snapshot.get("bindingHash")
    execution_generation = snapshot.get("executionGeneration")
    revision = snapshot.get("revision")
    if not isinstance(plan_hash, str) or not isinstance(binding_hash, str):
        raise ObservedRunError(
            "invalid_observation_identity", "planHash and bindingHash must be strings."
        )
    if not isinstance(execution_generation, int) or isinstance(execution_generation, bool):
        raise ObservedRunError(
            "invalid_observation_identity", "executionGeneration must be an integer."
        )
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise ObservedRunError(
            "invalid_observation_revision", "revision must be an integer >= 1."
        )
    return ObservedIdentity(
        plan_hash=plan_hash,
        binding_hash=binding_hash,
        execution_generation=execution_generation,
        revision=revision,
    )


def _field_matches(stored: object | None, given: object, sentinel: object) -> bool:
    """A NULL stored identity column accepts the WS5a sentinel; a set column must
    match exactly (§5.4 — legacy runs without a hash use ``''``/``0``)."""

    if stored is None:
        return given == sentinel
    return given == stored


def identity_matches(
    *,
    stored_plan_hash: str | None,
    stored_binding_hash: str | None,
    stored_execution_generation: int | None,
    identity: ObservedIdentity,
) -> bool:
    return (
        _field_matches(stored_plan_hash, identity.plan_hash, WORKFLOW_LEGACY_HASH_SENTINEL)
        and _field_matches(
            stored_binding_hash, identity.binding_hash, WORKFLOW_LEGACY_HASH_SENTINEL
        )
        and _field_matches(
            stored_execution_generation,
            identity.execution_generation,
            WORKFLOW_LEGACY_GENERATION_SENTINEL,
        )
    )


def _decimal_or_none(value: object) -> Decimal | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return Decimal(value)
    except (InvalidOperation, ValueError):
        return None


def project_observation(snapshot: dict[str, object]) -> ProjectedObservation:
    """Derive the legacy run fields from an ObservedRun snapshot.

    Session ids come from the slot-keyed ``sessions`` map (deduped + sorted for a
    stable list). Step outputs are keyed by the stable ``stepKey``. ``stepCursor``
    is a monotonic count of steps that have left the running/pending phase. A
    run-level error is the first failed step's typed error, if any.
    """

    observed_state = snapshot.get("observedState")
    if not isinstance(observed_state, str):
        raise ObservedRunError(
            "invalid_observed_state", "observedState must be a string."
        )
    legacy_status = legacy_status_for(observed_state)
    quiescence = snapshot.get("quiescenceState")

    raw_sessions = snapshot.get("sessions")
    session_ids: list[str] | None = None
    if isinstance(raw_sessions, dict):
        ids = sorted({v for v in raw_sessions.values() if isinstance(v, str) and v})
        session_ids = ids or None

    step_outputs: dict[str, object] = {}
    error_code: str | None = None
    error_message: str | None = None
    completed = 0
    raw_steps = snapshot.get("steps")
    if isinstance(raw_steps, list):
        for step in raw_steps:
            if not isinstance(step, dict):
                continue
            key = step.get("stepKey")
            output = step.get("output")
            if isinstance(key, str) and output is not None:
                step_outputs[key] = output
            status = step.get("status")
            if status in ("completed", "failed", "skipped", "outcome_uncertain"):
                completed += 1
            if status == "failed" and error_code is None:
                ec = step.get("errorCode")
                em = step.get("errorMessage")
                error_code = ec if isinstance(ec, str) else None
                error_message = em if isinstance(em, str) else None

    cost = snapshot.get("cost")
    cost_usd: Decimal | None = None
    cost_tokens: int | None = None
    if isinstance(cost, dict):
        cost_usd = _decimal_or_none(cost.get("usd"))
        tokens = cost.get("tokens")
        cost_tokens = tokens if isinstance(tokens, int) and not isinstance(tokens, bool) else None

    return ProjectedObservation(
        observed_state=observed_state,
        legacy_status=legacy_status,
        quiescence_state=quiescence if isinstance(quiescence, str) else None,
        step_cursor=completed or None,
        step_outputs_json=step_outputs or None,
        session_ids=session_ids,
        error_code=error_code,
        error_message=error_message,
        cost_usd=cost_usd,
        cost_tokens=cost_tokens,
    )
