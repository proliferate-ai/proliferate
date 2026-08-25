"""Drop SSO tables.

Removes the tables behind the deleted SSO surface (cull-sweep Track C,
``delivery/cull-sweep/delivery-spec-delete-sso.md``): organization/deployment
SSO connections, in-flight SSO challenges, and SSO-proven identities. SSO is
culled product surface; no data is preserved. Production deploys snapshot the
database before running migrations as a standing deploy-time step — that
snapshot is the only recovery path for these rows.

Revision ID: d7e8f9a0b1c2
Revises: e7a9c2d41f56
Create Date: 2026-08-25 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "d7e8f9a0b1c2"
down_revision: str | None = "e7a9c2d41f56"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DROPPED_TABLES = (
    "sso_challenge",
    "sso_identity",
    "sso_connection",
)


def upgrade() -> None:
    for table in DROPPED_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')


def downgrade() -> None:
    raise NotImplementedError("SSO tables are gone for good.")
