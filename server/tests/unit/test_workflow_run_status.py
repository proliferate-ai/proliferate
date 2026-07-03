"""Workflow-run status transition guard (spec 3.2)."""

from __future__ import annotations

import pytest

from proliferate.server.cloud.workflows.domain.run_status import (
    RunTransitionError,
    check_transition,
    is_terminal,
    transition_allowed,
)


def test_happy_path_transitions_allowed() -> None:
    assert transition_allowed("pending_delivery", "delivered")
    assert transition_allowed("delivered", "running")
    assert transition_allowed("running", "waiting_approval")
    assert transition_allowed("waiting_approval", "running")
    assert transition_allowed("running", "completed")


def test_same_status_is_idempotent() -> None:
    assert transition_allowed("running", "running")
    check_transition("running", "running")  # does not raise


def test_terminal_statuses_have_no_exits() -> None:
    for terminal in ("completed", "failed", "cancelled"):
        assert is_terminal(terminal)
        with pytest.raises(RunTransitionError) as exc:
            check_transition(terminal, "running")
        assert exc.value.code == "run_already_terminal"


def test_illegal_skip_rejected() -> None:
    with pytest.raises(RunTransitionError) as exc:
        check_transition("pending_delivery", "running")
    assert exc.value.code == "illegal_run_transition"


def test_cancel_allowed_from_every_non_terminal() -> None:
    for status in ("pending_delivery", "delivered", "running", "waiting_approval"):
        assert transition_allowed(status, "cancelled")
