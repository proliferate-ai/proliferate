"""Integration tests for the control-plane gateway verification loop (FR-3).

Covers ``proliferate.server.agent_auth.verification.run_verification``
against a real Postgres session and a fake ``list_models``: the expected-set
diff verdicts (ok / missing / extra), the config-unavailable degraded fallback,
error-means-no-overwrite, key-material redaction, and the worker's flag gating.
"""

from __future__ import annotations

import logging
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED,
    AGENT_GATEWAY_VERIFICATION_STATUS_OK,
)
from proliferate.db.models.auth import User
from proliferate.db.models.organizations import Organization
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from proliferate.integrations import litellm
from proliferate.server.agent_auth import verification
from proliferate.server.agent_auth.worker import start_agent_gateway_verification


async def _create_enrollment(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"verify-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    organization = Organization(name=f"Verify Org {uuid.uuid4().hex[:6]}")
    db_session.add(organization)
    await db_session.flush()
    subject = await ensure_organization_billing_subject(db_session, organization.id)
    enrollment = await store.ensure_enrollment_row(
        db_session,
        billing_subject_id=subject.id,
        organization_id=organization.id,
        user_id=user.id,
    )
    return enrollment.id


async def _mint_key(
    db_session: AsyncSession, enrollment_id: uuid.UUID, harness_kind: str
) -> uuid.UUID:
    record = await store.upsert_enrollment_key(
        db_session,
        enrollment_id=enrollment_id,
        harness_kind=harness_kind,
        virtual_key_id=f"token-{harness_kind}",
        virtual_key=f"sk-litellm-{harness_kind}",
        sync_fingerprint="fp",
    )
    return record.id


def _fake_list_models(monkeypatch: pytest.MonkeyPatch, mapping: dict[str, object]) -> None:
    """Answer ``list_models`` from a {virtual_key: result-or-exception} map."""

    async def _list(*, virtual_key: str) -> list[str]:
        result = mapping[virtual_key]
        if isinstance(result, Exception):
            raise result
        return list(result)  # type: ignore[arg-type]

    monkeypatch.setattr(litellm, "list_models", _list)


def _fake_expected(monkeypatch: pytest.MonkeyPatch, expected: dict[str, set[str]] | None) -> None:
    """Pin the expected access-group map so verdicts don't depend on config.yaml."""
    monkeypatch.setattr(verification, "load_expected_access_groups", lambda: expected)


@pytest.mark.asyncio
async def test_matching_model_set_records_ok(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    key_id = await _mint_key(db_session, enrollment_id, "claude")
    _fake_expected(monkeypatch, {"claude": {"claude-sonnet", "claude-opus"}})
    # Order-insensitive: observed matches the expected set exactly.
    _fake_list_models(monkeypatch, {"sk-litellm-claude": ["claude-opus", "claude-sonnet"]})

    result = await verification.run_verification(db_session)

    assert result.checked == 1
    assert result.ok == 1
    keys = await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id)
    verdict = next(k for k in keys if k.id == key_id)
    assert verdict.verification_status == AGENT_GATEWAY_VERIFICATION_STATUS_OK
    assert verdict.verification_delta is None
    assert verdict.verified_at is not None


@pytest.mark.asyncio
async def test_missing_model_records_misconfigured_with_missing_delta(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    key_id = await _mint_key(db_session, enrollment_id, "claude")
    _fake_expected(monkeypatch, {"claude": {"claude-sonnet", "claude-opus"}})
    _fake_list_models(monkeypatch, {"sk-litellm-claude": ["claude-sonnet"]})

    result = await verification.run_verification(db_session)

    assert result.misconfigured == 1
    keys = await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id)
    verdict = next(k for k in keys if k.id == key_id)
    assert verdict.verification_status == AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED
    assert verdict.verification_delta is not None
    assert "claude-opus" in verdict.verification_delta
    assert '"missing"' in verdict.verification_delta


@pytest.mark.asyncio
async def test_extra_model_records_misconfigured_with_extra_delta(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    key_id = await _mint_key(db_session, enrollment_id, "codex")
    _fake_expected(monkeypatch, {"codex": {"gpt-5"}})
    _fake_list_models(monkeypatch, {"sk-litellm-codex": ["gpt-5", "gpt-forbidden"]})

    result = await verification.run_verification(db_session)

    assert result.misconfigured == 1
    keys = await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id)
    verdict = next(k for k in keys if k.id == key_id)
    assert verdict.verification_status == AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED
    assert verdict.verification_delta is not None
    assert "gpt-forbidden" in verdict.verification_delta
    assert '"extra"' in verdict.verification_delta


@pytest.mark.asyncio
async def test_config_unavailable_degrades_nonempty_to_ok(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    key_id = await _mint_key(db_session, enrollment_id, "grok")
    # No expected set to diff against: a non-empty list is the best we can say.
    _fake_expected(monkeypatch, None)
    _fake_list_models(monkeypatch, {"sk-litellm-grok": ["grok-2"]})

    result = await verification.run_verification(db_session)

    assert result.ok == 1
    keys = await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id)
    verdict = next(k for k in keys if k.id == key_id)
    assert verdict.verification_status == AGENT_GATEWAY_VERIFICATION_STATUS_OK
    assert verdict.verification_delta is not None
    assert "config_unavailable" in verdict.verification_delta


@pytest.mark.asyncio
async def test_config_unavailable_still_flags_empty_list(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    key_id = await _mint_key(db_session, enrollment_id, "grok")
    _fake_expected(monkeypatch, None)
    _fake_list_models(monkeypatch, {"sk-litellm-grok": []})

    result = await verification.run_verification(db_session)

    assert result.misconfigured == 1
    keys = await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id)
    verdict = next(k for k in keys if k.id == key_id)
    assert verdict.verification_status == AGENT_GATEWAY_VERIFICATION_STATUS_MISCONFIGURED
    assert verdict.verification_delta is not None
    assert "empty_model_list" in verdict.verification_delta


@pytest.mark.asyncio
async def test_error_does_not_overwrite_a_prior_verdict(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    key_id = await _mint_key(db_session, enrollment_id, "grok")
    _fake_expected(monkeypatch, {"grok": {"grok-2"}})

    # First tick records ok.
    _fake_list_models(monkeypatch, {"sk-litellm-grok": ["grok-2"]})
    await verification.run_verification(db_session)

    # Second tick errors: the ok verdict must survive.
    _fake_list_models(
        monkeypatch,
        {"sk-litellm-grok": litellm.LiteLLMIntegrationError("boom", "transient")},
    )
    result = await verification.run_verification(db_session)

    assert result.errored == 1
    assert result.ok == 0
    keys = await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id)
    verdict = next(k for k in keys if k.id == key_id)
    assert verdict.verification_status == AGENT_GATEWAY_VERIFICATION_STATUS_OK


@pytest.mark.asyncio
async def test_reported_error_redacts_the_virtual_key_everywhere(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    await _mint_key(db_session, enrollment_id, "claude")
    _fake_expected(monkeypatch, {"claude": {"claude-sonnet"}})

    # An error whose message embeds the decrypted virtual key (as a stringified
    # HTTP client error carrying an Authorization header might).
    leaky = RuntimeError("401 from https://gw with header Bearer sk-litellm-claude")
    _fake_list_models(monkeypatch, {"sk-litellm-claude": leaky})

    # Exercise the REAL report_critical logging path (not a stub) by capturing on
    # its own logger ("proliferate.critical" does not propagate). report_critical
    # calls logger.exception, which formats the AMBIENT exception's traceback, so
    # the key must be absent from the message, the exc_info-formatted traceback,
    # AND any chained __context__/__cause__.
    records: list[logging.LogRecord] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    critical_logger = logging.getLogger("proliferate.critical")
    handler = _Capture(level=logging.NOTSET)
    critical_logger.addHandler(handler)
    previous_level = critical_logger.level
    previous_disabled = critical_logger.disabled
    critical_logger.setLevel(logging.NOTSET)
    # An app-side logging config may have set disable_existing_loggers, which marks
    # this named logger .disabled and short-circuits its handle(); re-enable it so
    # the real emit path (the one carrying the exc_info traceback) actually runs.
    critical_logger.disabled = False
    try:
        await verification.run_verification(db_session)
    finally:
        critical_logger.removeHandler(handler)
        critical_logger.setLevel(previous_level)
        critical_logger.disabled = previous_disabled

    critical_records = [r for r in records if "CRITICAL_FAILURE" in r.getMessage()]
    assert critical_records, "an errored key must reach the critical logger"
    for record in critical_records:
        rendered = record.getMessage()
        if record.exc_info is not None:
            rendered += "\n" + logging.Formatter().formatException(record.exc_info)
        assert "sk-litellm-claude" not in rendered, "the virtual key must never be logged"
        assert "[redacted]" in record.getMessage()


@pytest.mark.asyncio
async def test_worker_flag_gating(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "run_background_workers", True)
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)

    # Verification flag off: no task even when the gateway is enabled.
    monkeypatch.setattr(settings, "agent_gateway_verification_enabled", False)
    assert await start_agent_gateway_verification() is None

    # Gateway disabled overrides an enabled verification flag.
    monkeypatch.setattr(settings, "agent_gateway_verification_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    assert await start_agent_gateway_verification() is None
