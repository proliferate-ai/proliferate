"""Request and response models for the agent gateway auth APIs (P1 rebuild).

Responses never carry key material — with one deliberate exception:
``AgentAuthStateResponse`` mirrors the AnyHarness ``state.json`` v2 contract and
carries the caller's OWN decrypted keys, exactly as the cloud materializer writes
them into the caller's own sandbox (same trust model, different delivery
surface). That model uses the on-disk snake_case field names verbatim (matching
``route_auth/state.rs``), deliberately NOT camelCased like the rest of the module.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.agent_gateway import (
    AgentApiKeyRecord,
    AgentAuthDeliveryAckRecord,
    AgentAuthSelectionRecord,
    AgentGatewayEnrollmentKeyRecord,
    AgentGatewayEnrollmentRecord,
    DesiredAuthSource,
    OrgMemberRouteSelectionRecord,
)

# From the records module directly: the sample surface is advisory-only and
# deliberately absent from the store package namespace (import-scan enforced).
from proliferate.db.store.agent_gateway.records import SeatUsageSampleRecord

if TYPE_CHECKING:
    from proliferate.server.agent_auth.service import OrgAgentPolicySnapshot

AgentAuthSurface = Literal["local", "cloud"]
AgentAuthSourceKind = Literal["gateway", "api_key", "seat"]
# state.json WIRE source kinds: the DB source kinds plus `provider_config`,
# the render-time wire shape of an api_key selection referencing a typed
# vault entry (constants.agent_gateway.AGENT_AUTH_SOURCE_PROVIDER_CONFIG).
AgentAuthStateSourceKind = Literal["gateway", "api_key", "provider_config", "seat"]
# The vault's closed kind vocabulary (agent_auth spec §2 "The vault");
# mirrors constants.agent_gateway.AGENT_API_KEY_KINDS.
AgentApiKeyKind = Literal["api_key", "aws_bedrock", "azure_openai", "anthropic_subscription"]
AgentProviderConfigKind = Literal["aws_bedrock", "azure_openai"]
# The kinds POST /keys accepts: the bare-secret default, or a seat — the mint
# flow's courier upload (agent_auth spec §3 flow 2). Typed provider configs
# keep their own route (POST /keys/provider-config).
AgentApiKeyCreateKind = Literal["api_key", "anthropic_subscription"]


class AgentGatewayBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


# --------------------------------------------------------------------------- #
# Key vault
# --------------------------------------------------------------------------- #


class AgentApiKeyResponse(AgentGatewayBaseModel):
    id: str
    title: str
    kind: AgentApiKeyKind
    redacted_hint: str = Field(alias="redactedHint")
    status: str
    created_at: str = Field(alias="createdAt")


class AgentApiKeyCreateRequest(AgentGatewayBaseModel):
    """Create a bare key — or, with ``kind='anthropic_subscription'``, a seat.

    The seat path is the mint flow's one upward secret write (agent_auth spec
    §3 flow 2): ``value`` is the captured ``claude setup-token`` credential,
    and the mint label fields carry the user-entered seat identity — the
    system can learn neither email nor plan from the token, so the mint sheet
    asks. ``title`` is optional for a seat: the server composes it from
    ``email`` + ``planTier``, defaulting to "Max seat N".
    """

    title: str | None = None
    value: str
    kind: AgentApiKeyCreateKind = "api_key"
    # Mint label fields (seat kind only; ignored for a bare key).
    email: str | None = None
    plan_tier: str | None = Field(default=None, alias="planTier")


class AgentProviderConfigCreateRequest(AgentGatewayBaseModel):
    """Create a typed vault entry (D2's ``ProviderConfigCreatorSubmit`` shape)."""

    title: str
    kind: AgentProviderConfigKind
    value: dict[str, str]


# --------------------------------------------------------------------------- #
# Auth selections
# --------------------------------------------------------------------------- #


class AgentAuthSelectionResponse(AgentGatewayBaseModel):
    id: str
    harness_kind: str = Field(alias="harnessKind")
    surface: AgentAuthSurface
    source_kind: AgentAuthSourceKind = Field(alias="sourceKind")
    api_key_id: str | None = Field(alias="apiKeyId")
    # The referenced key's title, joined for display (null for gateway rows or a
    # vanished key). ``providerHint`` is display-only and has zero wire semantics.
    key_title: str | None = Field(alias="keyTitle")
    env_var_name: str | None = Field(alias="envVarName")
    provider_hint: str | None = Field(alias="providerHint")
    enabled: bool
    # Applied means acknowledged (agent-auth.md): True only once this scope's
    # surface runtime has confirmed a delivery covering it. False is the
    # visible pending state — including a delivery that never happened. The
    # server always computes and sets a boolean; the schema-optional shape
    # exists only so the generated client type stays optional (fixture
    # builders predating the ack pipeline read as applied — clients treat
    # exactly `false` as pending, never absence).
    applied: bool | None = None
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class AgentAuthSourceInput(AgentGatewayBaseModel):
    """One entry of a full-desired-state PUT of a scope's selection sources."""

    source_kind: AgentAuthSourceKind = Field(alias="sourceKind")
    api_key_id: str | None = Field(default=None, alias="apiKeyId")
    env_var_name: str | None = Field(default=None, alias="envVarName")
    provider_hint: str | None = Field(default=None, alias="providerHint")
    enabled: bool = True


class AgentAuthSelectionsPutRequest(AgentGatewayBaseModel):
    sources: list[AgentAuthSourceInput]
    # Per-harness advanced settings (catalog-declared toggles). Keys are setting
    # keys from the agent catalog; values are booleans (v1). Null/absent means
    # "no change to settings". The server validates shape (dict[str, bool]) but
    # does NOT validate keys against the catalog (runtime-only artifact).
    settings: dict[str, Any] | None = None


# --------------------------------------------------------------------------- #
# state.json v2 (the AnyHarness wire contract; snake_case on the wire)
# --------------------------------------------------------------------------- #


class AgentAuthStateSource(BaseModel):
    """A single credential source (contract §3). Key material for the caller.

    ``kind`` is the WIRE kind, which is wider than the DB source_kind: a
    selection referencing a typed vault entry renders as
    ``provider_config`` (``config_kind`` + the harness's resolved ``env``
    map), decided at render time by the referenced vault row's kind.
    """

    kind: AgentAuthStateSourceKind
    base_url: str | None = None
    key: str | None = None
    env_var_name: str | None = None
    value: str | None = None
    config_kind: AgentProviderConfigKind | None = None
    # `provider_config` and `seat`: the harness's already-resolved env map
    # (a seat's is exactly {CLAUDE_CODE_OAUTH_TOKEN: token}).
    env: dict[str, str] | None = None
    # `seat` only: the vault entry id, so the runtime can name the serving
    # seat in its status document without ever echoing the token.
    seat_id: str | None = None


class AgentAuthStateHarness(BaseModel):
    harness_kind: str
    sources: list[AgentAuthStateSource]
    # Present exactly when ``sources`` is empty (present-but-empty fails
    # closed): the renderer's plain-words refusal vocabulary naming why the
    # selection could not be satisfied (agent_auth spec §2 — "the refusal
    # names the actual reason"). Never rides beside a rendered source.
    unsatisfied_reason: str | None = None
    settings: dict[str, Any] | None = None


class AgentAuthStateResponse(BaseModel):
    """The whole ``state.json`` v2 document (``route_auth/state.rs``).

    ``fingerprint`` is a response-only rider (the renderer's sha256 of the
    canonical document), NOT part of the state.json wire contract: the desktop
    echoes it through ``POST /state/ack`` after a successful runtime push and
    must strip it before pushing the document to the local runtime.

    ``harness_settings`` is a second response-only rider: the surface's full
    persisted harness-settings map (``agent_auth_harness_settings``), keyed by
    harness_kind. The document's per-harness ``settings`` passenger only rides
    when the harness has an enabled selection — the fail-closed law forbids a
    settings-only ``harnesses`` entry — so the settings pane reads this rider
    to show persisted toggle values for a native-auth harness. Like
    ``fingerprint``, the desktop strips it before pushing the document to the
    local runtime.
    """

    version: int
    revision: int
    user_id: str | None = None
    harnesses: list[AgentAuthStateHarness]
    fingerprint: str | None = None
    harness_settings: dict[str, dict[str, object]] | None = None


class AgentAuthStateAckRequest(BaseModel):
    """Desktop delivery ack: the pushed document's identity, echoed back.

    ``revision`` is the revision the local runtime's state PUT/DELETE
    confirmed; ``fingerprint`` is the served document's fingerprint from
    ``GET /state`` (never client-computed).
    """

    revision: int
    fingerprint: str


class AgentAuthDeliveryAckResponse(AgentGatewayBaseModel):
    surface: AgentAuthSurface
    acked_revision: int = Field(alias="ackedRevision")
    acked_at: str = Field(alias="ackedAt")


# --------------------------------------------------------------------------- #
# Seats
# --------------------------------------------------------------------------- #


# The observed limit window (spec §2 `seat_usage_sample.binding_window`).
AgentSeatLimitWindow = Literal["five_hour", "seven_day"]


class AgentSeatLimitHitRequest(AgentGatewayBaseModel):
    """The courier's relay of a runtime-observed seat limit hit (spec §3 flow 5).

    ``window`` is which utilization window bound (null when the provider error
    did not say); ``resetAt`` is the reset time the error carried. Cooling is
    runtime-local and never waits on this report — the route only feeds the
    meters and the audit events.
    """

    window: AgentSeatLimitWindow | None = None
    reset_at: datetime = Field(alias="resetAt")


# --------------------------------------------------------------------------- #
# Capabilities + enrollment
# --------------------------------------------------------------------------- #


# The parsed verification-delta shape (never key material): a diff verdict
# carries the missing/extra model-id lists plus the observed/expected counts, and
# the degraded fallback carries string notes. Precise rather than ``Any`` so the
# strict mypy census stays clean.
VerificationDelta = dict[str, list[str] | int | str]


class AgentGatewayVerificationVerdict(AgentGatewayBaseModel):
    """One per-harness gateway-enablement verdict (agent-auth.md FR-3).

    ``delta`` is the parsed verification-delta JSON (never key material); it is
    present only for a ``misconfigured`` verdict.
    """

    harness_kind: str = Field(alias="harnessKind")
    status: str
    delta: VerificationDelta | None = None
    verified_at: str | None = Field(default=None, alias="verifiedAt")


class AgentGatewayCapabilitiesResponse(AgentGatewayBaseModel):
    gateway_enabled: bool = Field(alias="gatewayEnabled")
    public_base_url: str | None = Field(alias="publicBaseUrl")
    enrollment_status: str = Field(alias="enrollmentStatus")
    # Additive AA-3 surface: True exactly when the state renderer is
    # withholding gateway keys for this user's paying subject (credit
    # exhausted or unfunded), so the client can say "out of credits" instead
    # of the runtime's generic selection-missing refusal. Defaulted so older
    # callers constructing the model are unaffected.
    credits_exhausted: bool = Field(default=False, alias="creditsExhausted")
    # Additive FR-3 surface: per-harness gateway-enablement verdicts for the
    # governing enrollment. Empty until the verification loop records one.
    verifications: list[AgentGatewayVerificationVerdict] = Field(
        default_factory=list,
        alias="verifications",
    )


class AgentGatewayEnrollmentResponse(AgentGatewayBaseModel):
    id: str
    subject_kind: str = Field(alias="subjectKind")
    litellm_team_id: str | None = Field(alias="litellmTeamId")
    sync_status: str = Field(alias="syncStatus")
    last_error_code: str | None = Field(alias="lastErrorCode")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


# --------------------------------------------------------------------------- #
# Org policy (flag-only)
# --------------------------------------------------------------------------- #


class OrgAgentPolicyResponse(AgentGatewayBaseModel):
    """Flag-only policy. ``None`` lists mean "no restriction"."""

    organization_id: str = Field(alias="organizationId")
    allowed_routes: list[str] | None = Field(alias="allowedRoutes")
    allowed_harnesses: list[str] | None = Field(alias="allowedHarnesses")
    editable: bool
    updated_by_user_id: str | None = Field(alias="updatedByUserId")
    updated_at: str | None = Field(alias="updatedAt")


class OrgAgentPolicyUpdateRequest(AgentGatewayBaseModel):
    allowed_routes: list[str] | None = Field(default=None, alias="allowedRoutes")
    allowed_harnesses: list[str] | None = Field(default=None, alias="allowedHarnesses")


class OrgAgentPolicyViolation(AgentGatewayBaseModel):
    user_id: str = Field(alias="userId")
    email: str | None
    display_name: str | None = Field(alias="displayName")
    harness_kind: str = Field(alias="harnessKind")
    surface: AgentAuthSurface
    source_kind: AgentAuthSourceKind = Field(alias="sourceKind")


class OrgAgentPolicyViolationListResponse(AgentGatewayBaseModel):
    violations: list[OrgAgentPolicyViolation]


# seat_usage_sample vocabularies (agent_auth spec §2, flow 5); mirror
# constants.agent_gateway.SEAT_USAGE_STATUSES / _BINDING_WINDOWS.
SeatUsageStatus = Literal["allowed", "limited", "probe_failed"]
SeatUsageBindingWindow = Literal["five_hour", "seven_day"]


class SeatUsageSampleResponse(AgentGatewayBaseModel):
    """One seat's latest usage-probe observation — the meters read.

    Shaped for the pane, no raw header passthrough (spec §4 cell 1's usage
    read): 0..1 utilization fractions, ISO reset instants, the derived
    binding window. A ``probe_failed`` row carries null observations — the
    pane renders a dash and the sample age, never a stale bar.
    """

    api_key_id: str = Field(alias="apiKeyId")
    sampled_at: str = Field(alias="sampledAt")
    util_5h: float | None = Field(default=None, alias="util5h")
    util_7d: float | None = Field(default=None, alias="util7d")
    reset_5h: str | None = Field(default=None, alias="reset5h")
    reset_7d: str | None = Field(default=None, alias="reset7d")
    binding_window: SeatUsageBindingWindow | None = Field(default=None, alias="bindingWindow")
    status: SeatUsageStatus


# --------------------------------------------------------------------------- #
# Payload builders
# --------------------------------------------------------------------------- #


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def api_key_payload(record: AgentApiKeyRecord) -> AgentApiKeyResponse:
    return AgentApiKeyResponse(
        id=str(record.id),
        title=record.title,
        kind=record.kind,  # type: ignore[arg-type]
        redacted_hint=record.redacted_hint,
        status=record.status,
        created_at=record.created_at.isoformat(),
    )


def seat_usage_sample_payload(record: SeatUsageSampleRecord) -> SeatUsageSampleResponse:
    return SeatUsageSampleResponse(
        api_key_id=str(record.api_key_id),
        sampled_at=record.sampled_at.isoformat(),
        util_5h=record.util_5h,
        util_7d=record.util_7d,
        reset_5h=_iso(record.reset_5h),
        reset_7d=_iso(record.reset_7d),
        binding_window=record.binding_window,
        status=record.status,
    )


def auth_selection_payload(
    record: AgentAuthSelectionRecord,
    *,
    key_title: str | None,
    applied: bool,
) -> AgentAuthSelectionResponse:
    return AgentAuthSelectionResponse(
        id=str(record.id),
        harness_kind=record.harness_kind,
        surface=record.surface,  # type: ignore[arg-type]
        source_kind=record.source_kind,  # type: ignore[arg-type]
        api_key_id=str(record.api_key_id) if record.api_key_id is not None else None,
        key_title=key_title,
        env_var_name=record.env_var_name,
        provider_hint=record.provider_hint,
        enabled=record.enabled,
        applied=applied,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )


def desired_source(input_source: AgentAuthSourceInput) -> DesiredAuthSource:
    """Map a request source onto the store's frozen desired-state record."""
    return DesiredAuthSource(
        source_kind=input_source.source_kind,
        api_key_id=UUID(input_source.api_key_id) if input_source.api_key_id else None,
        env_var_name=input_source.env_var_name,
        provider_hint=input_source.provider_hint,
        enabled=input_source.enabled,
    )


def verification_verdict_payload(
    record: AgentGatewayEnrollmentKeyRecord,
) -> AgentGatewayVerificationVerdict:
    delta: VerificationDelta | None = None
    if record.verification_delta is not None:
        try:
            parsed = json.loads(record.verification_delta)
        except (ValueError, TypeError):
            parsed = None
        if isinstance(parsed, dict):
            delta = parsed
    return AgentGatewayVerificationVerdict(
        harness_kind=record.harness_kind,
        status=record.verification_status or "",
        delta=delta,
        verified_at=_iso(record.verified_at),
    )


def agent_auth_state_payload(
    state: dict[str, object],
    *,
    fingerprint: str | None = None,
    harness_settings: dict[str, dict[str, object]] | None = None,
) -> AgentAuthStateResponse:
    response = AgentAuthStateResponse.model_validate(state)
    response.fingerprint = fingerprint
    response.harness_settings = harness_settings
    return response


def delivery_ack_payload(
    record: AgentAuthDeliveryAckRecord,
) -> AgentAuthDeliveryAckResponse:
    return AgentAuthDeliveryAckResponse(
        surface=record.surface,  # type: ignore[arg-type]
        acked_revision=record.acked_revision,
        acked_at=record.acked_at.isoformat(),
    )


def org_agent_policy_payload(snapshot: OrgAgentPolicySnapshot) -> OrgAgentPolicyResponse:
    return OrgAgentPolicyResponse(
        organization_id=str(snapshot.organization_id),
        allowed_routes=(
            list(snapshot.allowed_routes) if snapshot.allowed_routes is not None else None
        ),
        allowed_harnesses=(
            list(snapshot.allowed_harnesses) if snapshot.allowed_harnesses is not None else None
        ),
        editable=snapshot.editable,
        updated_by_user_id=(
            str(snapshot.updated_by_user_id) if snapshot.updated_by_user_id is not None else None
        ),
        updated_at=_iso(snapshot.updated_at),
    )


def org_agent_policy_violation_payload(
    record: OrgMemberRouteSelectionRecord,
) -> OrgAgentPolicyViolation:
    return OrgAgentPolicyViolation(
        user_id=str(record.user_id),
        email=record.email,
        display_name=record.display_name,
        harness_kind=record.harness_kind,
        surface=record.surface,  # type: ignore[arg-type]
        source_kind=record.source_kind,  # type: ignore[arg-type]
    )


def enrollment_payload(record: AgentGatewayEnrollmentRecord) -> AgentGatewayEnrollmentResponse:
    return AgentGatewayEnrollmentResponse(
        id=str(record.id),
        subject_kind=record.subject_kind,
        litellm_team_id=record.litellm_team_id,
        sync_status=record.sync_status,
        last_error_code=record.last_error_code,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )
