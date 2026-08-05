from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


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

    assert any(item.rule_id == "SERVICE_SQLALCHEMY_IMPORT" for item in violations)


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

    assert sum(item.rule_id == "SERVICE_SQLALCHEMY_IMPORT" for item in violations) == 2
    assert any(item.rule_id == "SERVICE_DB_ENGINE_IMPORT" for item in violations)
    assert any(item.rule_id == "SERVICE_ORM_IMPORT" for item in violations)
    assert sum(item.rule_id == "SERVICE_DB_METHOD_CALL" for item in violations) == 3


def test_canonical_single_file_worker_service_folder_is_allowed(tmp_path: Path) -> None:
    module = _load_checker_module()
    root = _configure_structure_root(module, tmp_path)
    worker = root / "example" / "worker"
    worker.mkdir(parents=True)
    (worker / "__init__.py").write_text("")
    (worker / "service.py").write_text("async def run() -> None:\n    return None\n")

    violations = module.check_structure(tmp_path)

    assert not any(item.path == worker for item in violations)


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

    rejected = {item.path for item in violations if item.rule_id == "SINGLE_FILE_FOLDER"}
    assert worker in rejected
    assert arbitrary in rejected


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
