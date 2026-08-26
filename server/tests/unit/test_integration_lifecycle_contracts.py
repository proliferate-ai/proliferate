"""Typed contract proof for the server-owned integration management item."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import TypeAdapter, ValidationError

from proliferate.server.integration_gateway.connections.models import (
    IntegrationAuthorizationAttemptSummary,
    IntegrationConnectSchema,
    IntegrationManagementActions,
    IntegrationManagementItem,
    IntegrationProviderAvailability,
)

_ITEM_ADAPTER = TypeAdapter(IntegrationManagementItem)
_ACTIONS_ADAPTER = TypeAdapter(IntegrationManagementActions)


def test_management_item_serializes_one_primary_action_without_secret_fields() -> None:
    attempt_id = uuid4()
    item = _ITEM_ADAPTER.validate_python(
        IntegrationManagementItem(
            definitionId=uuid4(),
            namespace="linear",
            displayName="Linear",
            description=None,
            authKind="oauth2",
            connectSchema=IntegrationConnectSchema(),
            availability=IntegrationProviderAvailability(available=True, reason=None),
            connection=None,
            attempt=IntegrationAuthorizationAttemptSummary(
                attemptId=attempt_id,
                purpose="connect",
                method="oauth2",
                generation=3,
                status="active",
                authorizationUrl="https://linear.example/authorize?opaque=1",
                expiresAt=datetime(2026, 8, 19, 10, tzinfo=UTC),
                failureCode=None,
            ),
            actions=IntegrationManagementActions(
                primary="open_authorization",
                secondary=["cancel"],
            ),
        )
    )

    payload = _ITEM_ADAPTER.dump_python(item, mode="json", exclude_none=True)

    assert payload["attempt"]["attemptId"] == str(attempt_id)
    assert payload["actions"] == {
        "primary": "open_authorization",
        "secondary": ["cancel"],
    }
    serialized = repr(payload).lower()
    assert "ciphertext" not in serialized
    assert "credential" not in serialized
    assert "verifier" not in serialized


def test_disconnect_cannot_be_encoded_as_a_second_primary_action() -> None:
    with pytest.raises(ValidationError):
        _ACTIONS_ADAPTER.validate_python(
            {
                "primary": "disconnect",
                "secondary": [],
            }
        )
