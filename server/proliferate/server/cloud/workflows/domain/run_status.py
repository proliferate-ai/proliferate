"""Pure workflow-run status transition guard (spec 3.2).

The control plane keeps desired state (cancel) and the runtime reports observed
state; both funnel through :func:`check_transition` so an out-of-order or illegal
report is rejected before it reaches the store.
"""

from __future__ import annotations

from proliferate.constants.workflows import (
    WORKFLOW_RUN_STATUS_TRANSITIONS,
    WORKFLOW_RUN_TERMINAL_STATUSES,
)


class RunTransitionError(Exception):
    """Raised when a requested run status transition is not legal."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def is_terminal(status: str) -> bool:
    return status in WORKFLOW_RUN_TERMINAL_STATUSES


def transition_allowed(current: str, target: str) -> bool:
    """A same-status report is an idempotent no-op; otherwise consult the table."""

    if current == target:
        return True
    return target in WORKFLOW_RUN_STATUS_TRANSITIONS.get(current, frozenset())


def check_transition(current: str, target: str) -> None:
    """Raise :class:`RunTransitionError` if ``current -> target`` is not legal."""

    if current == target:
        return
    if is_terminal(current):
        raise RunTransitionError(
            "run_already_terminal",
            f"Run is already in terminal status '{current}'.",
        )
    if not transition_allowed(current, target):
        raise RunTransitionError(
            "illegal_run_transition",
            f"Cannot transition run from '{current}' to '{target}'.",
        )
