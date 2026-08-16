from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import pytest


def _load_checker_module():
    script_path = Path(__file__).resolve().parents[3] / "scripts" / "check_server_boundaries.py"
    spec = importlib.util.spec_from_file_location("check_server_boundaries", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _configure_structure_root(module, tmp_path: Path) -> Path:  # type: ignore[no-untyped-def]
    root = tmp_path / "server" / "proliferate" / "server"
    root.mkdir(parents=True)
    module.REPO_ROOT = tmp_path
    module.CHECK_ROOTS = [root]
    module.STRUCTURE_ROOTS = [root]
    return root


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
    assert any(item.rule_id == "SRV-API-1" for item in violations)


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
    assert any(item.rule_id == "SRV-API-3" for item in violations)


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


def test_worker_service_allows_task_created_session_factory_type(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "worker" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker\n"
        "async def run(factory: async_sessionmaker[AsyncSession]) -> None:\n"
        "    async with factory() as db:\n"
        "        await read_store(db)\n"
    )

    violations = module.check_paths([path])

    assert violations == []


def test_ordinary_service_rejects_session_factory_type(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text("from sqlalchemy.ext.asyncio import async_sessionmaker\n")

    violations = module.check_paths([path])

    assert any(item.rule_id == "SRV-SVC-1" for item in violations)


def test_worker_service_still_rejects_queries_engines_models_and_session_methods(
    tmp_path: Path,
) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "worker" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "from sqlalchemy import select\n"
        "from sqlalchemy.ext.asyncio import (\n"
        "    AsyncSession, async_sessionmaker, create_async_engine,\n"
        ")\n"
        "from proliferate.db.engine import async_session_factory\n"
        "from proliferate.db.models.auth import User\n"
        "async def run(db) -> None:\n"
        "    await db.execute(select(User))\n"
        "    await db.commit()\n"
        "    await db.rollback()\n"
    )

    violations = module.check_paths([path])

    assert sum(item.rule_id == "SRV-SVC-1" for item in violations) == 2
    assert any(item.rule_id == "SRV-SVC-2" for item in violations)
    assert any(item.rule_id == "SRV-SVC-3" for item in violations)
    assert sum(item.rule_id == "SRV-SVC-4" for item in violations) == 3


@pytest.mark.parametrize(
    "method_name",
    [
        "scalar",
        "scalars",
        "stream",
        "stream_scalars",
        "get",
        "get_one",
        "add_all",
        "merge",
        "flush",
        "connection",
        "run_sync",
    ],
)
def test_worker_service_rejects_direct_session_escape_methods(
    tmp_path: Path,
    method_name: str,
) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "worker" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text(f"async def run(db) -> None:\n    db.{method_name}(value)\n")

    violations = module.check_paths([path])

    assert any(item.rule_id == "SRV-SVC-4" for item in violations)


def test_canonical_single_file_worker_service_folder_is_allowed(tmp_path: Path) -> None:
    module = _load_checker_module()
    root = _configure_structure_root(module, tmp_path)
    worker = root / "example" / "worker"
    worker.mkdir(parents=True)
    (worker / "__init__.py").write_text("")
    (worker / "service.py").write_text("async def run() -> None:\n    return None\n")

    violations = module.check_structure(tmp_path)

    assert not any(item.path == worker for item in violations)


@pytest.mark.parametrize(
    "relative_path",
    [
        Path("worker/service.py"),
        Path("example/subdomain/worker/service.py"),
    ],
)
def test_worker_service_exemption_requires_exact_domain_depth(
    tmp_path: Path,
    relative_path: Path,
) -> None:
    module = _load_checker_module()
    root = _configure_structure_root(module, tmp_path)
    path = root / relative_path
    path.parent.mkdir(parents=True)
    path.write_text("from sqlalchemy.ext.asyncio import async_sessionmaker\n")

    path_violations = module.check_paths([path])
    structure_violations = module.check_structure(tmp_path)

    assert any(item.rule_id == "SRV-SVC-1" for item in path_violations)
    assert any(
        item.rule_id == "SRV-STRUCT-4" and item.path == path.parent
        for item in structure_violations
    )


def test_noncanonical_worker_and_arbitrary_single_file_folders_remain_rejected(
    tmp_path: Path,
) -> None:
    module = _load_checker_module()
    root = _configure_structure_root(module, tmp_path)
    worker = root / "example" / "worker"
    worker.mkdir(parents=True)
    (worker / "jobs.py").write_text("def run() -> None:\n    return None\n")
    arbitrary = root / "example" / "reports"
    arbitrary.mkdir()
    (arbitrary / "snapshot.py").write_text("def read() -> None:\n    return None\n")

    violations = module.check_structure(tmp_path)

    rejected = {item.path for item in violations if item.rule_id == "SRV-STRUCT-4"}
    assert worker in rejected
    assert arbitrary in rejected


def test_service_rejects_query_builder_import(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text("from sqlalchemy import select\n")

    violations = module.check_paths([path])
    assert any(item.rule_id == "SRV-SVC-1" for item in violations)


def test_service_rejects_db_commit_call(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text("async def run(db) -> None:\n    await db.commit()\n")

    violations = module.check_paths([path])
    assert any(item.rule_id == "SRV-SVC-4" and ".commit()" in item.detail for item in violations)


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

    assert any(item.rule_id == "SRV-SVC-4" for item in violations)


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

    assert any(item.rule_id == "SRV-SVC-2" for item in violations)
    assert sum(item.rule_id == "SRV-SVC-4" for item in violations) == 3


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
    assert any(item.rule_id == "SRV-STORE-1" for item in violations)
    assert any(item.rule_id == "SRV-STORE-4" for item in violations)
    assert any(item.rule_id == "SRV-STORE-3" for item in violations)


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
    assert any(item.rule_id == "SRV-DOMAIN-1" for item in violations)
    assert any(item.rule_id == "SRV-DOMAIN-3" for item in violations)
    assert any(item.rule_id == "SRV-ERR-1" for item in violations)


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

    assert any(item.rule_id == "SRV-INTEG-1" for item in violations)


def test_migration_rejects_application_import(tmp_path: Path) -> None:
    module = _load_checker_module()
    module.REPO_ROOT = tmp_path
    path = tmp_path / "server" / "alembic" / "versions" / "revision.py"
    path.parent.mkdir(parents=True)
    path.write_text("from proliferate.constants.organizations import STATUS\n")

    violations = module.check_paths([path])

    assert any(item.rule_id == "SRV-MIGRATE-1" for item in violations)


def _ledger(module, sites):  # type: ignore[no-untyped-def]
    """A RuleSet carrying the real rule records plus the given exception sites."""
    ruleset = module.lint_records.load()
    ruleset.exceptions = [
        module.lint_records.Exception_(rule=rule_id, path=path, site=site, reason="test")
        for rule_id, path, site in sites
    ]
    return ruleset


def test_exception_ledger_excepts_one_site_without_hiding_its_sibling(
    tmp_path: Path,
) -> None:
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
    assert len(violations) == 2
    relative = path.as_posix()
    ledger = _ledger(module, [("SRV-SVC-4", relative, "one::db.commit")])

    failing, stale = module.apply_exceptions(violations, ledger)

    assert len(failing) == 1
    assert failing[0].site == "two::db.rollback"
    assert stale == []


def test_repeated_fingerprints_get_occurrence_ordinals(tmp_path: Path) -> None:
    # Two hits of one rule can share a fingerprint (the same session method
    # twice in one function). Without an ordinal the second would be excused by
    # the first one's ledger entry, so the ledger would under-count by
    # construction.
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "async def one(db) -> None:\n"
        "    await db.commit()\n"
        "    await db.commit()\n"
        "    await db.commit()\n"
    )

    violations = module.disambiguate(module.check_paths([path]))

    assert [item.site for item in violations] == [
        "one::db.commit",
        "one::db.commit#2",
        "one::db.commit#3",
    ]


def test_ledgered_fingerprint_does_not_absorb_a_net_new_sibling_hit(
    tmp_path: Path,
) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text("async def one(db) -> None:\n    await db.commit()\n    await db.commit()\n")
    violations = module.disambiguate(module.check_paths([path]))
    ledger = _ledger(module, [("SRV-SVC-4", path.as_posix(), "one::db.commit")])

    failing, stale = module.apply_exceptions(violations, ledger)

    assert [item.site for item in failing] == ["one::db.commit#2"]
    assert stale == []


def test_exception_ledger_reports_stale_entries(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text("async def run() -> None:\n    return None\n")
    ledger = _ledger(module, [("SRV-SVC-4", path.as_posix(), "run::db.commit")])

    failing, stale = module.apply_exceptions([], ledger)

    assert failing == []
    assert stale


def test_diagnostic_carries_rule_alternative_and_record_path(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text("async def run(db) -> None:\n    await db.commit()\n")

    (violation,) = module.check_paths([path])
    rendered = violation.format(tmp_path)

    rule = module.ruleset().rule("SRV-SVC-4")
    assert "SRV-SVC-4" in rendered
    assert rule.rule.splitlines()[0] in rendered
    assert rule.alternative.splitlines()[0] in rendered
    assert "lints/server/boundaries.toml" in rendered
