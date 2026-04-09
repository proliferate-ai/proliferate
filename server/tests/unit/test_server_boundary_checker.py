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
    assert any("DB session" in item.message for item in violations)


def test_service_rejects_async_session_import(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text(
        "from sqlalchemy.ext.asyncio import AsyncSession\n"
        "async def run(db: AsyncSession) -> None:\n"
        "    return None\n"
    )

    violations = module.check_paths([path])
    assert any("must not import SQLAlchemy" in item.message for item in violations)


def test_service_rejects_db_commit_call(tmp_path: Path) -> None:
    module = _load_checker_module()
    path = tmp_path / "server" / "proliferate" / "server" / "example" / "service.py"
    path.parent.mkdir(parents=True)
    path.write_text("async def run(db) -> None:\n    await db.commit()\n")

    violations = module.check_paths([path])
    assert any(".commit()" in item.message for item in violations)
