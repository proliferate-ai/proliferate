from __future__ import annotations

import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

ClientActivitySurface = Literal["desktop", "web", "mobile"]
ClientTelemetryMode = Literal[
    "full",
    "limited",
    "off",
    "local_dev",
    "self_managed",
    "hosted_product",
]
_LOW_CARDINALITY_ROUTE_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class ClientDailyActivityRequest(BaseModel):
    surface: ClientActivitySurface
    anonymous_install_uuid: UUID | None = Field(default=None, alias="anonymousInstallUuid")
    telemetry_mode: ClientTelemetryMode | None = Field(default=None, alias="telemetryMode")
    app_version: str | None = Field(default=None, alias="appVersion", max_length=255)
    platform: str | None = Field(default=None, max_length=64)
    route_or_screen: str | None = Field(default=None, alias="routeOrScreen", max_length=128)

    @field_validator("route_or_screen")
    @classmethod
    def sanitize_route_or_screen(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            return None
        if not _LOW_CARDINALITY_ROUTE_RE.fullmatch(stripped):
            return "unknown"
        return stripped.lower()


class AnalyticsAcceptedResponse(BaseModel):
    accepted: bool = True
