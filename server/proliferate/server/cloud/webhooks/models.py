from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CloudWebhookBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class E2BWebhookEventData(CloudWebhookBaseModel):
    sandbox_metadata: dict[str, str] = Field(default_factory=dict, alias="sandbox_metadata")


class E2BWebhookEvent(CloudWebhookBaseModel):
    id: str
    type: str
    sandbox_id: str | None = Field(default=None, alias="sandboxId")
    timestamp: datetime
    event_data: E2BWebhookEventData = Field(default_factory=E2BWebhookEventData, alias="eventData")


class E2BWebhookReceipt(CloudWebhookBaseModel):
    received: bool = True
