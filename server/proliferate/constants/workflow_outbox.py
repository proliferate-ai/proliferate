"""Closed vocabularies + effect policy for the generation-fenced workflow outbox.

The generic workflow outbox substrate is POINTER/IDENTITY-FIRST (WF-OUTBOX R10):
subject/effect identity lives in typed, structurally-bounded columns and handlers
load business data from the owning tables. There is no arbitrary-JSON payload and
no free-text error surface. Every vocabulary that a row can carry is closed here,
CHECK-constrained in the schema (see the ``workflow_outbox_reclaimable`` migration
and ``db.models.cloud.workflow_ledger``), and re-validated at the store boundary
(``db.store.workflow_ledger.outbox``). Adding a value means changing THIS module,
the CHECK, and the store together.

``kind`` is deliberately NOT CHECK-constrained in the schema (a historical/legacy
row may carry a kind this build does not know); it is validated at the enqueue
boundary and reconciled conservatively in the migration. Everything else
(``subject_kind``, ``status``, receipt ``result_kind``, ``failure_code``) is
CHECK-constrained because those columns are wholly owned by this substrate.
"""

from __future__ import annotations

from typing import Final

# --- operation kind (drives claim scoping R9 + effect policy R7/D9) ----------------
#
# The unit of work a relay claims. Effectful kinds have an external side effect
# that CANNOT be proven un-performed after a crash, so an in-flight legacy row of
# such a kind fails closed (needs-reconciliation) rather than being re-dispatched.
KIND_CLOUD_DELIVERY: Final = "cloud_delivery"
KIND_NOTIFICATION: Final = "notification"
KIND_POLL_NEXT_PAGE: Final = "poll_next_page"
KIND_SCHEDULE_OCCURRENCE: Final = "schedule_occurrence"

OUTBOX_KINDS: Final[frozenset[str]] = frozenset(
    {
        KIND_CLOUD_DELIVERY,
        KIND_NOTIFICATION,
        KIND_POLL_NEXT_PAGE,
        KIND_SCHEDULE_OCCURRENCE,
    }
)

# Kinds whose external effect cannot be proven unperformed on crash. A reclaimer of
# such a row must reconcile via the owner's effect ledger before re-dispatching, and
# an unknown/legacy kind is treated as effectful (conservative) in the migration.
EFFECTFUL_KINDS: Final[frozenset[str]] = frozenset(
    {KIND_CLOUD_DELIVERY, KIND_NOTIFICATION}
)


def is_effectful_kind(kind: str) -> bool:
    """Unknown kinds are effectful (fail-closed), per D9/R7."""

    return kind not in {KIND_POLL_NEXT_PAGE, KIND_SCHEDULE_OCCURRENCE}


# Default retry ceiling per kind (R7: bounds crash/reclaim loops). A row is
# work-claimed at most ``max_attempts`` times, then deterministically dead-letters.
_DEFAULT_MAX_ATTEMPTS: Final = 5
_MAX_ATTEMPTS_BY_KIND: Final[dict[str, int]] = {
    KIND_CLOUD_DELIVERY: 5,
    KIND_NOTIFICATION: 5,
    KIND_POLL_NEXT_PAGE: 8,
    KIND_SCHEDULE_OCCURRENCE: 5,
}


def default_max_attempts(kind: str) -> int:
    return _MAX_ATTEMPTS_BY_KIND.get(kind, _DEFAULT_MAX_ATTEMPTS)


# --- subject identity (R5: generic subject, run/trigger are optional scoping FKs) --
SUBJECT_WORKFLOW_RUN: Final = "workflow_run"
SUBJECT_WORKFLOW_TRIGGER: Final = "workflow_trigger"
SUBJECT_SCHEDULE: Final = "schedule"
SUBJECT_NOTIFICATION: Final = "notification"

OUTBOX_SUBJECT_KINDS: Final[frozenset[str]] = frozenset(
    {
        SUBJECT_WORKFLOW_RUN,
        SUBJECT_WORKFLOW_TRIGGER,
        SUBJECT_SCHEDULE,
        SUBJECT_NOTIFICATION,
    }
)

