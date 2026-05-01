"""Cloud-domain ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
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
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class CloudRuntimeEnvironment(Base):
    __tablename__ = "cloud_runtime_environment"
    __table_args__ = (
        Index(
            "uq_cloud_runtime_environment_user_repo_policy",
            "user_id",
            "git_provider",
            "git_owner_norm",
            "git_repo_name_norm",
            "isolation_policy",
            unique=True,
            postgresql_where=text("organization_id IS NULL"),
        ),
        Index(
            "uq_cloud_runtime_environment_org_repo_policy",
            "organization_id",
            "git_provider",
            "git_owner_norm",
            "git_repo_name_norm",
            "isolation_policy",
            unique=True,
            postgresql_where=text("organization_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)

    git_provider: Mapped[str] = mapped_column(String(32))
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    git_owner_norm: Mapped[str] = mapped_column(String(255))
    git_repo_name_norm: Mapped[str] = mapped_column(String(255))
    isolation_policy: Mapped[str] = mapped_column(String(32), default="repo_shared")

    status: Mapped[str] = mapped_column(String(32), default="pending")
    active_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    runtime_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_data_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    root_anyharness_workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    root_anyharness_repo_root_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    runtime_generation: Mapped[int] = mapped_column(Integer, default=0)
    credential_snapshot_version: Mapped[int] = mapped_column(Integer, default=0)
    credential_files_applied_revision: Mapped[str | None] = mapped_column(Text, nullable=True)
    credential_files_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    credential_process_applied_revision: Mapped[str | None] = mapped_column(Text, nullable=True)
    credential_process_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    credential_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    credential_last_error_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    repo_env_applied_version: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudWorkspace(Base):
    __tablename__ = "cloud_workspace"
    __table_args__ = (
        Index(
            "uq_cloud_workspace_active_branch",
            "runtime_environment_id",
            "git_branch",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
        ),
        CheckConstraint(
            "owner_scope IN ('personal', 'organization')",
            name="ck_cloud_workspace_owner_scope",
        ),
        CheckConstraint(
            "owner_scope != 'personal' OR (owner_user_id IS NOT NULL AND organization_id IS NULL)",
            name="ck_cloud_workspace_personal_owner",
        ),
        CheckConstraint(
            "owner_scope != 'organization' OR "
            "(organization_id IS NOT NULL AND owner_user_id IS NULL)",
            name="ck_cloud_workspace_organization_owner",
        ),
        CheckConstraint(
            "created_by_user_id IS NOT NULL",
            name="ck_cloud_workspace_created_by_user_id",
        ),
    )

    def __init__(self, **kwargs: object) -> None:
        user_id = kwargs.get("user_id")
        kwargs.setdefault("owner_scope", "personal")
        kwargs.setdefault("owner_user_id", user_id)
        kwargs.setdefault("organization_id", None)
        kwargs.setdefault("created_by_user_id", user_id)
        super().__init__(**kwargs)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    owner_scope: Mapped[str] = mapped_column(
        String(32),
        default="personal",
        server_default=text("'personal'"),
    )
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    billing_subject_id: Mapped[uuid.UUID] = mapped_column(index=True)
    runtime_environment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_runtime_environment.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )

    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    git_provider: Mapped[str] = mapped_column(String(32))
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    git_branch: Mapped[str] = mapped_column(String(255))
    git_base_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    origin_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(32))
    status_detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    template_version: Mapped[str] = mapped_column(String(64))

    # Runtime fields below are compatibility-only during the environment
    # migration. New code should read/write CloudRuntimeEnvironment.
    runtime_generation: Mapped[int] = mapped_column(Integer, default=0)

    active_sandbox_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    runtime_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    runtime_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_data_key_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    anyharness_workspace_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    repo_env_vars_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_files_applied_version: Mapped[int] = mapped_column(Integer, default=0)
    repo_setup_applied_version: Mapped[int] = mapped_column(Integer, default=0)
    repo_post_ready_phase: Mapped[str] = mapped_column(String(32), default="idle")
    repo_post_ready_files_total: Mapped[int] = mapped_column(Integer, default=0)
    repo_post_ready_files_applied: Mapped[int] = mapped_column(Integer, default=0)
    repo_post_ready_apply_token: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )
    repo_files_last_failed_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    repo_files_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    repo_files_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    repo_post_ready_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    repo_post_ready_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    archive_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cleanup_state: Mapped[str] = mapped_column(String(32), default="none")
    cleanup_last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class CloudWorkspaceSetupRun(Base):
    __tablename__ = "cloud_workspace_setup_run"
    __table_args__ = (
        Index(
            "ix_cloud_workspace_setup_run_reconciler",
            "status",
            "deadline_at",
            "claim_until",
            "next_poll_at",
        ),
        Index(
            "ix_cloud_workspace_setup_run_workspace_token",
            "workspace_id",
            "apply_token",
            "setup_script_version",
        ),
        UniqueConstraint("command_run_id", name="uq_cloud_workspace_setup_run_command_run_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="CASCADE"),
        index=True,
    )
    anyharness_workspace_id: Mapped[str] = mapped_column(String(255))
    terminal_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    command_run_id: Mapped[str] = mapped_column(String(255))
    setup_script_version: Mapped[int] = mapped_column(Integer)
    apply_token: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    deadline_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    claim_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    claim_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_poll_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudWorkspaceMobility(Base):
    __tablename__ = "cloud_workspace_mobility"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "git_provider",
            "git_owner",
            "git_repo_name",
            "git_branch",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)

    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    git_provider: Mapped[str] = mapped_column(String(32))
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    git_branch: Mapped[str] = mapped_column(String(255))

    owner: Mapped[str] = mapped_column(String(32))
    lifecycle_state: Mapped[str] = mapped_column(String(32))
    status_detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_workspace.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    active_handoff_op_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    last_handoff_op_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    cloud_lost_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cloud_lost_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudWorkspaceHandoffOp(Base):
    __tablename__ = "cloud_workspace_handoff_op"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mobility_workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_workspace_mobility.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)

    direction: Mapped[str] = mapped_column(String(32))
    source_owner: Mapped[str] = mapped_column(String(32))
    target_owner: Mapped[str] = mapped_column(String(32))
    phase: Mapped[str] = mapped_column(String(32))

    requested_branch: Mapped[str] = mapped_column(String(255))
    requested_base_sha: Mapped[str | None] = mapped_column(String(255), nullable=True)
    exclude_paths_json: Mapped[str] = mapped_column(Text, default="[]")
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    failure_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cleanup_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudSandbox(Base):
    __tablename__ = "cloud_sandbox"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    runtime_environment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cloud_runtime_environment.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
    )
    # Compatibility-only during migration away from workspace-owned sandboxes.
    cloud_workspace_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)

    provider: Mapped[str] = mapped_column(String(32))
    external_sandbox_id: Mapped[str | None] = mapped_column(
        String(255),
        unique=True,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32))
    template_version: Mapped[str] = mapped_column(String(64))
    last_provider_event_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_provider_event_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudCredential(Base):
    __tablename__ = "cloud_credential"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    provider: Mapped[str] = mapped_column(String(32))
    auth_mode: Mapped[str] = mapped_column(String(16))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    payload_format: Mapped[str] = mapped_column(String(32), default="json-v1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CloudMcpConnection(Base):
    __tablename__ = "cloud_mcp_connection"
    __table_args__ = (
        UniqueConstraint("user_id", "connection_id"),
        CheckConstraint("user_id IS NOT NULL", name="ck_cloud_mcp_connection_v1_user_id"),
        CheckConstraint("org_id IS NULL", name="ck_cloud_mcp_connection_v1_org_id_null"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(index=True, nullable=True)
    connection_id: Mapped[str] = mapped_column(String(255))
    catalog_entry_id: Mapped[str] = mapped_column(String(255))
    catalog_entry_version: Mapped[int] = mapped_column(Integer, default=1)
    server_name: Mapped[str] = mapped_column(String(255), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    settings_json: Mapped[str] = mapped_column(Text, default="{}")
    config_version: Mapped[int] = mapped_column(Integer, default=1)
    # Legacy replica payload. New clients store auth in CloudMcpConnectionAuth.
    payload_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_format: Mapped[str] = mapped_column(String(32), default="json-v1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CloudMcpConnectionAuth(Base):
    __tablename__ = "cloud_mcp_connection_auth"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    connection_db_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_mcp_connection.id", ondelete="CASCADE"),
        index=True,
        unique=True,
    )
    auth_kind: Mapped[str] = mapped_column(String(32))
    auth_status: Mapped[str] = mapped_column(String(32))
    payload_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_format: Mapped[str] = mapped_column(String(64), default="json-v1")
    auth_version: Mapped[int] = mapped_column(Integer, default=1)
    token_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudMcpOAuthFlow(Base):
    __tablename__ = "cloud_mcp_oauth_flow"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    connection_db_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_mcp_connection.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    state_hash: Mapped[str] = mapped_column(String(128), index=True)
    code_verifier_ciphertext: Mapped[str] = mapped_column(Text)
    issuer: Mapped[str | None] = mapped_column(Text, nullable=True)
    resource: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_id: Mapped[str] = mapped_column(String(512))
    token_endpoint: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_scopes: Mapped[str] = mapped_column(Text, default="[]")
    redirect_uri: Mapped[str] = mapped_column(Text)
    authorization_url: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudMcpOAuthClient(Base):
    __tablename__ = "cloud_mcp_oauth_client"
    __table_args__ = (UniqueConstraint("issuer", "redirect_uri", "catalog_entry_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    issuer: Mapped[str] = mapped_column(Text)
    redirect_uri: Mapped[str] = mapped_column(Text)
    catalog_entry_id: Mapped[str] = mapped_column(String(255))
    resource: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_id: Mapped[str] = mapped_column(String(512))
    client_secret_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_secret_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    token_endpoint_auth_method: Mapped[str | None] = mapped_column(String(128), nullable=True)
    registration_client_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    registration_access_token_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudRepoConfig(Base):
    __tablename__ = "cloud_repo_config"
    __table_args__ = (UniqueConstraint("user_id", "git_owner", "git_repo_name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(index=True)
    git_owner: Mapped[str] = mapped_column(String(255))
    git_repo_name: Mapped[str] = mapped_column(String(255))
    configured: Mapped[bool] = mapped_column(default=False)
    configured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    default_branch: Mapped[str | None] = mapped_column(String(255), nullable=True)
    env_vars_ciphertext: Mapped[str] = mapped_column(Text, default="")
    env_vars_version: Mapped[int] = mapped_column(Integer, default=0)
    setup_script: Mapped[str] = mapped_column(Text, default="")
    setup_script_version: Mapped[int] = mapped_column(Integer, default=0)
    run_command: Mapped[str] = mapped_column(Text, default="")
    files_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class CloudRepoFile(Base):
    __tablename__ = "cloud_repo_file"
    __table_args__ = (UniqueConstraint("cloud_repo_config_id", "relative_path"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    cloud_repo_config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("cloud_repo_config.id", ondelete="CASCADE"),
        index=True,
    )
    relative_path: Mapped[str] = mapped_column(String(1024))
    content_ciphertext: Mapped[str] = mapped_column(Text)
    content_sha256: Mapped[str] = mapped_column(String(64))
    byte_size: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
