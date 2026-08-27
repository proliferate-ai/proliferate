"""agent_auth seats v1: the anthropic_subscription vault kind + the seat source

Slice 1 of the seat plan (delivery-spec-slice-1-mint-and-run): a Claude Max
login becomes a portable credential in the vault, wired by ``seat`` selection
rows.

- ``agent_api_key.kind`` CHECK gains ``'anthropic_subscription'`` (agent_auth
  spec §2 "The vault": a seat decrypts to one opaque secret string — a
  long-lived ``claude setup-token`` credential).
- ``agent_auth_selection.source_kind`` CHECK gains ``'seat'``. A seat row with
  ``api_key_id`` NULL means "use my seat pool" (the renderer expands it, vault
  order); a non-null id pins one seat.
- New CHECK ``ck_agent_auth_selection_seat_shape``: a seat row never names an
  ``env_var_name`` (the seat recipe owns its env mapping). That the referenced
  entry is an ``anthropic_subscription`` row is the store write gate's job — a
  CHECK cannot join ``agent_api_key`` to see the kind.

Downgrade recreates the old structure: rows carrying the new vocabulary are
deleted first (data preservation is not a constraint; a seat row cannot exist
under the pre-seat CHECKs), then the constraints are rebuilt to their prior
definitions, keeping the head-to-history downgrade walk traversable.

Revision ID: d9e4b7a2c6f1
Revises: b3d5f7a9c1e3
Create Date: 2026-08-26 21:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "d9e4b7a2c6f1"
down_revision: str | Sequence[str] | None = "b3d5f7a9c1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KEY_TABLE = "agent_api_key"
_KEY_KIND_CONSTRAINT = "ck_agent_api_key_kind"
_SELECTION_TABLE = "agent_auth_selection"
_SOURCE_KIND_CONSTRAINT = "ck_agent_auth_selection_source_kind"
_SEAT_SHAPE_CONSTRAINT = "ck_agent_auth_selection_seat_shape"

_OLD_KEY_KINDS = "kind IN ('api_key', 'aws_bedrock', 'azure_openai')"
_NEW_KEY_KINDS = "kind IN ('api_key', 'aws_bedrock', 'azure_openai', 'anthropic_subscription')"
_OLD_SOURCE_KINDS = "source_kind IN ('gateway', 'api_key')"
_NEW_SOURCE_KINDS = "source_kind IN ('gateway', 'api_key', 'seat')"
_SEAT_SHAPE = "source_kind != 'seat' OR env_var_name IS NULL"


def upgrade() -> None:
    op.drop_constraint(_KEY_KIND_CONSTRAINT, _KEY_TABLE, type_="check")
    op.create_check_constraint(_KEY_KIND_CONSTRAINT, _KEY_TABLE, _NEW_KEY_KINDS)

    op.drop_constraint(_SOURCE_KIND_CONSTRAINT, _SELECTION_TABLE, type_="check")
    op.create_check_constraint(_SOURCE_KIND_CONSTRAINT, _SELECTION_TABLE, _NEW_SOURCE_KINDS)
    op.create_check_constraint(_SEAT_SHAPE_CONSTRAINT, _SELECTION_TABLE, _SEAT_SHAPE)


def downgrade() -> None:
    # Rows carrying the new vocabulary cannot exist under the old CHECKs.
    # Selection rows referencing a seat vault entry ride the api_key_id
    # ON DELETE CASCADE; the explicit seat-row delete covers pool rows
    # (api_key_id NULL) and any pin whose entry survives.
    op.execute("DELETE FROM agent_auth_selection WHERE source_kind = 'seat'")
    op.execute("DELETE FROM agent_api_key WHERE kind = 'anthropic_subscription'")

    op.drop_constraint(_SEAT_SHAPE_CONSTRAINT, _SELECTION_TABLE, type_="check")
    op.drop_constraint(_SOURCE_KIND_CONSTRAINT, _SELECTION_TABLE, type_="check")
    op.create_check_constraint(_SOURCE_KIND_CONSTRAINT, _SELECTION_TABLE, _OLD_SOURCE_KINDS)

    op.drop_constraint(_KEY_KIND_CONSTRAINT, _KEY_TABLE, type_="check")
    op.create_check_constraint(_KEY_KIND_CONSTRAINT, _KEY_TABLE, _OLD_KEY_KINDS)
