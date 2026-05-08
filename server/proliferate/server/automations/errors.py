from __future__ import annotations

from proliferate.errors import Conflict, InvalidRequest, NotFoundError, ProliferateError


class AutomationError(ProliferateError):
    """Base class for automation product errors."""


class AutomationServiceError(AutomationError):
    """Raised when an automation operation fails with a client-facing error."""

    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message=message, code=code, status_code=status_code)


class AutomationNotFound(NotFoundError):
    code = "automation_not_found"

    def __init__(self) -> None:
        super().__init__(message="Automation not found.", code=self.code)


class AutomationInvalidField(InvalidRequest):
    code = "automation_invalid_field"

    def __init__(self, message: str) -> None:
        super().__init__(message=message, code=self.code)


class AutomationInvalidExecutionTarget(InvalidRequest):
    code = "automation_invalid_execution_target"

    def __init__(self) -> None:
        super().__init__(message="Execution target must be 'cloud' or 'local'.", code=self.code)


class AutomationInvalidAgentKind(InvalidRequest):
    code = "automation_invalid_agent_kind"

    def __init__(self) -> None:
        super().__init__(
            message="Agent kind must be one of: claude, codex, gemini.",
            code=self.code,
        )


class AutomationInvalidReasoningEffort(InvalidRequest):
    code = "automation_invalid_reasoning_effort"

    def __init__(self) -> None:
        super().__init__(message="Reasoning effort is not supported.", code=self.code)


class AutomationAgentRequired(InvalidRequest):
    code = "automation_agent_required"

    def __init__(self) -> None:
        super().__init__(
            message="Choose an agent before scheduling this automation.",
            code=self.code,
        )


class AutomationInvalidSchedule(InvalidRequest):
    code = "automation_invalid_schedule"

    def __init__(self, message: str) -> None:
        super().__init__(message=message, code=self.code)


class AutomationRepoImmutable(InvalidRequest):
    code = "automation_repo_immutable"

    def __init__(self) -> None:
        super().__init__(
            message="Automation repository cannot be changed after creation.",
            code=self.code,
        )


class AutomationPaused(InvalidRequest):
    code = "automation_paused"

    def __init__(self) -> None:
        super().__init__(
            message="Resume this automation before queueing a manual run.",
            code=self.code,
        )


class AutomationRepoLimitExceeded(Conflict):
    code = "repo_limit_exceeded"

    def __init__(self, *, active_repo_count: int, cloud_repo_limit: int) -> None:
        super().__init__(
            message=(
                "Cloud repo limit reached. Upgrade or disable another cloud repo "
                f"before scheduling this one ({active_repo_count}/{cloud_repo_limit})."
            ),
            code=self.code,
        )
