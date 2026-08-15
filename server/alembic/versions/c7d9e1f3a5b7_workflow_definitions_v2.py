"""Admit schema_version 2 workflow definitions and invocations.

Gen-2 workflow definitions store their whole document in one
``definition_json`` blob (nodes, edges, inputs, docTemplates) instead of the
v1 ``inputs_json``/``stages_json`` split, and gen-2 invocations freeze a
placement-carrying snapshot. Both tables' schema-version checks widen to
``IN (1, 2)``; v1 rows are untouched and keep validating until PR7.

Revision ID: c7d9e1f3a5b7
Revises: b5d7f9a1c3e5
Create Date: 2026-08-14 01:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c7d9e1f3a5b7"
down_revision: str | None = "da8a01b4ad7a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "workflow_definition",
        sa.Column(
            "definition_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.drop_constraint(
        "ck_workflow_definition_schema_version",
        "workflow_definition",
        type_="check",
    )
    op.create_check_constraint(
        "ck_workflow_definition_schema_version",
        "workflow_definition",
        "schema_version IN (1, 2)",
    )
    op.drop_constraint(
        "ck_workflow_invocation_schema_version",
        "workflow_invocation",
        type_="check",
    )
    op.create_check_constraint(
        "ck_workflow_invocation_schema_version",
        "workflow_invocation",
        "schema_version IN (1, 2)",
    )
    # Ruling A: a v2 definition's defaultRepoConfigId lives in the RUNTIME
    # repo-root id space, so the CP cannot resolve it — an FK into repo_config
    # is exactly that resolution, enforced by Postgres. v1 rows keep their
    # creation-time ownership check at the service layer, and repo_config is
    # soft-delete-only, so the FK's ON DELETE SET NULL never fired in practice.
    op.drop_constraint(
        "workflow_definition_default_repo_config_id_fkey",
        "workflow_definition",
        type_="foreignkey",
    )


def downgrade() -> None:
    # Pre-v2 code cannot read schema_version 2 rows (its response models pin
    # Literal[1]), and the narrow CHECKs below cannot be recreated over them.
    # Deleting v2 rows on downgrade is sanctioned: the feature ships dark
    # (flag-off beta), so these rows only exist where someone exercised v2
    # deliberately. Invocations go first — they reference definitions.
    op.execute(sa.text("DELETE FROM workflow_invocation WHERE schema_version = 2"))
    op.execute(sa.text("DELETE FROM workflow_definition WHERE schema_version = 2"))
    # Safe once v2 rows are gone: surviving v1 rows only ever stored ids the
    # service layer resolved against repo_config at write time.
    op.create_foreign_key(
        "workflow_definition_default_repo_config_id_fkey",
        "workflow_definition",
        "repo_config",
        ["default_repo_config_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.drop_constraint(
        "ck_workflow_invocation_schema_version",
        "workflow_invocation",
        type_="check",
    )
    op.create_check_constraint(
        "ck_workflow_invocation_schema_version",
        "workflow_invocation",
        "schema_version = 1",
    )
    op.drop_constraint(
        "ck_workflow_definition_schema_version",
        "workflow_definition",
        type_="check",
    )
    op.create_check_constraint(
        "ck_workflow_definition_schema_version",
        "workflow_definition",
        "schema_version = 1",
    )
    op.drop_column("workflow_definition", "definition_json")
