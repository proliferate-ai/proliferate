"""Workflow gateway-facing ORM models: function invocations + per-run tokens.

Split out of ``workflows.py`` (WS2a, size discipline): these two tables serve
the integration-gateway surface of workflows rather than the definition/run
ledger. Existing importers keep working via the re-exports in ``workflows.py``.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class FunctionInvocationDefinition(Base):
    """A user-authored HTTP function the agent can invoke through the gateway.

    Part II mental-model §1: v1 = a pure HTTP request our server makes on the
    agent's behalf, with server-side safety guarantees (SSRF guard, size/timeout
    caps, no cross-host redirects). Exposed at the integration gateway under the
    reserved ``functions`` provider namespace; the agent addresses one by its
    stable ``name`` (which is also how the run/chat grant list names it).

    Person-scoped for now (``owner_user_id``), consistent with workflows being
    user-scoped in v1; ``organization_id`` is carried nullable so the org-wide
    move (workflows + invocations together) needs no migration.

    ``headers_ciphertext`` is a Fernet-encrypted JSON blob (house crypto helpers)
    carrying request headers that may hold API keys — WRITE-ONLY from the UI
    (set/rotate, never read back), the same D4 posture as poll-trigger auth.

    ``chat_scope_enabled`` is the §2 "default access modes" knob for invocations:
    a new invocation is WORKFLOW-ONLY by default (``false``) and is only added to
    the interactive/chat default-access set once explicitly enabled. Workflow
    runs grant invocations explicitly (E3), independent of this flag.
    """

    __tablename__ = "function_invocation_definition"
    __table_args__ = (
        CheckConstraint(
            "method IN ('get', 'post', 'patch', 'put', 'delete')",
            name="ck_function_invocation_definition_method",
        ),
        # ``name`` is the gateway tool address — unique per owner, among live rows.
        Index(
            "uq_function_invocation_definition_owner_name",
            "owner_user_id",
            "name",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
        Index(
            "ix_function_invocation_definition_owner_active",
            "owner_user_id",
            postgresql_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
    )
    organization_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Stable slug — the grant list + the agent's tool call both address by it.
    name: Mapped[str] = mapped_column(String(64))
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    endpoint_url: Mapped[str] = mapped_column(Text)
    method: Mapped[str] = mapped_column(String(8))
    # Fernet-encrypted JSON blob of request headers; write-only (never read back).
    headers_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    # JSON Schema the agent's call arguments are validated against at the gateway
    # (jsonschema), then merged into the request body/query.
    args_schema_json: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)
    # §7.2 semantic revision: bumps on any SEMANTIC edit (endpoint, method,
    # mapping/schema, header names/templates, status/redirect/idempotency), but
    # NOT on a secret-value-only rotation behind the same binding identity. A
    # workflow run freezes the exact ``(id, semantic_revision)`` it resolved, so a
    # later edit produces a new revision and cannot mutate a running run's meaning.
    semantic_revision: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    # §2 default access modes: WORKFLOW-ONLY until explicitly enabled for chat.
    chat_scope_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class WorkflowRunGatewayToken(Base):
    """The per-run integration-gateway credential (PR E / OPEN-3(a), L16).

    Every run mints exactly one of these at StartRun — even a run whose plan needs
    no integration tools (``scope_json`` is then an empty list, which is legal and
    NEVER conflated with an unscoped worker token). Its plaintext rides inside the
    run's ``resolved_plan_json.gateway`` block to the sandbox; only the hash is
    stored (hashed exactly like the worker token, under its own HMAC domain).

    The token is the run-report credential too: the runtime pings
    ``/runs/{run_id}/ping`` with it. Identity is proven by the credential, so a
    request's run attribution is not a claim — ``workflow_run_id`` IS the run.

    ``scope_json`` is the frozen function grant (the definition's ``functions[]``,
    resolved), narrowed at delivery to the intersection with the delivering
    worker's allowlist (L25 layer 2 ⊆ layer 1). ``status`` walks
    active -> expired (terminal run status) | revoked.
    """

    __tablename__ = "cloud_workflow_run_gateway_token"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'expired', 'revoked')",
            name="ck_cloud_workflow_run_gateway_token_status",
        ),
        # WS3b typed audiences (feature spec §5.3): NULL = a LEGACY all-purpose run
        # token (pre-WS3b, authenticates everywhere it did before migration); a
        # non-NULL audience is a new-style token strictly enforced to one endpoint
        # family (integration | run_report | ping | delivery_claim).
        CheckConstraint(
            "audience IS NULL OR audience IN "
            "('integration', 'run_report', 'ping', 'delivery_claim')",
            name="ck_cloud_workflow_run_gateway_token_audience",
        ),
        Index("ix_cloud_workflow_run_gateway_token_run_id", "workflow_run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workflow_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # The resolved function grant: ``[{"provider": str, "tools": [str, ...]}, ...]``.
    # NOT NULL — an empty list means "no tools granted", distinct from a worker
    # token's NULL "unscoped" (L25).
    scope_json: Mapped[list[dict[str, object]]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default="active")
    # --- WS3b typed audiences + session-bound integration binding (§5.3). -------
    # ADD-ONLY. ``audience`` NULL = legacy all-purpose token. A session-bound
    # integration credential also stamps ``slot_id``/``session_id`` (trusted
    # context, derived only from this row) and ``generation`` (rotation fencing).
    audience: Mapped[str | None] = mapped_column(String(32), nullable=True)
    slot_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    generation: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The one-use issuance handle a session-bound integration credential came from
    # (§5.3). Links the credential back to its ``workflow_credential_issuance`` row.
    issuance_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class WorkflowCredentialIssuance(Base):
    """A per-slot one-use integration-credential issuance handle (WS3b, §5.3).

    Minted per slot into the private execution envelope at StartRun/envelope-mint.
    A fresh slot has no session when the envelope is minted; after AnyHarness
    registers the session and its lease is prepared/claimed it EXCHANGES the
    one-use handle over the authenticated control channel for a short-lived
    integration credential bound to run/plan-hash/generation/slot/session.

    Only ``handle_hash`` is stored — the plaintext handle rides the envelope and
    is never persisted here or logged. ``session_id`` is bound on the first
    exchange; an identical retry for the same unacknowledged (handle, session)
    returns the SAME ``generation``. A different session, a post-``acknowledged``
    reuse, or an exchange before lease acknowledgment (where leases exist) is
    denied. The ``(run_id, slot_id)`` uniqueness makes one handle per slot.
    """

    __tablename__ = "workflow_credential_issuance"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'exchanged', 'acknowledged')",
            name="ck_workflow_credential_issuance_status",
        ),
        UniqueConstraint(
            "workflow_run_id",
            "slot_id",
            name="uq_workflow_credential_issuance_run_slot",
        ),
        Index(
            "ix_workflow_credential_issuance_handle_hash",
            "handle_hash",
            unique=True,
        ),
        Index("ix_workflow_credential_issuance_run_id", "workflow_run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workflow_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workflow_run.id", ondelete="CASCADE"),
    )
    slot_id: Mapped[str] = mapped_column(String(64))
    handle_hash: Mapped[str] = mapped_column(String(64))
    # Delivery-identity echo (§5.3) so a credential binds run + plan hash.
    plan_hash: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Bound on the first exchange; NULL while ``pending``.
    session_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    generation: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    # The active integration credential row this handle currently backs.
    integration_token_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