# --- row status (D2) ---------------------------------------------------------------
STATUS_PENDING: Final = "pending"
STATUS_CLAIMED: Final = "claimed"
STATUS_SUCCEEDED: Final = "succeeded"
STATUS_FAILED: Final = "failed"
STATUS_DEAD_LETTER: Final = "dead_letter"

OUTBOX_STATUSES: Final[frozenset[str]] = frozenset(
    {STATUS_PENDING, STATUS_CLAIMED, STATUS_SUCCEEDED, STATUS_FAILED, STATUS_DEAD_LETTER}
)
TERMINAL_STATUSES: Final[frozenset[str]] = frozenset(
    {STATUS_SUCCEEDED, STATUS_FAILED, STATUS_DEAD_LETTER}
)

# --- durable result receipt kinds (R8: one immutable receipt per generation) -------
RESULT_SUCCEEDED: Final = "succeeded"
RESULT_CONTINUED: Final = "continued"
RESULT_RESCHEDULED: Final = "rescheduled"
RESULT_FAILED_TERMINAL: Final = "failed_terminal"
RESULT_DEAD_LETTER: Final = "dead_letter"

OUTBOX_RESULT_KINDS: Final[frozenset[str]] = frozenset(
    {
        RESULT_SUCCEEDED,
        RESULT_CONTINUED,
        RESULT_RESCHEDULED,
        RESULT_FAILED_TERMINAL,
        RESULT_DEAD_LETTER,
    }
)

# --- closed failure-code vocabulary (R4/R10: no free text, no exception repr) ------
FAILURE_TRANSIENT: Final = "transient"
FAILURE_UPSTREAM_ERROR: Final = "upstream_error"
FAILURE_INVALID: Final = "invalid"
FAILURE_TIMEOUT: Final = "timeout"
FAILURE_INTERNAL: Final = "internal"
FAILURE_MAX_ATTEMPTS_EXHAUSTED: Final = "max_attempts_exhausted"
FAILURE_NEEDS_RECONCILIATION: Final = "needs_reconciliation"

OUTBOX_FAILURE_CODES: Final[frozenset[str]] = frozenset(
    {
        FAILURE_TRANSIENT,
        FAILURE_UPSTREAM_ERROR,
        FAILURE_INVALID,
        FAILURE_TIMEOUT,
        FAILURE_INTERNAL,
        FAILURE_MAX_ATTEMPTS_EXHAUSTED,
        FAILURE_NEEDS_RECONCILIATION,
    }
)

# Structural bounds for the opaque, secret-free identity handles (R10). These are
# pointers into owning tables, never free text.
MAX_SUBJECT_ID_LEN: Final = 255
MAX_EFFECT_KEY_LEN: Final = 255
MAX_DEDUPE_KEY_LEN: Final = 255
MAX_CLAIMED_BY_LEN: Final = 128


def _sql_in_list(values: frozenset[str]) -> str:
    """Deterministic ``'a', 'b'`` fragment for a CHECK constraint body."""

    return ", ".join(f"'{value}'" for value in sorted(values))


# Prebuilt CHECK-constraint bodies so the ORM model and the migration share one
# source of truth for the closed vocabularies.
STATUS_CHECK_SQL: Final = f"status IN ({_sql_in_list(OUTBOX_STATUSES)})"
SUBJECT_KIND_CHECK_SQL: Final = f"subject_kind IN ({_sql_in_list(OUTBOX_SUBJECT_KINDS)})"
FAILURE_CODE_CHECK_SQL: Final = (
    f"last_failure_code IS NULL OR last_failure_code IN ({_sql_in_list(OUTBOX_FAILURE_CODES)})"
)
RESULT_KIND_CHECK_SQL: Final = f"result_kind IN ({_sql_in_list(OUTBOX_RESULT_KINDS)})"
RECEIPT_FAILURE_CODE_CHECK_SQL: Final = (
    f"failure_code IS NULL OR failure_code IN ({_sql_in_list(OUTBOX_FAILURE_CODES)})"
)
