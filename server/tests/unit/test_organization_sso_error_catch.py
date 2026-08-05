from __future__ import annotations

import ast
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.errors import AuthFlowError
from proliferate.auth.sso.types import SsoConnectionSnapshot
from proliferate.db.store.auth_sso_records import SsoConnectionRecord
from proliferate.server.organizations.errors import (
    OrganizationServiceError,
    OrganizationSsoConnectionEnableProtocolUnsupported,
    OrganizationSsoDisplayNameRequired,
    OrganizationSsoDisplayNameTooLong,
    OrganizationSsoJitDefaultRoleNotAllowed,
    OrganizationSsoRequiredLoginPolicyUnsupported,
)
from proliferate.server.organizations.sso import service
from proliferate.server.organizations.sso.models import (
    OrganizationSsoConnectionRequest,
    OrganizationSsoConnectionUpdateRequest,
)


@pytest.mark.parametrize(
    ("validator", "value", "error_type", "code", "message"),
    [
        (
            service._clean_display_name,
            " ",
            OrganizationSsoDisplayNameRequired,
            "sso_display_name_required",
            "SSO display name is required.",
        ),
        (
            service._clean_display_name,
            "x" * 256,
            OrganizationSsoDisplayNameTooLong,
            "sso_display_name_too_long",
            "SSO display name is too long.",
        ),
        (
            service._clean_default_role,
            "owner",
            OrganizationSsoJitDefaultRoleNotAllowed,
            "sso_jit_default_role_not_allowed",
            "SSO JIT default role cannot be owner.",
        ),
        (
            service._clean_login_policy,
            "required",
            OrganizationSsoRequiredLoginPolicyUnsupported,
            "sso_required_login_policy_unsupported",
            "Required SSO login policy is not supported yet.",
        ),
    ],
)
def test_organization_sso_validation_uses_stable_product_errors(
    validator: Callable[[str], str],
    value: str,
    error_type: type[OrganizationServiceError],
    code: str,
    message: str,
) -> None:
    with pytest.raises(error_type) as exc_info:
        validator(value)

    assert (exc_info.value.code, exc_info.value.status_code, exc_info.value.message) == (
        code,
        400,
        message,
    )


@pytest.mark.asyncio
async def test_create_mixed_failures_preserve_display_name_precedence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_connection = AsyncMock()
    monkeypatch.setattr(service.sso_store, "create_sso_connection", create_connection)

    with pytest.raises(OrganizationSsoDisplayNameRequired):
        await service.create_organization_sso_connection(
            cast(AsyncSession, object()),
            actor_user_id=uuid4(),
            organization_id=uuid4(),
            body=OrganizationSsoConnectionRequest(
                display_name=" ",
                login_policy="required",
                default_role="owner",
            ),
        )

    create_connection.assert_not_awaited()


@pytest.mark.asyncio
async def test_update_mixed_failures_preserve_login_policy_precedence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    update_connection = AsyncMock()
    monkeypatch.setattr(service.sso_store, "update_sso_connection", update_connection)

    with pytest.raises(OrganizationSsoRequiredLoginPolicyUnsupported):
        await service.update_organization_sso_connection(
            cast(AsyncSession, object()),
            actor_user_id=uuid4(),
            organization_id=uuid4(),
            connection_id=uuid4(),
            body=OrganizationSsoConnectionUpdateRequest(
                login_policy="required",
                default_role="owner",
            ),
        )

    update_connection.assert_not_awaited()


@pytest.mark.asyncio
async def test_enable_protocol_failure_uses_stable_product_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    test_connection = AsyncMock(return_value=SimpleNamespace(protocol="saml"))
    set_status = AsyncMock()
    monkeypatch.setattr(service, "test_organization_sso_connection", test_connection)
    monkeypatch.setattr(service.sso_store, "set_sso_connection_status", set_status)

    with pytest.raises(OrganizationSsoConnectionEnableProtocolUnsupported) as exc_info:
        await service.enable_organization_sso_connection(
            cast(AsyncSession, object()),
            actor_user_id=uuid4(),
            organization_id=uuid4(),
            connection_id=uuid4(),
        )

    assert (
        exc_info.value.code,
        exc_info.value.status_code,
        exc_info.value.message,
    ) == (
        "sso_connection_enable_protocol_unsupported",
        400,
        "Only OIDC SSO can be enabled right now.",
    )
    test_connection.assert_awaited_once()
    set_status.assert_not_awaited()


