from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from proliferate.db.models.base import Base, utcnow


class AnonymousTelemetryInstall(Base):
    __tablename__ = "anonymous_telemetry_install"

    install_uuid: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    surface: Mapped[str] = mapped_column(String(32), primary_key=True)
    last_telemetry_mode: Mapped[str] = mapped_column(String(32))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_app_version: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_platform: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_arch: Mapped[str | None] = mapped_column(String(64), nullable=True)


class AnonymousTelemetryEventRecord(Base):
    __tablename__ = "anonymous_telemetry_event"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    install_uuid: Mapped[uuid.UUID] = mapped_column(index=True)
    surface: Mapped[str] = mapped_column(String(32), index=True)
    telemetry_mode: Mapped[str] = mapped_column(String(32))
    record_type: Mapped[str] = mapped_column(String(32))
    payload_json: Mapped[dict[str, object]] = mapped_column(JSONB)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AnonymousTelemetryLocalInstall(Base):
    __tablename__ = "anonymous_telemetry_local_install"

    surface: Mapped[str] = mapped_column(String(32), primary_key=True)
    install_uuid: Mapped[uuid.UUID] = mapped_column(default=uuid.uuid4, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )
