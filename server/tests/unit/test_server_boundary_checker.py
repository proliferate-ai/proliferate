from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import pytest


PROTECTED_STORE_SYMBOLS = {
    "proliferate.db.store.organizations": (
        "acquire_membership_activation_lock",
        "bind_team_checkout_session",
        "cancel_team_checkout_intent",
        "complete_team_checkout_activation",
        "complete_team_checkout_activation_by_id",
        "create_pending_team_checkout_intent",
        "get_current_team_checkout_intent",
        "load_team_checkout_activation_for_update",
        "load_team_checkout_intent_for_update",
        "mark_team_checkout_activating",
        "mark_team_checkout_activating_by_id",
        "mark_team_checkout_failed",
        "mark_team_checkout_failed_by_id",
    ),
    "proliferate.db.store.organization_invitations": (
        "accept_pending_invitation_for_organization_email",
        "create_or_rotate_organization_invitation",
        "mark_invitation_delivery",
    ),
    "proliferate.db.store.cloud_sandboxes": (
        "accept_destroyed_cloud_sandbox_provider_observation",
        "advance_cloud_sandbox_provider_observation_floor",
        "apply_cloud_sandbox_provider_observation",
        "mark_cloud_sandbox_provider_missing",
    ),
}


def _load_checker_module():
    script_path = Path(__file__).resolve().parents[3] / "scripts" / "check_server_boundaries.py"
    spec = importlib.util.spec_from_file_location("check_server_boundaries", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _check_named_source(
    tmp_path: Path,
    relative_path: str,
    source: str,
):
    module = _load_checker_module()
    path = tmp_path / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(source)
    return module, module.check_named_cross_domain_writes([path], tmp_path)


def test_named_write_registry_matches_frozen_contract() -> None:
    module = _load_checker_module()

    actual = {
        store_module: tuple(sorted(boundary.protected_symbols))
        for store_module, boundary in module.NAMED_STORE_BOUNDARIES.items()
    }
    expected = {
        store_module: tuple(sorted(symbols))
        for store_module, symbols in PROTECTED_STORE_SYMBOLS.items()
    }

    assert actual == expected
    assert {store_module: len(symbols) for store_module, symbols in actual.items()} == {
        "proliferate.db.store.organizations": 13,
        "proliferate.db.store.organization_invitations": 3,
        "proliferate.db.store.cloud_sandboxes": 4,
    }
    assert sum(len(symbols) for symbols in actual.values()) == 20
    organization_persistence = frozenset(
        {
            "server/proliferate/db/store/organization_invitations.py",
            "server/proliferate/db/store/organizations.py",
        }
    )
    for store_module in (
        "proliferate.db.store.organizations",
        "proliferate.db.store.organization_invitations",
    ):
        boundary = module.NAMED_STORE_BOUNDARIES[store_module]
        assert boundary.product_owner_prefix == (
            "server",
            "proliferate",
            "server",
            "organizations",
        )
        assert boundary.persistence_owner_paths == organization_persistence
        assert boundary.owner_service_hint == "proliferate.server.organizations.service"
    cloud_boundary = module.NAMED_STORE_BOUNDARIES["proliferate.db.store.cloud_sandboxes"]
    assert cloud_boundary.product_owner_prefix == (
        "server",
        "proliferate",
        "server",
        "cloud",
    )
    assert cloud_boundary.persistence_owner_paths == frozenset(
        {"server/proliferate/db/store/cloud_sandboxes.py"}
    )
    assert cloud_boundary.owner_service_hint == "proliferate.server.cloud.cloud_sandboxes.service"


@pytest.mark.parametrize(
    ("store_module", "symbol"),
    [
        (store_module, symbol)
        for store_module, symbols in PROTECTED_STORE_SYMBOLS.items()
        for symbol in symbols
    ],
)
@pytest.mark.parametrize("alias", ["", " as protected_alias"])
def test_foreign_direct_import_rejects_every_protected_symbol(
    tmp_path: Path,
    store_module: str,
    symbol: str,
    alias: str,
) -> None:
    local_name = "protected_alias" if alias else symbol
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foreign.py",
        f"from {store_module} import {symbol}{alias}\n{local_name}()\n",
    )

    assert len(violations) == 1
    violation = violations[0]
    assert violation.rule_id == "NAMED_CROSS_DOMAIN_WRITE"
    assert violation.lineno == 1
    assert f"{store_module}.{symbol}" in violation.message
    expected_hint = (
        "proliferate.server.cloud.cloud_sandboxes.service"
        if store_module.endswith("cloud_sandboxes")
        else "proliferate.server.organizations.service"
    )
    assert expected_hint in violation.message
    assert violation.relative_path(tmp_path) == ("server/proliferate/server/billing/foreign.py")


