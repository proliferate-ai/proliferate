"""cloud target anyharness bearer

Adds ``anyharness_bearer_token_ciphertext`` to ``cloud_targets``: the
per-runtime AnyHarness bearer minted at enrollment (ssh/personal-target
design §3.3), stored as recoverable Fernet ciphertext keyed by the cloud
secret key — the same pattern as ``cloud_sandbox.runtime_token_ciphertext``,
because both the Desktop direct-attach path and re-installs need the
plaintext back.

Revision ID: d4c5b6a79801
Revises: b8c9d0e1f2a3
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d4c5b6a79801"
down_revision: str | Sequence[str] | None = "b8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "cloud_targets"
_COLUMN = "anyharness_bearer_token_ciphertext"


def upgrade() -> None:
    op.add_column(_TABLE, sa.Column(_COLUMN, sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column(_TABLE, _COLUMN)
