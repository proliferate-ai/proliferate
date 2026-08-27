"""Agent-auth delivery-governance ORM models (agent_auth spec §2).

Home of the render-sequence row that backs the document's ``sequence`` field
("How delivery is governed"): monotonic per (user, surface), bumped ONLY by a
render whose ``harnesses`` content changed. Lives in its own module rather
than ``agent_gateway.py``, which sits at its recorded line-count ratchet.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base
from proliferate.lib.infra.time.wall_clock import utcnow


class AgentAuthRenderSequence(Base):
    """The current rendered agent-auth document sequence per (user, surface).

    The persisted counter behind the wire document's ``sequence`` (agent_auth
    spec §2): one row per (user, surface), advanced atomically by
    ``bump_render_sequence_if_changed`` exactly when a render's ``harnesses``
    content hash differs from the stored one. A no-op render leaves the row
    untouched, so sequence and fingerprint move together or not at all.
    ``fingerprint`` is the sha256 of the canonical ``harnesses`` array — the
    same value ``GET /state`` serves as its response rider.
    """

    __tablename__ = "agent_auth_render_sequence"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "surface",
            name="uq_agent_auth_render_sequence_scope",
        ),
        CheckConstraint(
            "surface IN ('local', 'cloud')",
            name="ck_agent_auth_render_sequence_surface",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"),
        index=True,
    )
    surface: Mapped[str] = mapped_column(Text)
    # BigInteger for symmetry with agent_auth_delivery_ack.acked_sequence: the
    # ack column predates content-hash sequencing and held ms-epoch values, so
    # the pair must share a type for the applied comparison.
    sequence: Mapped[int] = mapped_column(BigInteger)
    # sha256 hex of the canonical `harnesses` array of the last render that
    # moved this row — the change detector the bump upsert compares against.
    fingerprint: Mapped[str] = mapped_column(Text)
    rendered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