@pytest.mark.asyncio
async def test_enable_preserves_connection_test_failure_precedence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_error = AuthFlowError(
        "sso_connection_test_failed",
        "Connection test failed.",
        status_code=400,
    )
    test_connection = AsyncMock(side_effect=source_error)
    set_status = AsyncMock()
    monkeypatch.setattr(service, "test_organization_sso_connection", test_connection)
    monkeypatch.setattr(service.sso_store, "set_sso_connection_status", set_status)

    with pytest.raises(AuthFlowError) as exc_info:
        await service.enable_organization_sso_connection(
            cast(AsyncSession, object()),
            actor_user_id=uuid4(),
            organization_id=uuid4(),
            connection_id=uuid4(),
        )

    assert exc_info.value is source_error
    test_connection.assert_awaited_once()
    set_status.assert_not_awaited()


def test_all_organization_sso_product_error_sites_have_exact_mapping() -> None:
    source_path = Path(cast(str, service.__file__))
    tree = ast.parse(source_path.read_text())
    rows: list[tuple[str, str]] = []
    function_stack: list[str] = []

    class RaiseVisitor(ast.NodeVisitor):
        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            function_stack.append(node.name)
            self.generic_visit(node)
            function_stack.pop()

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_Raise(self, node: ast.Raise) -> None:
            call = node.exc
            if (
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Name)
                and call.func.id.startswith("OrganizationSso")
            ):
                rows.append((function_stack[-1], call.func.id))
            self.generic_visit(node)

    RaiseVisitor().visit(tree)

    assert Counter(rows) == Counter(
        {
            (
                "enable_organization_sso_connection",
                "OrganizationSsoConnectionEnableProtocolUnsupported",
            ): 1,
            ("_clean_display_name", "OrganizationSsoDisplayNameRequired"): 1,
            ("_clean_display_name", "OrganizationSsoDisplayNameTooLong"): 1,
            ("_clean_default_role", "OrganizationSsoJitDefaultRoleNotAllowed"): 1,
            (
                "_clean_login_policy",
                "OrganizationSsoRequiredLoginPolicyUnsupported",
            ): 1,
        }
    )
    assert "HTTPException" not in source_path.read_text()


@pytest.mark.asyncio
async def test_connection_test_records_and_reraises_auth_flow_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = cast(AsyncSession, object())
    connection_id = uuid4()
    organization_id = uuid4()
    actor_user_id = uuid4()
    record = cast(SsoConnectionRecord, object())
    snapshot = cast(SsoConnectionSnapshot, object())
    source_error = AuthFlowError(
        "sso_integration_failure",
        "OIDC discovery metadata could not be loaded.",
        status_code=400,
    )
    get_connection = AsyncMock(return_value=record)
    test_connection = AsyncMock(side_effect=source_error)
    mark_result = AsyncMock(return_value=record)
    monkeypatch.setattr(service.sso_store, "get_sso_connection", get_connection)
    monkeypatch.setattr(service, "snapshot_from_sso_connection_record", lambda value: snapshot)
    monkeypatch.setattr(service, "test_oidc_connection", test_connection)
    monkeypatch.setattr(service.sso_store, "mark_sso_connection_test_result", mark_result)

    with pytest.raises(AuthFlowError) as exc_info:
        await service.test_organization_sso_connection(
            db,
            actor_user_id=actor_user_id,
            organization_id=organization_id,
            connection_id=connection_id,
        )

    assert exc_info.value is source_error
    get_connection.assert_awaited_once_with(
        db,
        connection_id=connection_id,
        organization_id=organization_id,
    )
    test_connection.assert_awaited_once_with(db, connection=snapshot)
    mark_result.assert_awaited_once_with(
        db,
        connection_id=connection_id,
        organization_id=organization_id,
        success=False,
        error="OIDC discovery metadata could not be loaded.",
        discovered=None,
        actor_user_id=actor_user_id,
    )
