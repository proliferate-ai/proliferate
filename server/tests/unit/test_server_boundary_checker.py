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