@pytest.mark.parametrize(
    "source",
    [
        "from proliferate.db.store import organizations as organization_store\n"
        "write = organization_store.bind_team_checkout_session\n",
        "import proliferate.db.store.organizations as organization_store\n"
        "write = organization_store.bind_team_checkout_session\n",
        "from proliferate.db.store import organizations as organization_store\n"
        "organization_store.bind_team_checkout_session()\n",
        "from proliferate.db.store import organizations as organization_store\n"
        'write = getattr(organization_store, "bind_team_checkout_session")\n',
        "import proliferate.db.store.organizations as organization_store\n"
        'write = getattr(organization_store, "bind_team_checkout_session")\n',
    ],
)
def test_module_alias_access_is_rejected(tmp_path: Path, source: str) -> None:
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foreign.py",
        source,
    )

    assert len(violations) == 1
    assert violations[0].rule_id == "NAMED_CROSS_DOMAIN_WRITE"
    assert "proliferate.db.store.organizations.bind_team_checkout_session" in violations[0].message


@pytest.mark.parametrize("literal_getattr", [False, True])
def test_qualified_reference_is_rejected(tmp_path: Path, literal_getattr: bool) -> None:
    store_module = "proliferate.db.store.cloud_sandboxes"
    symbol = "apply_cloud_sandbox_provider_observation"
    reference = (
        f'getattr({store_module}, "{symbol}")' if literal_getattr else f"{store_module}.{symbol}"
    )
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foreign.py",
        f"import {store_module}\nwrite = {reference}\nwrite()\n",
    )

    assert len(violations) == 1
    assert violations[0].lineno == 2
    assert f"{store_module}.{symbol}" in violations[0].message


def test_star_import_rejects_each_protected_store_symbol(tmp_path: Path) -> None:
    store_module = "proliferate.db.store.cloud_sandboxes"
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foreign.py",
        f"from {store_module} import *\n",
    )

    assert len(violations) == 4
    assert {item.rule_id for item in violations} == {"NAMED_CROSS_DOMAIN_WRITE"}
    for symbol in PROTECTED_STORE_SYMBOLS[store_module]:
        assert any(f"{store_module}.{symbol}" in item.message for item in violations)


@pytest.mark.parametrize(
    ("relative_path", "store_module", "symbol"),
    [
        (
            "server/proliferate/server/organizations/invitation_delivery.py",
            "proliferate.db.store.organization_invitations",
            "mark_invitation_delivery",
        ),
        (
            "server/proliferate/server/cloud/webhooks/service.py",
            "proliferate.db.store.cloud_sandboxes",
            "apply_cloud_sandbox_provider_observation",
        ),
    ],
)
def test_product_owner_may_access_its_protected_store(
    tmp_path: Path,
    relative_path: str,
    store_module: str,
    symbol: str,
) -> None:
    _, violations = _check_named_source(
        tmp_path,
        relative_path,
        f"from {store_module} import {symbol}\n",
    )

    assert violations == []


@pytest.mark.parametrize(
    ("relative_path", "store_module", "symbol"),
    [
        (
            "server/proliferate/db/store/organizations.py",
            "proliferate.db.store.organization_invitations",
            "mark_invitation_delivery",
        ),
        (
            "server/proliferate/db/store/organization_invitations.py",
            "proliferate.db.store.organizations",
            "mark_team_checkout_failed_by_id",
        ),
        (
            "server/proliferate/db/store/cloud_sandboxes.py",
            "proliferate.db.store.cloud_sandboxes",
            "mark_cloud_sandbox_provider_missing",
        ),
    ],
)
def test_exact_persistence_owner_may_access_protected_store(
    tmp_path: Path,
    relative_path: str,
    store_module: str,
    symbol: str,
) -> None:
    _, violations = _check_named_source(
        tmp_path,
        relative_path,
        f"from {store_module} import {symbol}\n",
    )

    assert violations == []


@pytest.mark.parametrize(
    "relative_path",
    [
        "server/proliferate/db/store/unrelated.py",
        "server/proliferate/server/organizations_external/service.py",
    ],
)
def test_owner_lookalikes_may_not_access_protected_store(
    tmp_path: Path,
    relative_path: str,
) -> None:
    _, violations = _check_named_source(
        tmp_path,
        relative_path,
        "from proliferate.db.store.organizations import bind_team_checkout_session\n",
    )

    assert len(violations) == 1
    assert violations[0].rule_id == "NAMED_CROSS_DOMAIN_WRITE"


