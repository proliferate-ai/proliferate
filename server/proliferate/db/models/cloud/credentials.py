"""Cloud credential ORM models."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


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
