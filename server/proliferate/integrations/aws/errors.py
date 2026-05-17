"""AWS integration errors."""

from __future__ import annotations


class AwsIntegrationError(Exception):
    """Raised when AWS credential validation fails."""

    def __init__(self, message: str, *, code: str = "aws_validation_failed") -> None:
        super().__init__(message)
        self.code = code
