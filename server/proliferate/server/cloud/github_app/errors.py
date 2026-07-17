"""GitHub App authorization domain errors."""

from __future__ import annotations

from uuid import UUID

from proliferate.server.cloud.errors import CloudApiError


class GitHubAppReauthorizationRequired(CloudApiError):
    """A permanent refresh failure whose staged state must commit with the error."""

    def __init__(
        self,
        authorization_id: UUID,
        *,
        code: str = "github_app_authorization_expired",
        message: str = ("Reconnect the Proliferate GitHub App before using GitHub Cloud repos."),
    ) -> None:
        super().__init__(code, message, status_code=409)
        self.authorization_id = authorization_id
