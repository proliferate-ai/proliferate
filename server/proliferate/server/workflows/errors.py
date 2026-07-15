from __future__ import annotations

from proliferate.errors import Conflict, InvalidRequest, NotFoundError, ProliferateError


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


class InvalidWorkflowInvocation(InvalidRequest):
    code = "invalid_workflow_invocation"


class WorkflowInvocationNotFound(NotFoundError):
    code = "workflow_invocation_not_found"

    def __init__(self) -> None:
        super().__init__("Workflow invocation not found.")


class WorkflowInvocationConflict(Conflict):
    code = "workflow_invocation_conflict"

    def __init__(self) -> None:
        super().__init__("A workflow invocation with this ID already exists with different input.")


class WorkflowInvocationIneligible(ProliferateError):
    code = "workflow_invocation_ineligible"
    status_code = 422

    def __init__(self, blockers: list[dict[str, str]]) -> None:
        super().__init__("Workflow definition is not eligible for execution.")
        self.extra_detail = {"blockers": blockers}
