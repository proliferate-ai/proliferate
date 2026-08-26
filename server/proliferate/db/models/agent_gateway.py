"""Agent LLM gateway ORM models (LiteLLM-era agent auth).

The auth model (P1 rebuild, see the agent-auth selection model): a titled
personal API key vault (``agent_api_key``) plus per-(user, harness, surface)
wiring rows (``agent_auth_selection``). Each selection row is either the
gateway or a single direct api_key; there is no native source (native == the
empty state). Alongside: eager LiteLLM enrollment state, catalog
snapshots/overrides, flag-only org policy, and the slim usage-event ledger.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base
from proliferate.lib.infra.time.wall_clock import utcnow


class AgentApiKey(Base):
    """A titled secret in a user's personal key vault.

    Provider-agnostic for the bare-secret ``kind='api_key'`` default: the key
    is bound to a provider only when a selection row references it under a
    specific ``env_var_name`` (see AgentAuthSelection). A typed ``kind``
    (``aws_bedrock``, ``azure_openai``) instead carries the harness's own
    provider-config JSON document (agent-auth.md's "The vault"); a selection
    referencing a typed entry names no ``env_var_name`` — the typed kind
    carries its own env mapping, applied by the harness's render recipe.
    """

    __tablename__ = "agent_api_key"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'revoked')",
            name="ck_agent_api_key_status",
        ),
        CheckConstraint(
            "kind IN ('api_key', 'aws_bedrock', 'azure_openai')",
            name="ck_agent_api_key_kind",
        ),
        Index("ix_agent_api_key_user_status", "user_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    title: Mapped[str] = mapped_column(Text)
    # 'api_key' (default): value_ciphertext decrypts to one opaque secret
    # string. 'aws_bedrock' | 'azure_openai': value_ciphertext decrypts to a
    # JSON document (region+credentials / endpoint+deployment+key) — see
    # proliferate.lib.infra.encryption.json.{encrypt_json,decrypt_json}.
    kind: Mapped[str] = mapped_column(
        Text,
        default="api_key",
        server_default=text("'api_key'"),
    )
    value_ciphertext: Mapped[str] = mapped_column(Text)
    encryption_key_id: Mapped[str] = mapped_column(Text)
    redacted_hint: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AgentAuthSelection(Base):
    """One wiring row per (user, harness, surface, source_kind, env_var_name).

    A row is either the gateway (``source_kind='gateway'``, no key/env) or a
    single direct api_key (``source_kind='api_key'``, both api_key_id and
    env_var_name set). Native == the empty state (zero enabled rows for a
    scope). Single-source harnesses keep exactly one enabled row; OpenCode
    composes the gateway plus any number of api_key rows. ``provider_hint`` is
    display-only (a registry provider id) with zero launch semantics; the
    renderer never puts it on the wire.
    """

    __tablename__ = "agent_auth_selection"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "harness_kind",
            "surface",
            "source_kind",
            "env_var_name",
            name="uq_agent_auth_selection_scope",
        ),
        CheckConstraint(
            "surface IN ('local', 'cloud')",
            name="ck_agent_auth_selection_surface",
        ),
        CheckConstraint(
            "source_kind IN ('gateway', 'api_key')",
            name="ck_agent_auth_selection_source_kind",
        ),
        # As tight as one table can express: an api_key row always references
        # a vault entry, but env_var_name's presence depends on that entry's
        # KIND (bare 'api_key' requires one; a typed kind forbids one — the
        # kind carries its own env mapping), and a CHECK cannot join
        # agent_api_key to see it. The bare-XOR-typed shape law is therefore
        # enforced in the store's write gate
        # (selections.py `_assert_keys_usable`), which the spec names as the
        # owner of cross-table shape checks (agent-auth.md "Shape checks are
        # structural").
        CheckConstraint(
            "source_kind != 'api_key' OR api_key_id IS NOT NULL",
            name="ck_agent_auth_selection_api_key_shape",
        ),
        CheckConstraint(
            "source_kind != 'gateway' OR (api_key_id IS NULL AND env_var_name IS NULL)",
            name="ck_agent_auth_selection_gateway_shape",
        ),
        # The scope UNIQUE treats gateway rows (env_var_name IS NULL) as
        # distinct, so enforce "at most one gateway per scope" separately.
        Index(
            "ux_agent_auth_selection_gateway",
            "user_id",
            "harness_kind",
            "surface",
            unique=True,
            postgresql_where=text("source_kind = 'gateway'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    harness_kind: Mapped[str] = mapped_column(String(64))
    surface: Mapped[str] = mapped_column(Text)
    source_kind: Mapped[str] = mapped_column(Text)
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        # CASCADE (not SET NULL): the api_key_shape check forbids a NULL
        # api_key_id on an api_key row, so a deleted key must take its
        # referencing selections with it rather than orphan them.
        ForeignKey("agent_api_key.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    env_var_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=text("true"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AgentAuthDeliveryAck(Base):
    """The last acknowledged agent-auth state delivery per (user, surface).

    One row per (user, surface), stamped when the surface's runtime confirms
    the rendered ``state.json`` (agent-auth.md "Applied means acknowledged"):
    cloud — the materialization operation completing against the sandbox;
    local — the desktop reporting its runtime's accepted state push. The UI's
    pending→applied truth is derived by comparing the surface's CURRENT
    rendered (revision, fingerprint) against this stamp; the fingerprint is
    the change detector, the revision only rejects an out-of-order (delayed)
    ack for an older document.
    """

    __tablename__ = "agent_auth_delivery_ack"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "surface",
            name="uq_agent_auth_delivery_ack_scope",
        ),
        CheckConstraint(
            "surface IN ('local', 'cloud')",
            name="ck_agent_auth_delivery_ack_surface",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    surface: Mapped[str] = mapped_column(Text)
    # The rendered document's revision (ms-epoch max(updated_at) over the
    # surface's selection rows) at delivery time. BigInteger: ms epochs exceed
    # int32 by six orders of magnitude.
    acked_revision: Mapped[int] = mapped_column(BigInteger)
    # sha256 hex of the canonical rendered document — the same fingerprint the
    # renderer computes (materialize/agent_auth.py).
    acked_fingerprint: Mapped[str] = mapped_column(String(128))
    acked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AgentAuthHarnessSettings(Base):
    """Per-(user, harness, surface) advanced settings (catalog-declared toggles).

    Settings are independent of auth source selections: a user can toggle
    --chrome for their Claude harness regardless of which auth source is wired.
    The ``settings_json`` column is a JSON object mapping setting keys to their
    persisted values (booleans for v1).
    """

    __tablename__ = "agent_auth_harness_settings"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "harness_kind",
            "surface",
            name="uq_agent_auth_harness_settings_scope",
        ),
        CheckConstraint(
            "surface IN ('local', 'cloud')",
            name="ck_agent_auth_harness_settings_surface",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    harness_kind: Mapped[str] = mapped_column(String(64))
    surface: Mapped[str] = mapped_column(Text)
    settings_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AgentGatewayEnrollment(Base):
    """LiteLLM enrollment state per billing subject (team + user + virtual key)."""

    __tablename__ = "agent_gateway_enrollment"
    __table_args__ = (
        CheckConstraint(
            "subject_kind IN ('user', 'organization')",
            name="ck_agent_gateway_enrollment_subject_kind",
        ),
        CheckConstraint(
            # Personal enrollment: user only. Org enrollment: one row per
            # (member, org) so every member gets their own virtual key under
            # the org team (spec §2.3), hence user_id is required for both.
            "(subject_kind = 'user' AND user_id IS NOT NULL AND organization_id IS NULL) OR "
            "(subject_kind = 'organization' AND organization_id IS NOT NULL "
            "AND user_id IS NOT NULL)",
            name="ck_agent_gateway_enrollment_subject_shape",
        ),
        CheckConstraint(
            "sync_status IN ('pending', 'synced', 'failed')",
            name="ck_agent_gateway_enrollment_sync_status",
        ),
        CheckConstraint(
            "budget_status IN ('ok', 'exhausted', 'limit_reached')",
            name="ck_agent_gateway_enrollment_budget_status",
        ),
        Index(
            "ux_agent_gateway_enrollment_active_user",
            "user_id",
            unique=True,
            postgresql_where=text("subject_kind = 'user' AND revoked_at IS NULL"),
        ),
        Index(
            "ux_agent_gateway_enrollment_active_organization",
            "organization_id",
            "user_id",
            unique=True,
            postgresql_where=text("subject_kind = 'organization' AND revoked_at IS NULL"),
        ),
        Index("ix_agent_gateway_enrollment_sync_status", "sync_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    subject_kind: Mapped[str] = mapped_column(String(16))
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("billing_subject.id", ondelete="CASCADE"),
        index=True,
    )
    litellm_team_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    litellm_user_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    virtual_key_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    virtual_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    virtual_key_ciphertext_key_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    sync_status: Mapped[str] = mapped_column(String(16), default="pending")
    budget_status: Mapped[str] = mapped_column(
        String(16),
        default="ok",
        server_default=text("'ok'"),
    )
    sync_fingerprint: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentGatewayEnrollmentKey(Base):
    """One per-(enrollment, harness) LiteLLM virtual key (model-gateway.md §Account model).

    Child of ``agent_gateway_enrollment``: an enrollment's LiteLLM team stays
    the single money/attribution boundary, but each gateway-capable
    harness_kind gets its own virtual key scoped to that harness's access
    group (``{"models": [harness_kind]}`` at ``/key/generate``). Keys never
    carry a budget — the team is the only budget layer
    (model-gateway.md "Account model" table); ``max_budget`` is not a column
    on this table by design, unlike the parent enrollment row which still
    tracks the team's budget separately.
    """

    __tablename__ = "agent_gateway_enrollment_key"
    __table_args__ = (
        UniqueConstraint(
            "enrollment_id",
            "harness_kind",
            name="uq_agent_gateway_enrollment_key_scope",
        ),
        Index(
            "ux_agent_gateway_enrollment_key_active_scope",
            "enrollment_id",
            "harness_kind",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
        Index("ix_agent_gateway_enrollment_key_virtual_key_id", "virtual_key_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    enrollment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_gateway_enrollment.id", ondelete="CASCADE"),
        index=True,
    )
    harness_kind: Mapped[str] = mapped_column(String(64))
    virtual_key_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    virtual_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    virtual_key_ciphertext_key_id: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )
    sync_fingerprint: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Gateway-enablement verification verdict (agent-auth.md FR-3): the
    # control-plane loop records here whether this key can see its access-group's
    # models. All three are nullable — a never-verified key carries no verdict, and
    # the delta is a small JSON string ({"reason": ..., "models": [...]}) surfaced
    # additively to clients, never key material.
    verification_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    verification_delta: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OrgAgentPolicy(Base):
    """Flag-only org agent policy; violations computed live from selections."""

    __tablename__ = "org_agent_policy"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"),
        primary_key=True,
    )
    allowed_routes_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    allowed_harnesses_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AgentLlmUsageEvent(Base):
    """Slim per-request ledger imported from LiteLLM spend logs."""

    __tablename__ = "agent_llm_usage_event"
    __table_args__ = (
        Index("ix_agent_llm_usage_event_user_occurred", "user_id", "occurred_at"),
        Index(
            "ix_agent_llm_usage_event_org_occurred",
            "organization_id",
            "occurred_at",
        ),
        Index(
            "ix_agent_llm_usage_event_subject_occurred",
            "billing_subject_id",
            "occurred_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    litellm_request_id: Mapped[str] = mapped_column(String(255), unique=True)
    virtual_key_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    litellm_team_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organization.id", ondelete="SET NULL"),
        nullable=True,
    )
    billing_subject_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("billing_subject.id", ondelete="SET NULL"),
        nullable=True,
    )
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    completion_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    total_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    cost_usd: Mapped[float | None] = mapped_column(
        Numeric(18, 8, asdecimal=False),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32), default="imported")
    workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    raw_metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class LlmCreditGrant(Base):
    """A grant of LLM credits for a billing subject (credit side of the ledger).

    Debits are the imported ``agent_llm_usage_event`` rows; remaining credit is
    ``sum(active grants.amount_usd) - sum(usage.cost_usd)``. There is no
    per-grant consumption row: usage events are the single debit source.
    """

    __tablename__ = "llm_credit_grant"
    __table_args__ = (
        CheckConstraint(
            "source IN ('free_signup', 'topup', 'admin', 'seat_pool')",
            name="ck_llm_credit_grant_source",
        ),
        CheckConstraint(
            "amount_usd >= 0",
            name="ck_llm_credit_grant_amount_non_negative",
        ),
        UniqueConstraint("source_ref", name="uq_llm_credit_grant_source_ref"),
        Index("ix_llm_credit_grant_billing_subject_id", "billing_subject_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Indexed via the explicit Index in __table_args__; ``index=True`` here
    # would auto-generate a second Index under the SAME conventional name and
    # make ``Base.metadata.create_all`` fail with DuplicateTableError.
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("billing_subject.id", ondelete="CASCADE"),
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    source: Mapped[str] = mapped_column(String(32))
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(12, 4))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)


class AgentLlmUsageImportCursor(Base):
    """Singleton cursor for the LiteLLM spend-log importer."""

    __tablename__ = "agent_llm_usage_import_cursor"
    __table_args__ = (
        CheckConstraint(
            "id = 'default'",
            name="ck_agent_llm_usage_import_cursor_singleton",
        ),
    )

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default="default")
    last_seen_occurred_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_polled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32), default="idle")
    last_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
