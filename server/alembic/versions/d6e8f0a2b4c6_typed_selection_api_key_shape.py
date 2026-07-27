"""loosen the selection api_key shape CHECK for typed vault entries

Revision ID: d6e8f0a2b4c6
Revises: c2a4e6b8d0f2
Create Date: 2026-07-27 00:00:00.000000

The typed-config write gate (agent-auth.md "The vault" / Current gaps):
a selection may now reference a typed vault entry (``aws_bedrock``,
``azure_openai``), and such a row carries NO ``env_var_name`` — the typed
kind carries its own env mapping. The old
``ck_agent_auth_selection_api_key_shape`` CHECK required
``env_var_name IS NOT NULL`` on every ``api_key`` row, which made a legal
typed selection unstorable.

The replacement keeps everything one table can express:
``api_key_id IS NOT NULL`` stays mandatory for ``api_key`` rows. The tighter
law — ``env_var_name`` present exactly when the referenced vault entry's
``kind`` is the bare ``'api_key'``, absent when it is typed — spans tables
(a CHECK cannot join ``agent_api_key``), so it is enforced in the store's
write gate (``db/store/agent_gateway/selections.py`` ``_assert_keys_usable``),
per the spec's "Shape checks are structural … enforced in the store, since
it spans tables".
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d6e8f0a2b4c6"
down_revision: str | Sequence[str] | None = "c2a4e6b8d0f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_auth_selection"
_CONSTRAINT = "ck_agent_auth_selection_api_key_shape"
_OLD_CHECK = "source_kind != 'api_key' OR (api_key_id IS NOT NULL AND env_var_name IS NOT NULL)"
_NEW_CHECK = "source_kind != 'api_key' OR api_key_id IS NOT NULL"


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(_CONSTRAINT, _TABLE, _NEW_CHECK)


def downgrade() -> None:
    # Re-tightening the CHECK requires removing the rows it would reject:
    # typed-entry selections are exactly the api_key rows without an
    # env_var_name, and closing the write gate again means they cannot exist.
    op.execute(f"DELETE FROM {_TABLE} WHERE source_kind = 'api_key' AND env_var_name IS NULL")
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(_CONSTRAINT, _TABLE, _OLD_CHECK)
