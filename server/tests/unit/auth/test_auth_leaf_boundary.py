"""Structural contract for the Auth leaf's allowed intermediate dependencies."""

from __future__ import annotations

import ast
from pathlib import Path


def _server_domains_imported_by_auth(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    domains: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom) or not node.module:
            continue
        parts = node.module.split(".")
        if parts[:2] == ["proliferate", "server"] and len(parts) > 2:
            domains.add(parts[2])
    return domains


def test_auth_leaf_has_only_the_deferred_sso_product_imports() -> None:
    server_root = Path(__file__).parents[3]
    auth_root = server_root / "proliferate" / "auth"
    offenders = {
        path.relative_to(auth_root).as_posix(): _server_domains_imported_by_auth(path)
        for path in auth_root.rglob("*.py")
        if _server_domains_imported_by_auth(path)
    }

    assert offenders == {
        "sso/service.py": {"cloud"},
        "sso/user_resolution.py": {"billing", "cloud", "organizations"},
    }
    auth_files = auth_root.rglob("*.py")
    assert not any("proliferate.server.accounts" in path.read_text() for path in auth_files)
    assert not (auth_root / "desktop" / "api.py").exists()
    assert not (auth_root / "desktop" / "service.py").exists()
    assert not (auth_root / "identity" / "api.py").exists()
