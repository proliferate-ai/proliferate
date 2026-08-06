from __future__ import annotations

import ast
from collections import Counter
from dataclasses import replace
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.errors import AuthFlowError
from proliferate.auth.sso import deployment_config, policy
from proliferate.auth.sso.types import VerifiedSsoIdentity
from proliferate.config import settings
from proliferate.db.models.auth import User
from proliferate.errors import ProliferateError
from proliferate.integrations.sso import oidc
from proliferate.integrations.sso.errors import SsoIntegrationError
from proliferate.server.accounts.sso import service, user_resolution
from tests.unit.auth.test_sso import _connection


def _assert_auth_error(
    exc_info: pytest.ExceptionInfo[AuthFlowError],
    *,
    code: str,
    status_code: int,
    message: str,
) -> None:
    assert (exc_info.value.code, exc_info.value.status_code, exc_info.value.message) == (
        code,
        status_code,
        message,
    )


def test_sso_policy_error_is_local_and_framework_free() -> None:
    error = policy.SsoPolicyError("sso_policy_failure", "Policy failed.")

    assert error.code == "sso_policy_failure"
    assert error.message == "Policy failed."
    assert str(error) == "Policy failed."
    assert isinstance(error, ValueError)
    assert not isinstance(error, ProliferateError)

    tree = _module_tree(policy)
    imported_modules = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
    banned_prefixes = (
        "fastapi",
        "starlette",
        "proliferate.auth.errors",
        "proliferate.server.accounts.sso.service",
        "proliferate.config",
        "proliferate.db",
        "proliferate.integrations",
    )
    assert not any(
        imported.startswith(prefix) for imported in imported_modules for prefix in banned_prefixes
    )


def test_sso_policy_error_callers_are_explicit_translation_boundaries() -> None:
    production_root = Path(cast(str, policy.__file__)).parents[2]
    named_paths = {
        path.relative_to(production_root).as_posix()
        for path in production_root.rglob("*.py")
        if "SsoPolicyError" in path.read_text()
    }
    assert named_paths == {
        "auth/sso/policy.py",
        "integrations/sso/oidc.py",
        "server/accounts/sso/user_resolution.py",
    }

    expected = {
        user_resolution: (
            "_require_verified_allowed_email",
            "require_email_domain_allowed",
        ),
        oidc: ("resolve_oidc_metadata", "oidc_discovery_url"),
    }
    for module, (function_name, policy_call) in expected.items():
        tree = _module_tree(module)
        matching_calls = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == policy_call
        ]
        assert len(matching_calls) == 1

        translation_tries = [
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.Try) and any(call in ast.walk(node) for call in matching_calls)
        ]
        assert len(translation_tries) == 1
        handler_names = {
            handler.type.id
            for handler in translation_tries[0].handlers
            if isinstance(handler.type, ast.Name)
        }
        assert handler_names == {"SsoPolicyError"}

        parent_functions = [
            node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == function_name
        ]
        assert len(parent_functions) == 1
        assert matching_calls[0] in ast.walk(parent_functions[0])


@pytest.mark.asyncio
async def test_email_policy_translates_before_identity_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    identity_lookup = AsyncMock()
    monkeypatch.setattr(
        user_resolution.sso_store,
        "get_sso_identity_by_connection_subject",
        identity_lookup,
    )

    with pytest.raises(AuthFlowError) as exc_info:
        await user_resolution.resolve_sso_user(
            cast(AsyncSession, object()),
            connection=_connection(allowed_domains=("example.com",)),
            verified=VerifiedSsoIdentity(
                provider_subject="subject",
                email="person@other.test",
                email_verified=True,
                display_name=None,
                avatar_url=None,
                claims={},
            ),
        )

    _assert_auth_error(
        exc_info,
        code="sso_email_domain_not_allowed",
        status_code=403,
        message="Email domain is not allowed for this SSO.",
    )
    assert isinstance(exc_info.value.__cause__, policy.SsoPolicyError)
    identity_lookup.assert_not_awaited()


@pytest.mark.asyncio
async def test_oidc_url_policy_translates_to_integration_error() -> None:
    connection = replace(
        _connection(allowed_domains=()),
        oidc_issuer_url=None,
        oidc_discovery_url="not-a-url",
    )

    with pytest.raises(SsoIntegrationError) as exc_info:
        await oidc.resolve_oidc_metadata(connection)

    assert exc_info.value.detail == "OIDC issuer URL is invalid."
    assert exc_info.value.status_code == 400
    assert isinstance(exc_info.value.__cause__, policy.SsoPolicyError)
    assert exc_info.value.__cause__.code == "sso_oidc_issuer_url_invalid"


