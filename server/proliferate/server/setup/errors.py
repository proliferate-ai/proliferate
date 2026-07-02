"""First-run setup errors. The setup transport renders them as HTML pages."""

from __future__ import annotations


class FirstRunSetupError(Exception):
    def __init__(self, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class SetupClosedError(FirstRunSetupError):
    """The instance already has a user; setup is permanently closed."""

    def __init__(self) -> None:
        super().__init__("Not found.", status_code=404)


class InvalidSetupTokenError(FirstRunSetupError):
    def __init__(self) -> None:
        super().__init__(
            "The setup token is missing or incorrect. "
            "Find it in the output of bootstrap.sh on the server.",
            status_code=403,
        )


class SetupValidationError(FirstRunSetupError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=400)
