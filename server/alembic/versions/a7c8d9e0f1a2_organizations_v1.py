"""organizations v1

Revision ID: a7c8d9e0f1a2
Revises: f6a7b8c9d0e1
Create Date: 2026-04-30 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c8d9e0f1a2"
down_revision: str | Sequence[str] | None = "f6a7b8c9d0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _has_check_constraint(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_check_constraints(table_name)
    }


def _has_unique_constraint(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return constraint_name in {
        constraint["name"] for constraint in inspector.get_unique_constraints(table_name)
    }


def _create_index_once(
    index_name: str,
    table_name: str,
    columns: list[str],
    *,
    unique: bool = False,
    postgresql_where: sa.TextClause | None = None,
) -> None:
    if not _has_index(table_name, index_name):
        op.create_index(
            index_name,
            table_name,
            columns,
            unique=unique,
            postgresql_where=postgresql_where,
        )


def _create_check_once(table_name: str, constraint_name: str, condition: str) -> None:
    if not _has_check_constraint(table_name, constraint_name):
        op.create_check_constraint(constraint_name, table_name, condition)


def _drop_check_once(table_name: str, constraint_name: str) -> None:
    if _has_check_constraint(table_name, constraint_name):
        op.drop_constraint(constraint_name, table_name, type_="check")


def upgrade() -> None:
    """Upgrade schema."""
    if not _has_table("organization"):
        op.create_table(
            "organization",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("logo_domain", sa.String(length=255), nullable=True),
            sa.Column("logo_image", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _has_column("organization", "logo_image"):
        op.add_column("organization", sa.Column("logo_image", sa.Text(), nullable=True))

    if not _has_table("organization_membership"):
        op.create_table(
            "organization_membership",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("role", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "organization_id",
                "user_id",
                name="uq_organization_membership_org_user",
            ),
        )
    _create_index_once(
        "ix_organization_membership_organization_id",
        "organization_membership",
        ["organization_id"],
    )
    _create_index_once("ix_organization_membership_user_id", "organization_membership", ["user_id"])
    _create_index_once(
        "ix_organization_membership_status",
        "organization_membership",
        ["status"],
    )
    _create_check_once(
        "organization_membership",
        "ck_organization_membership_role",
        "role IN ('owner', 'admin', 'member')",
    )
    _create_check_once(
        "organization_membership",
        "ck_organization_membership_status",
        "status IN ('active', 'removed')",
    )
    if not _has_unique_constraint(
        "organization_membership",
        "uq_organization_membership_org_user",
    ):
        op.create_unique_constraint(
            "uq_organization_membership_org_user",
            "organization_membership",
            ["organization_id", "user_id"],
        )

    if not _has_table("organization_invitation"):
        op.create_table(
            "organization_invitation",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("organization_id", sa.Uuid(), nullable=False),
            sa.Column("email", sa.String(length=320), nullable=False),
            sa.Column("role", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("handoff_token_hash", sa.String(length=64), nullable=True),
            sa.Column("handoff_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("delivery_status", sa.String(length=32), nullable=False),
            sa.Column("delivery_error", sa.Text(), nullable=True),
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("invited_by_user_id", sa.Uuid(), nullable=False),
            sa.Column("accepted_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["organization_id"], ["organization.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["invited_by_user_id"], ["user.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["accepted_by_user_id"], ["user.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index_once(
        "ix_organization_invitation_organization_id",
        "organization_invitation",
        ["organization_id"],
    )
    _create_index_once("ix_organization_invitation_email", "organization_invitation", ["email"])
    _create_index_once("ix_organization_invitation_status", "organization_invitation", ["status"])
    _create_index_once(
        "ix_organization_invitation_invited_by_user_id",
        "organization_invitation",
        ["invited_by_user_id"],
    )
    _create_index_once(
        "ix_organization_invitation_accepted_by_user_id",
        "organization_invitation",
        ["accepted_by_user_id"],
    )
    _create_index_once(
        "ix_organization_invitation_expires_at",
        "organization_invitation",
        ["expires_at"],
    )
    _create_index_once(
        "uq_organization_invitation_pending_email",
        "organization_invitation",
        ["organization_id", "email"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )
    _create_index_once(
        "ix_organization_invitation_token_hash",
        "organization_invitation",
        ["token_hash"],
        unique=True,
    )
    _create_index_once(
        "ix_organization_invitation_handoff_token_hash",
        "organization_invitation",
        ["handoff_token_hash"],
        unique=True,
        postgresql_where=sa.text("handoff_token_hash IS NOT NULL"),
    )
    _create_check_once(
        "organization_invitation",
        "ck_organization_invitation_role",
        "role IN ('owner', 'admin', 'member')",
    )
    _create_check_once(
        "organization_invitation",
        "ck_organization_invitation_status",
        "status IN ('pending', 'accepted', 'revoked', 'expired')",
    )
    _create_check_once(
        "organization_invitation",
        "ck_organization_invitation_delivery_status",
        "delivery_status IN ('pending', 'sent', 'failed', 'skipped')",
    )

    _create_check_once(
        "billing_subject",
        "ck_billing_subject_personal_owner",
        "kind != 'personal' OR (user_id IS NOT NULL AND organization_id IS NULL)",
    )
    _create_check_once(
        "billing_subject",
        "ck_billing_subject_organization_owner",
        "kind != 'organization' OR (organization_id IS NOT NULL AND user_id IS NULL)",
    )
    _create_index_once(
        "uq_billing_subject_organization_id",
        "billing_subject",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'organization' AND organization_id IS NOT NULL"),
    )

    op.alter_column("billing_grant", "user_id", nullable=True)
    op.alter_column("billing_entitlement", "user_id", nullable=True)

    if not _has_column("cloud_workspace", "owner_scope"):
        op.add_column(
            "cloud_workspace",
            sa.Column(
                "owner_scope",
                sa.String(length=32),
                nullable=True,
                server_default="personal",
            ),
        )
    if not _has_column("cloud_workspace", "owner_user_id"):
        op.add_column("cloud_workspace", sa.Column("owner_user_id", sa.Uuid(), nullable=True))
    if not _has_column("cloud_workspace", "organization_id"):
        op.add_column("cloud_workspace", sa.Column("organization_id", sa.Uuid(), nullable=True))
    if not _has_column("cloud_workspace", "created_by_user_id"):
        op.add_column(
            "cloud_workspace",
            sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        )

    op.execute(
        """
        UPDATE cloud_workspace
        SET
            owner_scope = COALESCE(owner_scope, 'personal'),
            owner_user_id = COALESCE(owner_user_id, user_id),
            organization_id = NULL,
            created_by_user_id = COALESCE(created_by_user_id, user_id)
        WHERE owner_scope IS NULL
           OR owner_user_id IS NULL
           OR created_by_user_id IS NULL
        """
    )
    op.alter_column("cloud_workspace", "owner_scope", nullable=False)
    op.alter_column("cloud_workspace", "created_by_user_id", nullable=False)
    _create_index_once("ix_cloud_workspace_owner_user_id", "cloud_workspace", ["owner_user_id"])
    _create_index_once("ix_cloud_workspace_organization_id", "cloud_workspace", ["organization_id"])
    _create_index_once(
        "ix_cloud_workspace_created_by_user_id",
        "cloud_workspace",
        ["created_by_user_id"],
    )
    _create_check_once(
        "cloud_workspace",
        "ck_cloud_workspace_owner_scope",
        "owner_scope IN ('personal', 'organization')",
    )
    _create_check_once(
        "cloud_workspace",
        "ck_cloud_workspace_personal_owner",
        "owner_scope != 'personal' OR (owner_user_id IS NOT NULL AND organization_id IS NULL)",
    )
    _create_check_once(
        "cloud_workspace",
        "ck_cloud_workspace_organization_owner",
        "owner_scope != 'organization' OR "
        "(organization_id IS NOT NULL AND owner_user_id IS NULL)",
    )
    _create_check_once(
        "cloud_workspace",
        "ck_cloud_workspace_created_by_user_id",
        "created_by_user_id IS NOT NULL",
    )

    _drop_check_once(
        "cloud_runtime_environment",
        "ck_cloud_runtime_environment_v1_org_id_null",
    )
    _create_index_once(
        "uq_cloud_runtime_environment_org_repo_policy",
        "cloud_runtime_environment",
        [
            "organization_id",
            "git_provider",
            "git_owner_norm",
            "git_repo_name_norm",
            "isolation_policy",
        ],
        unique=True,
        postgresql_where=sa.text("organization_id IS NOT NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    if _has_index("cloud_runtime_environment", "uq_cloud_runtime_environment_org_repo_policy"):
        op.drop_index(
            "uq_cloud_runtime_environment_org_repo_policy",
            table_name="cloud_runtime_environment",
        )
    _create_check_once(
        "cloud_runtime_environment",
        "ck_cloud_runtime_environment_v1_org_id_null",
        "organization_id IS NULL",
    )

    for constraint_name in (
        "ck_cloud_workspace_created_by_user_id",
        "ck_cloud_workspace_organization_owner",
        "ck_cloud_workspace_personal_owner",
        "ck_cloud_workspace_owner_scope",
    ):
        _drop_check_once("cloud_workspace", constraint_name)
    for index_name in (
        "ix_cloud_workspace_created_by_user_id",
        "ix_cloud_workspace_organization_id",
        "ix_cloud_workspace_owner_user_id",
    ):
        if _has_index("cloud_workspace", index_name):
            op.drop_index(index_name, table_name="cloud_workspace")
    for column_name in (
        "created_by_user_id",
        "organization_id",
        "owner_user_id",
        "owner_scope",
    ):
        if _has_column("cloud_workspace", column_name):
            op.drop_column("cloud_workspace", column_name)

    op.alter_column("billing_entitlement", "user_id", nullable=False)
    op.alter_column("billing_grant", "user_id", nullable=False)
    if _has_index("billing_subject", "uq_billing_subject_organization_id"):
        op.drop_index("uq_billing_subject_organization_id", table_name="billing_subject")
    _drop_check_once("billing_subject", "ck_billing_subject_organization_owner")
    _drop_check_once("billing_subject", "ck_billing_subject_personal_owner")

    for constraint_name in (
        "ck_organization_invitation_delivery_status",
        "ck_organization_invitation_status",
        "ck_organization_invitation_role",
    ):
        _drop_check_once("organization_invitation", constraint_name)
    for index_name in (
        "ix_organization_invitation_handoff_token_hash",
        "ix_organization_invitation_token_hash",
        "uq_organization_invitation_pending_email",
        "ix_organization_invitation_expires_at",
        "ix_organization_invitation_accepted_by_user_id",
        "ix_organization_invitation_invited_by_user_id",
        "ix_organization_invitation_status",
        "ix_organization_invitation_email",
        "ix_organization_invitation_organization_id",
    ):
        if _has_index("organization_invitation", index_name):
            op.drop_index(index_name, table_name="organization_invitation")
    if _has_table("organization_invitation"):
        op.drop_table("organization_invitation")

    _drop_check_once("organization_membership", "ck_organization_membership_status")
    _drop_check_once("organization_membership", "ck_organization_membership_role")
    for index_name in (
        "ix_organization_membership_status",
        "ix_organization_membership_user_id",
        "ix_organization_membership_organization_id",
    ):
        if _has_index("organization_membership", index_name):
            op.drop_index(index_name, table_name="organization_membership")
    if _has_table("organization_membership"):
        op.drop_table("organization_membership")

    if _has_table("organization"):
        op.drop_table("organization")
