"""Structural contract for the Auth leaf's zero product-domain imports."""

from __future__ import annotations

import ast
from pathlib import Path


def _server_imports(path: Path) -> tuple[str, ...]:
    tree = ast.parse(path.read_text())
    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module == "proliferate.server" or module.startswith("proliferate.server."):
                imports.append(module)
            elif module == "proliferate" and any(alias.name == "server" for alias in node.names):
                imports.append("proliferate.server")
        elif isinstance(node, ast.Import):
            imports.extend(
                alias.name
                for alias in node.names
                if alias.name == "proliferate.server"
                or alias.name.startswith("proliferate.server.")
            )
    return tuple(imports)


def test_auth_leaf_has_no_product_domain_imports() -> None:
    server_root = Path(__file__).parents[3]
    auth_root = server_root / "proliferate" / "auth"
    offenders = {
        path.relative_to(auth_root).as_posix(): _server_imports(path)
        for path in auth_root.rglob("*.py")
        if _server_imports(path)
    }

    assert offenders == {}
    auth_files = auth_root.rglob("*.py")
    assert not any("proliferate.server.accounts" in path.read_text() for path in auth_files)
    assert not (auth_root / "desktop" / "api.py").exists()
    assert not (auth_root / "desktop" / "service.py").exists()
    assert not (auth_root / "identity" / "api.py").exists()
