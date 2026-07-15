from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SupportFeedSentryEvent(BaseModel):
    project: str
    event_id: str = Field(alias="eventId")


class SupportFeedItem(BaseModel):
    report_id: str = Field(alias="reportId")
    submitted_at: datetime = Field(alias="submittedAt")
    completed_at: datetime = Field(alias="completedAt")
    owner_user_id: str = Field(alias="ownerUserId")
    kind: str
    summary: str | None = None
    release_id: str | None = Field(default=None, alias="releaseId")
    # Machine-readable warning surfaced when the release is missing/malformed.
    release_warning: str | None = Field(default=None, alias="releaseWarning")
    notify_me: bool = Field(alias="notifyMe")
    credit_consent: bool = Field(alias="creditConsent")
    credit_name: str | None = Field(default=None, alias="creditName")
    outreach_override: str | None = Field(default=None, alias="outreachOverride")
    private_case_reference: str = Field(alias="privateCaseReference")
    sentry_events: list[SupportFeedSentryEvent] = Field(default_factory=list, alias="sentryEvents")
    cursor: str

    model_config = {"populate_by_name": True}


class SupportFeedPage(BaseModel):
    items: list[SupportFeedItem]
    next_cursor: str | None = Field(default=None, alias="nextCursor")
    has_more: bool = Field(alias="hasMore")

    model_config = {"populate_by_name": True}