def test_same_named_owner_service_calls_are_legal(tmp_path: Path) -> None:
    _, violations = _check_named_source(
        tmp_path,
        "server/proliferate/server/billing/foreign.py",
        "from proliferate.server.organizations import service as organization_service\n"
        "from proliferate.server.cloud.cloud_sandboxes import service as cloud_service\n"
        "organization_service.bind_team_checkout_session()\n"
        "cloud_service.apply_cloud_sandbox_provider_observation()\n",
    )

    assert violations == []


@pytest.mark.parametrize(
    ("relative_path", "source"),
    [
        (
            "server/proliferate/auth/sso/user_resolution.py",
            "from proliferate.db.store import organization_invitations as invitations\n"
            "from proliferate.db.store import organizations as organizations\n"
            "invitations.has_live_pending_invitation_for_organization_email()\n"
            "organizations.get_active_membership()\n",
        ),
        (
            "server/proliferate/server/billing/reconciler.py",
            "from proliferate.db.store import cloud_sandboxes as sandboxes\n"
            "sandboxes.load_cloud_sandbox_by_id()\n",
        ),
        (
            "server/proliferate/server/billing/team_checkout/activation.py",
            "from proliferate.db.store import billing_subscriptions as subscriptions\n"
            "from proliferate.db.store import organizations as organizations\n"
            "from proliferate.db.store import users as users\n"
            "users.get_user_by_id()\n"
            "subscriptions.upsert_billing_subscription()\n"
            'symbol_name = "bind_team_checkout_session"\n'
            "getattr(organizations, symbol_name)\n"
            'getattr(organizations, "get_active_membership")\n'
            "unrelated.bind_team_checkout_session()\n",
        ),
    ],
)
def test_named_legal_reads_and_unrelated_same_named_method_are_legal(
    tmp_path: Path,
    relative_path: str,
    source: str,
) -> None:
    _, violations = _check_named_source(tmp_path, relative_path, source)

    assert violations == []


def test_named_rule_scans_root_production_and_skips_migrations(
    tmp_path: Path,
) -> None:
    module = _load_checker_module()
    root_source = tmp_path / "server" / "proliferate" / "root_concern.py"
    migration_source = tmp_path / "server" / "proliferate" / "db" / "migrations" / "revision.py"
    alembic_source = tmp_path / "server" / "proliferate" / "alembic" / "versions" / "revision.py"
    for path in (root_source, migration_source, alembic_source):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "from proliferate.db.store.organizations import cancel_team_checkout_intent\n"
        )

    targets = module.iter_named_write_target_files(tmp_path)
    violations = module.check_named_cross_domain_writes(targets, tmp_path)

    assert targets == [root_source]
    assert len(violations) == 1
    assert violations[0].path == root_source


def test_api_allows_auth_user_import_only(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "api.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "from proliferate.db.models.auth import User\n"
        "from fastapi import Depends\n"
        "async def endpoint(user: User = Depends(...)) -> None:\n"
        "    return None\n"
    )

    violations = module.check_paths([path])
    assert violations == []