def test_integration_error_translates_to_auth_flow_error() -> None:
    source_error = SsoIntegrationError("Provider unavailable.", status_code=503)

    with pytest.raises(AuthFlowError) as exc_info:
        service._raise_sso_integration_error(source_error)

    _assert_auth_error(
        exc_info,
        code="sso_integration_failure",
        status_code=503,
        message="Provider unavailable.",
    )
    assert exc_info.value.__cause__ is source_error


def test_deployment_failure_uses_frozen_auth_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "sso_login_policy", "required")

    with pytest.raises(AuthFlowError) as exc_info:
        deployment_config._deployment_login_policy()

    _assert_auth_error(
        exc_info,
        code="sso_required_login_policy_unsupported",
        status_code=400,
        message="Required SSO login policy is not supported yet.",
    )


@pytest.mark.asyncio
async def test_service_failure_uses_frozen_auth_error() -> None:
    with pytest.raises(AuthFlowError) as exc_info:
        await service.start_sso_auth(
            cast(AsyncSession, object()),
            cast(Request, object()),
            surface="unknown",
            client_state="state",
            code_challenge="challenge",
            code_challenge_method="S256",
            redirect_uri="proliferate://auth/callback",
            email=None,
            organization_id=None,
            connection_id=None,
            prompt=None,
            user=None,
        )

    _assert_auth_error(
        exc_info,
        code="sso_surface_unknown",
        status_code=404,
        message="Unknown auth surface.",
    )


def test_user_resolution_failure_uses_frozen_auth_error() -> None:
    inactive_user = cast(User, SimpleNamespace(is_active=False))

    with pytest.raises(AuthFlowError) as exc_info:
        user_resolution._ensure_active_user(inactive_user)

    _assert_auth_error(
        exc_info,
        code="sso_user_inactive",
        status_code=403,
        message="User is inactive.",
    )


def _module_tree(module: ModuleType) -> ast.Module:
    module_path = cast(str, module.__file__)
    return ast.parse(Path(module_path).read_text())


def _render(node: ast.expr) -> object:
    if isinstance(node, ast.Constant):
        return node.value
    return ast.unparse(node)


def _raise_descriptors(module: ModuleType) -> list[tuple[object, ...]]:
    rows: list[tuple[object, ...]] = []
    function_stack: list[str] = []

    class Visitor(ast.NodeVisitor):
        def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
            function_stack.append(node.name)
            self.generic_visit(node)
            function_stack.pop()

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_Raise(self, node: ast.Raise) -> None:
            call = node.exc
            if not (
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Name)
                and call.func.id in {"AuthFlowError", "SsoPolicyError"}
            ):
                self.generic_visit(node)
                return
            keywords = {keyword.arg: keyword.value for keyword in call.keywords}
            rows.append(
                (
                    function_stack[-1],
                    call.func.id,
                    _render(call.args[0]),
                    _render(call.args[1]),
                    _render(keywords["status_code"]) if "status_code" in keywords else None,
                )
            )
            self.generic_visit(node)

    Visitor().visit(_module_tree(module))
    return rows


