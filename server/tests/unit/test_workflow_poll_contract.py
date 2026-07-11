"""Poll-contract parsing + item-data schema validation (PR B, spec 4.2)."""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest
from pydantic import ValidationError

from proliferate.server.cloud.workflows.domain.poll_contract import (
    PollPage,
    validate_item_data,
)


# --- contract parse -------------------------------------------------------------


def test_poll_page_parses_good_page() -> None:
    page = PollPage.model_validate(
        {
            "items": [
                {
                    "id": "iss_abc123",
                    "kind": "issue.new",
                    "occurred_at": "2026-07-06T00:00:00Z",
                    "data": {"n": 1, "title": "hello"},
                }
            ],
            "cursor": "eyJsYXN0X2lkIjo",
            "has_more": True,
        }
    )
    assert len(page.items) == 1
    assert page.items[0].id == "iss_abc123"
    assert page.items[0].data == {"n": 1, "title": "hello"}
    assert page.cursor == "eyJsYXN0X2lkIjo"
    assert page.has_more is True


def test_poll_page_defaults_are_lenient() -> None:
    """Empty page + missing cursor/has_more parse to empty/None/False."""
    page = PollPage.model_validate({"items": []})
    assert page.items == []
    assert page.cursor is None
    assert page.has_more is False


def test_poll_page_item_without_id_is_rejected() -> None:
    with pytest.raises(ValidationError):
        PollPage.model_validate({"items": [{"kind": "x", "data": {}}]})


def test_poll_page_item_with_empty_id_is_rejected() -> None:
    with pytest.raises(ValidationError):
        PollPage.model_validate({"items": [{"id": "", "data": {}}]})


def test_poll_page_items_not_a_list_is_rejected() -> None:
    with pytest.raises(ValidationError):
        PollPage.model_validate({"items": "nope"})


def test_poll_page_ignores_unknown_top_level_fields() -> None:
    page = PollPage.model_validate({"items": [], "cursor": "c", "extra": 1})
    assert page.cursor == "c"


def test_poll_config_rejects_server_owned_query_fields() -> None:
    from proliferate.server.cloud.errors import CloudApiError
    from proliferate.server.cloud.workflows.models import TriggerPollRequest
    from proliferate.server.cloud.workflows.triggers import _validate_poll_config

    request = TriggerPollRequest.model_validate(
        {"url": "https://issues.example/feed?cursor=forged", "intervalSecs": 60}
    )
    with pytest.raises(CloudApiError) as exc:
        _validate_poll_config(request, is_update=False)
    assert exc.value.code == "invalid_poll_config"


async def test_transport_rejects_legacy_reserved_query_before_client() -> None:
    from proliferate.integrations.workflow_poll import (
        PollEndpointMismatchError,
        fetch_poll_bytes,
    )
    from proliferate.server.cloud.net_guard import VettedEndpoint

    endpoint = VettedEndpoint("https", "issues.example", None, "93.184.216.34")
    with (
        patch.object(httpx, "AsyncClient") as client,
        pytest.raises(PollEndpointMismatchError),
    ):
        await fetch_poll_bytes(
            url="https://issues.example/feed?limit=999",
            endpoint=endpoint,
            auth=None,
            cursor=None,
            limit=50,
        )
    client.assert_not_called()


# --- item-data schema validation ------------------------------------------------

_SCHEMA = {
    "required": ["n", "title"],
    "properties": {"n": {"type": "number"}, "title": {"type": "string"}},
}


def test_validate_item_data_accepts_conforming() -> None:
    assert validate_item_data({"n": 3, "title": "ok"}, _SCHEMA) is None


def test_validate_item_data_none_schema_accepts_anything() -> None:
    assert validate_item_data({"whatever": True}, None) is None
    assert validate_item_data({"whatever": True}, {}) is None


def test_validate_item_data_reports_missing_required() -> None:
    error = validate_item_data({"title": "ok"}, _SCHEMA)
    assert error is not None
    assert "n" in error


def test_validate_item_data_reports_wrong_type() -> None:
    error = validate_item_data({"n": 1, "title": 42}, _SCHEMA)
    assert error is not None
    assert "title" in error


def test_validate_item_data_rejects_bool_as_number() -> None:
    error = validate_item_data({"n": True, "title": "ok"}, _SCHEMA)
    assert error is not None
    assert "n" in error


def test_validate_item_data_enum_and_bounds() -> None:
    schema = {
        "type": "object",
        "properties": {
            "status": {"enum": ["open", "closed"]},
            "count": {"type": "integer", "minimum": 0, "maximum": 10},
            "tags": {"type": "array", "minItems": 1, "items": {"type": "string"}},
        },
    }
    assert validate_item_data({"status": "open", "count": 5, "tags": ["a"]}, schema) is None
    assert validate_item_data({"status": "bad"}, schema) is not None
    assert validate_item_data({"count": 99}, schema) is not None
    assert validate_item_data({"tags": []}, schema) is not None
    assert validate_item_data({"tags": [1]}, schema) is not None
