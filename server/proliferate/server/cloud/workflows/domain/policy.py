"""Pure workflow product-policy verdicts (spec 6: free-plan cap)."""

from __future__ import annotations

from proliferate.constants.workflows import FREE_PLAN_MAX_WORKFLOWS_PER_USER


def workflow_create_allowed(active_workflow_count: int, *, max_allowed: int | None) -> bool:
    """Whether a user with ``active_workflow_count`` non-archived workflows may create one.

    ``max_allowed=None`` means unlimited (a future paid plan). The free-plan cap is
    the v1 floor: one non-archived workflow per user.
    """

    if max_allowed is None:
        return True
    return active_workflow_count < max_allowed


def free_plan_workflow_limit() -> int:
    """The v1 cap.

    TODO(billing): return ``None`` (unlimited) once a user's paid plan is resolvable
    here; today every user is held to the free-plan cap. See spec 6 and
    ``project-stripe-billing`` memory for the plan-detection seam.
    """

    return FREE_PLAN_MAX_WORKFLOWS_PER_USER
