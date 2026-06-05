"""Team checkout request and response schemas."""

from __future__ import annotations

from pydantic import EmailStr, Field

from proliferate.server.billing.models import BillingBaseModel, BillingReturnSurface


class TeamCheckoutRequest(BillingBaseModel):
    team_name: str = Field(alias="teamName", min_length=1, max_length=255)
    invite_emails: list[EmailStr] = Field(default_factory=list, alias="inviteEmails")
    return_surface: BillingReturnSurface = Field(default="web", alias="returnSurface")


class TeamCheckoutResponse(BillingBaseModel):
    url: str
    intent_id: str = Field(alias="intentId")


class TeamCheckoutIntentResponse(BillingBaseModel):
    id: str
    organization_id: str = Field(alias="organizationId")
    team_name: str = Field(alias="teamName")
    status: str
    activation_status: str = Field(alias="activationStatus")
    activation_error_code: str | None = Field(default=None, alias="activationErrorCode")
    activation_error_message: str | None = Field(default=None, alias="activationErrorMessage")
    checkout_url: str | None = Field(default=None, alias="checkoutUrl")
    expires_at: str = Field(alias="expiresAt")


class CurrentTeamCheckoutResponse(BillingBaseModel):
    intent: TeamCheckoutIntentResponse | None = None
