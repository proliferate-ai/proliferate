from __future__ import annotations

from proliferate.errors import Conflict, InvalidRequest, NotFoundError


class WorkflowDefinitionNotFound(NotFoundError):
    code = "workflow_definition_not_found"

    def __init__(self) -> None:
        super().__init__("Workflow definition not found.")


class InvalidWorkflowDefinition(InvalidRequest):
    code = "invalid_workflow_definition"

    def __init__(self, message: str, *, path: str | None = None) -> None:
        super().__init__(message)
        if path is not None:
            self.extra_detail = {"path": path}


class UnavailableWorkflowCatalogSelection(InvalidWorkflowDefinition):
    code = "workflow_catalog_selection_unavailable"


class WorkflowDefinitionRevisionConflict(Conflict):
    code = "workflow_definition_revision_conflict"

    def __init__(
        self,
        *,
        expected_revision: int,
        current_revision: int | None,
    ) -> None:
        super().__init__("Workflow definition changed since it was loaded.")
        self.extra_detail = {
            "expectedRevision": expected_revision,
            "currentRevision": current_revision,
        }


class WorkflowInvocationNotFound(NotFoundError):
    code = "workflow_invocation_not_found"

    def __init__(self) -> None:
        super().__init__("Workflow invocation not found.")


class InvalidWorkflowInvocation(InvalidRequest):
    """Typed 400 carrying the exact domain issue code on the wire."""

    code = "invalid_workflow_invocation"

    def __init__(self, message: str, *, code: str, path: str | None = None) -> None:
        super().__init__(message, code=code)
        if path is not None:
            self.extra_detail = {"path": path}


class WorkflowInvocationIdempotencyConflict(Conflict):
    code = "workflow_invocation_idempotency_conflict"

    def __init__(self) -> None:
        super().__init__("Idempotency key was already used for a different invocation request.")


class WorkflowAbandonNotAvailable(Conflict):
    code = "workflow_abandon_not_available"

    def __init__(self, message: str) -> None:
        super().__init__(message)