def test_all_frozen_sso_raise_sites_have_exact_mapping() -> None:
    expected = {
        deployment_config: [
            (
                "_deployment_login_policy",
                "AuthFlowError",
                "sso_required_login_policy_unsupported",
                "Required SSO login policy is not supported yet.",
                400,
            ),
        ],
        policy: [
            (
                "require_email_domain_allowed",
                "SsoPolicyError",
                "sso_email_domain_not_allowed",
                "Email domain is not allowed for this SSO.",
                None,
            ),
            (
                "oidc_discovery_url",
                "SsoPolicyError",
                "sso_oidc_issuer_url_required",
                "OIDC issuer URL is required.",
                None,
            ),
            (
                "oidc_discovery_url",
                "SsoPolicyError",
                "sso_oidc_issuer_url_invalid",
                "OIDC issuer URL is invalid.",
                None,
            ),
        ],
        service: [
            (
                "start_sso_auth",
                "AuthFlowError",
                "sso_surface_unknown",
                "Unknown auth surface.",
                404,
            ),
            (
                "start_sso_auth",
                "AuthFlowError",
                "sso_code_challenge_method_unsupported",
                "Unsupported code challenge method.",
                400,
            ),
            (
                "start_sso_auth",
                "AuthFlowError",
                "sso_not_configured",
                "SSO is not configured for this account.",
                404,
            ),
            (
                "start_sso_auth",
                "AuthFlowError",
                "sso_protocol_unsupported",
                "Only OIDC SSO is currently supported.",
                400,
            ),
            (
                "complete_oidc_sso_callback",
                "AuthFlowError",
                "sso_protocol_mismatch",
                "SSO callback protocol mismatch.",
                400,
            ),
            (
                "test_oidc_connection",
                "AuthFlowError",
                "sso_connection_test_protocol_unsupported",
                "Only OIDC connection tests are supported.",
                400,
            ),
            (
                "_connection_for_start",
                "AuthFlowError",
                "sso_connection_disabled",
                "SSO connection is not enabled.",
                403,
            ),
            (
                "_connection_for_start",
                "AuthFlowError",
                "sso_email_domain_not_allowed",
                "Email domain is not allowed for this SSO.",
                403,
            ),
            (
                "_connection_for_challenge",
                "AuthFlowError",
                "sso_challenge_connection_missing",
                "SSO challenge is missing connection.",
                400,
            ),
            (
                "_connection_for_challenge",
                "AuthFlowError",
                "sso_connection_unavailable",
                "SSO connection is no longer available.",
                400,
            ),
            (
                "_connection_for_challenge",
                "AuthFlowError",
                "sso_connection_disabled",
                "SSO connection is not enabled.",
                403,
            ),
            (
                "_connection_for_challenge",
                "AuthFlowError",
                "sso_state_mismatch",
                "SSO callback state mismatch.",
                400,
            ),
            (
                "_consume_challenge",
                "AuthFlowError",
                "sso_state_invalid",
                "Invalid or expired SSO state.",
                400,
            ),
            (
                "_require_oidc_configured",
                "AuthFlowError",
                "f'sso_{error}'",
                "OIDC_CONFIG_ERROR_MESSAGES[error]",
                400,
            ),
            (
                "_raise_sso_integration_error",
                "AuthFlowError",
                "sso_integration_failure",
                "exc.detail",
                "exc.status_code",
            ),
        ],
        user_resolution: [
            (
                "_resolve_sso_user",
                "AuthFlowError",
                "sso_linked_user_not_found",
                "Linked SSO user not found.",
                400,
            ),
            (
                "_resolve_sso_user",
                "AuthFlowError",
                "sso_organization_missing",
                "SSO organization is missing.",
                400,
            ),
            (
                "_resolve_sso_user",
                "AuthFlowError",
                "sso_jit_disabled",
                "SSO user provisioning is disabled.",
                403,
            ),
            (
                "_resolve_sso_user",
                "AuthFlowError",
                "sso_jit_disabled",
                "SSO user provisioning is disabled.",
                403,
            ),
            (
                "_require_verified_allowed_email",
                "AuthFlowError",
                "sso_email_missing",
                "SSO did not return an email address.",
                400,
            ),
            (
                "_require_verified_allowed_email",
                "AuthFlowError",
                "sso_email_unverified",
                "SSO email address is not verified.",
                403,
            ),
            (
                "_require_verified_allowed_email",
                "AuthFlowError",
                "exc.code",
                "exc.message",
                403,
            ),
            (
                "_resolve_organization_sso_user",
                "AuthFlowError",
                "sso_organization_missing",
                "SSO organization is missing.",
                400,
            ),
            (
                "_resolve_organization_sso_user",
                "AuthFlowError",
                "sso_user_not_team_member",
                "SSO user is not a team member.",
                403,
            ),
            (
                "_resolve_organization_sso_user",
                "AuthFlowError",
                "sso_user_not_team_member",
                "SSO user is not a team member.",
                403,
            ),
            (
                "_ensure_active_user",
                "AuthFlowError",
                "sso_user_inactive",
                "User is inactive.",
                403,
            ),
        ],
    }

    for module, expected_rows in expected.items():
        assert Counter(_raise_descriptors(module)) == Counter(expected_rows)
        assert "HTTPException" not in Path(cast(str, module.__file__)).read_text()

    all_rows = [row for rows in expected.values() for row in rows]
    assert len(all_rows) == 30
    assert sum(row[2] != "exc.code" for row in all_rows) == 29
