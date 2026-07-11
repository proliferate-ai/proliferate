"""Materialization credential debug/validation/log surface canaries."""

from __future__ import annotations

import logging

import pytest
from pydantic import ValidationError

from proliferate.server.cloud.workflows.contracts.models import MaterializationOffer

_TOKEN = "wfm1.11111111-1111-4111-8111-111111111111.full_secret_canary"


def _raw_offer() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "runId": "22222222-2222-4222-8222-222222222222",
        "planHash": f"sha256:{'a' * 64}",
        "target": "local",
        "executionGeneration": 1,
        "executorId": "desktop-1",
        "executorFence": "claim-1",
        "sourceIntent": {"kind": "local_commit"},
        "materializationCredential": _TOKEN,
        "credentialGeneration": 1,
        "expiresAt": "2026-07-11T01:00:00Z",
    }


def test_offer_wire_carries_secret_but_repr_and_logs_do_not(
    caplog: pytest.LogCaptureFixture,
) -> None:
    offer = MaterializationOffer.model_validate(_raw_offer())
    assert offer.to_wire()["materializationCredential"] == _TOKEN
    assert _TOKEN not in repr(offer)
    with caplog.at_level(logging.WARNING):
        logging.getLogger("workflow.offer.canary").warning("offer=%r", offer)
    assert _TOKEN not in caplog.text


def test_offer_validation_error_and_log_do_not_echo_secret(
    caplog: pytest.LogCaptureFixture,
) -> None:
    raw = _raw_offer()
    raw.pop("runId")
    with pytest.raises(ValidationError) as caught:
        MaterializationOffer.model_validate(raw)
    assert _TOKEN not in str(caught.value)
    assert _TOKEN not in repr(caught.value)
    with caplog.at_level(logging.WARNING):
        logging.getLogger("workflow.offer.validation").warning(
            "invalid offer=%r", caught.value
        )
    assert _TOKEN not in caplog.text
