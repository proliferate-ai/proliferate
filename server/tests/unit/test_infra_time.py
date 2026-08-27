from __future__ import annotations

import importlib
import pkgutil
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa

import proliferate.lib.infra.time.elapsed as elapsed
import proliferate.lib.infra.time.wall_clock as wall_clock
import proliferate.db.models as orm_models
from proliferate.db.models.base import Base


def _split_datetime_default_owners(
    metadata: sa.MetaData,
) -> tuple[list[tuple[str, str, str]], list[tuple[str, str, str]]]:
    wall_clock_references: list[tuple[str, str, str]] = []
    other_references: list[tuple[str, str, str]] = []

    for table in metadata.tables.values():
        for column in table.columns:
            if not isinstance(column.type, sa.DateTime):
                continue
            for attribute in ("default", "onupdate"):
                default = getattr(column, attribute)
                if default is None:
                    continue
                reference = (table.name, column.name, attribute)
                if getattr(default.arg, "__wrapped__", None) is wall_clock.utcnow:
                    wall_clock_references.append(reference)
                else:
                    other_references.append(reference)

    return wall_clock_references, other_references


def _import_all_orm_models() -> None:
    for module in pkgutil.walk_packages(orm_models.__path__, f"{orm_models.__name__}."):
        importlib.import_module(module.name)


def test_utcnow_reads_utc_wall_clock_once(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = datetime(2026, 8, 5, 12, 34, 56, 789012, tzinfo=UTC)
    observed_timezones: list[object] = []

    class FakeDateTime:
        @classmethod
        def now(cls, timezone: object) -> datetime:
            observed_timezones.append(timezone)
            return expected

    monkeypatch.setattr(wall_clock, "datetime", FakeDateTime)

    assert wall_clock.utcnow() is expected
    assert observed_timezones == [UTC]


def test_every_migrated_orm_wall_clock_default_remains_a_deferred_owner_reference() -> None:
    # This slice owns utcnow and duration_ms only; independently owned local
    # clocks and direct timestamp calculations are deliberately out of scope.
    _import_all_orm_models()

    wall_clock_references, other_references = _split_datetime_default_owners(Base.metadata)

    lifecycle_references = {
        ("cloud_integration_definition_security_revision", "created_at", "default"),
        ("cloud_integration_authorization_attempt", "created_at", "default"),
        ("cloud_integration_authorization_attempt", "updated_at", "default"),
        ("cloud_integration_authorization_attempt", "updated_at", "onupdate"),
        ("cloud_integration_revocation_job", "created_at", "default"),
        ("cloud_integration_revocation_job", "updated_at", "default"),
    }
    assert lifecycle_references.issubset(wall_clock_references)
    # agent_auth delivery governance (spec §2 "How delivery is governed"): the
    # render-sequence row's three timestamps plus its updated_at onupdate. All
    # four are deferred owner references (`default=utcnow`, never `utcnow()`),
    # so the rendered_at the audit trail reads is the wall clock at write time.
    render_sequence_references = {
        ("agent_auth_render_sequence", "rendered_at", "default"),
        ("agent_auth_render_sequence", "created_at", "default"),
        ("agent_auth_render_sequence", "updated_at", "default"),
        ("agent_auth_render_sequence", "updated_at", "onupdate"),
    }
    assert render_sequence_references.issubset(wall_clock_references)
    # +1 (176): agent_auth slice 4 adds seat_usage_sample.sampled_at.
    assert len(wall_clock_references) == 176
    assert other_references == [
        ("cloud_integration_revocation_job", "updated_at", "onupdate"),
    ]


def test_orm_wall_clock_guard_rejects_an_eager_timestamp_mutation() -> None:
    metadata = sa.MetaData()
    sa.Table(
        "eager_wall_clock_default",
        metadata,
        sa.Column("created_at", sa.DateTime(timezone=True), default=wall_clock.utcnow()),
    )

    wall_clock_references, other_references = _split_datetime_default_owners(metadata)

    assert wall_clock_references == []
    assert other_references == [("eager_wall_clock_default", "created_at", "default")]


@pytest.mark.parametrize(
    ("sample", "started_at", "expected"),
    [
        (12.3456, 10.0, 2345),
        (9.9981, 10.0, -1),
    ],
)
def test_duration_ms_samples_once_and_truncates_toward_zero(
    monkeypatch: pytest.MonkeyPatch,
    sample: float,
    started_at: float,
    expected: int,
) -> None:
    samples = iter([sample])
    monkeypatch.setattr(elapsed.time, "perf_counter", lambda: next(samples))

    assert elapsed.duration_ms(started_at) == expected
    with pytest.raises(StopIteration):
        next(samples)