def test_api_rejects_store_import(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "api.py"
    path.parent.mkdir(parents=True)
    path.write_text("from proliferate.db.store.users import load_user_by_id\n")

    violations = module.check_paths([path])
    assert any("must not import db/store modules" in item.message for item in violations)


def test_api_rejects_async_session_dep(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "api.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "from proliferate.db.engine import AsyncSessionDep\n"
        "async def endpoint(db: AsyncSessionDep) -> None:\n"
        "    return None\n"
    )

    violations = module.check_paths([path])
    assert any(item.rule_id == "API_DB_ENGINE_IMPORT" for item in violations)


def test_api_allows_documented_async_session_dependency(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "api.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "from fastapi import Depends\n"
        "from sqlalchemy.ext.asyncio import AsyncSession\n"
        "from proliferate.db.engine import get_async_session\n"
        "async def endpoint(db: AsyncSession = Depends(get_async_session)) -> None:\n"
        "    return None\n"
    )

    violations = module.check_paths([path])
    assert violations == []


def test_service_allows_async_session_type_only(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "from sqlalchemy.ext.asyncio import AsyncSession\n"
        "async def run(db: AsyncSession) -> None:\n"
        "    return None\n"
    )

    violations = module.check_paths([path])
    assert violations == []


def test_service_rejects_query_builder_import(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text("from sqlalchemy import select\n")

    violations = module.check_paths([path])
    assert any(item.rule_id == "SERVICE_SQLALCHEMY_IMPORT" for item in violations)


def test_service_rejects_db_commit_call(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text("async def run(db) -> None:\n    await db.commit()\n")

    violations = module.check_paths([path])
    assert any(".commit()" in item.message for item in violations)


def test_owned_service_concern_rejects_db_commit_after_relocation(tmp_path: Path) -> None:
    module = _load_checker_module()
    module.REPO_ROOT = tmp_path
    path = (
        tmp_path
        / "server"
        / "proliferate"
        / "server"
        / "cloud"
        / "materialization"
        / "materialize"
        / "workflow_runtime.py"
    )
    path.parent.mkdir(parents=True)
    path.write_text("async def run(db) -> None:\n    await db.commit()\n")

    violations = module.check_paths([path])

    assert any(item.rule_id == "SERVICE_DB_METHOD_CALL" for item in violations)


def test_service_rejects_session_ops_import_and_call(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "from proliferate.db import session_ops as db_session\n"
        "async def run() -> None:\n"
        "    async with db_session.open_async_session() as db:\n"
        "        await db_session.commit_session(db)\n"
        "    if db_session.is_integrity_error(Exception()):\n"
        "        return None\n"
    )

    violations = module.check_paths([path])

    assert any(item.rule_id == "SERVICE_DB_ENGINE_IMPORT" for item in violations)
    assert sum(item.rule_id == "SERVICE_DB_METHOD_CALL" for item in violations) == 3


def test_store_rejects_self_opening_session_and_commit(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "db" / "store" / "example.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "from proliferate.db import engine as db_engine\n"
        "async def run() -> None:\n"
        "    async with db_engine.async_session_factory() as db:\n"
        "        await db.commit()\n"
    )

    violations = module.check_paths([path])
    assert any(item.rule_id == "STORE_SESSION_FACTORY_IMPORT" for item in violations)
    assert any(item.rule_id == "STORE_SESSION_FACTORY_CALL" for item in violations)
    assert any(item.rule_id == "STORE_COMMIT_ROLLBACK" for item in violations)


def test_domain_rejects_async_export_and_framework_import(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "domain" / "policy.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "from fastapi import HTTPException\n"
        "async def can_run() -> bool:\n"
        "    raise HTTPException(status_code=403)\n"
    )

    violations = module.check_paths([path])
    assert any(item.rule_id == "DOMAIN_FORBIDDEN_IMPORT" for item in violations)
    assert any(item.rule_id == "DOMAIN_ASYNC_EXPORT" for item in violations)
    assert any(item.rule_id == "HTTP_EXCEPTION_FORBIDDEN" for item in violations)


def test_background_tasks_folder_allows_single_task_module(tmp_path: Path) -> None:
    module = _load_checker_module()
    root = tmp_path / "server" / "proliferate" / "background"
    tasks = root / "tasks"
    tasks.mkdir(parents=True)
    (root / "__init__.py").write_text("")
    (tasks / "__init__.py").write_text("")
    (tasks / "health.py").write_text("def noop() -> str:\n    return 'ok'\n")

    violations = module.check_structure(tmp_path)

    assert violations == []


def test_integration_rejects_database_import(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "integrations" / "example.py"
    path.parent.mkdir(parents=True)
    path.write_text("from proliferate.db import engine as db_engine\n")

    violations = module.check_paths([path])

    assert any(item.rule_id == "INTEGRATION_DB_IMPORT" for item in violations)


def test_allowlist_counts_do_not_hide_new_debt(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "async def one(db) -> None:\n"
        "    await db.commit()\n"
        "async def two(db) -> None:\n"
        "    await db.rollback()\n"
    )
    violations = module.check_paths([path])
    relative = path.as_posix()
    allowlist = {
        ("SERVICE_DB_METHOD_CALL", relative): module.AllowlistEntry(
            rule_id="SERVICE_DB_METHOD_CALL",
            path=relative,
            count=1,
            reason="test",
        )
    }

    failing, stale = module.apply_allowlist(violations, allowlist)

    assert len(failing) == 1
    assert stale == []


def test_allowlist_reports_stale_entries(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text("async def run() -> None:\n    return None\n")
    allowlist = {
        ("SERVICE_DB_METHOD_CALL", path.as_posix()): module.AllowlistEntry(
            rule_id="SERVICE_DB_METHOD_CALL",
            path=path.as_posix(),
            count=1,
            reason="test",
        )
    }

    failing, stale = module.apply_allowlist([], allowlist)

    assert failing == []
    assert stale
