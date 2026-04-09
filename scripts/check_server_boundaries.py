#!/usr/bin/env python3

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
CHECK_ROOTS = [
    REPO_ROOT / "server" / "proliferate" / "server",
    REPO_ROOT / "server" / "proliferate" / "auth",
]
EXCLUDED_PARTS = {"__pycache__", "tests", "alembic", "migrations"}
ALLOWED_API_ORM_IMPORT = ("proliferate.db.models.auth", "User")
BANNED_ENGINE_IMPORTS = {"AsyncSessionDep", "get_async_session", "async_session_factory"}
BANNED_TYPE_NAMES = {"AsyncSession", "AsyncSessionDep"}
BANNED_QUERY_IMPORTS = {"select", "insert", "update", "delete"}
BANNED_SESSION_METHODS = {"execute", "commit", "refresh", "rollback", "add", "delete"}


@dataclass(frozen=True)
class Violation:
    path: Path
    lineno: int
    message: str

    def format(self, repo_root: Path) -> str:
        relative = self.path.relative_to(repo_root).as_posix()
        return f"{relative}:{self.lineno}: {self.message}"


def should_skip(path: Path) -> bool:
    return any(part in EXCLUDED_PARTS for part in path.parts)


def iter_target_files(repo_root: Path) -> list[Path]:
    files: list[Path] = []
    for root in CHECK_ROOTS:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.py")):
            if should_skip(path):
                continue
            files.append(path)
    return files


def annotation_mentions_banned_name(node: ast.AST | None) -> bool:
    if node is None:
        return False
    for child in ast.walk(node):
        if isinstance(child, ast.Name) and child.id in BANNED_TYPE_NAMES:
            return True
    return False


def looks_like_db_handle(node: ast.AST) -> bool:
    if not isinstance(node, ast.Name):
        return False
    name = node.id
    return (
        name in {"db", "session", "db_session", "sync_conn", "conn"}
        or name.endswith("_db")
        or name.endswith("_session")
        or name.endswith("_conn")
    )


class BoundaryChecker(ast.NodeVisitor):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.kind = path.name
        self.violations: list[Violation] = []

    def add(self, node: ast.AST, message: str) -> None:
        self.violations.append(
            Violation(
                path=self.path,
                lineno=getattr(node, "lineno", 1),
                message=message,
            )
        )

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        imported = {alias.name for alias in node.names}

        if self.kind == "api.py":
            if module.startswith("proliferate.db.store"):
                self.add(node, "api.py must not import db/store modules")
            if module == "proliferate.db.engine" and imported & BANNED_ENGINE_IMPORTS:
                self.add(node, "api.py must not import DB session helpers")
            if module.startswith("sqlalchemy"):
                self.add(node, "api.py must not import SQLAlchemy")
            if module.startswith("proliferate.db.models"):
                allowed_module, allowed_name = ALLOWED_API_ORM_IMPORT
                if not (module == allowed_module and imported <= {allowed_name}):
                    self.add(node, "api.py may only import User from proliferate.db.models.auth")
        else:
            if module.startswith("sqlalchemy"):
                self.add(node, "non-store backend modules must not import SQLAlchemy")
            if module == "proliferate.db.engine" and imported & BANNED_ENGINE_IMPORTS:
                self.add(node, "non-store backend modules must not import DB session helpers")
            if module.startswith("sqlalchemy") and imported & BANNED_QUERY_IMPORTS:
                self.add(node, "non-store backend modules must not import SQLAlchemy query builders")

        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name.startswith("sqlalchemy"):
                message = (
                    "api.py must not import SQLAlchemy"
                    if self.kind == "api.py"
                    else "non-store backend modules must not import SQLAlchemy"
                )
                self.add(node, message)
            if self.kind == "api.py" and alias.name.startswith("proliferate.db.models"):
                self.add(node, "api.py may only import User from proliferate.db.models.auth")
            if self.kind == "api.py" and alias.name.startswith("proliferate.db.store"):
                self.add(node, "api.py must not import db/store modules")
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._check_function_annotations(node)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._check_function_annotations(node)
        self.generic_visit(node)

    def _check_function_annotations(
        self,
        node: ast.FunctionDef | ast.AsyncFunctionDef,
    ) -> None:
        for arg in [
            *node.args.args,
            *node.args.kwonlyargs,
        ]:
            if annotation_mentions_banned_name(arg.annotation):
                message = (
                    "api.py must not declare DB session arguments"
                    if self.kind == "api.py"
                    else "non-store backend modules must not declare DB session arguments"
                )
                self.add(arg, message)
        if node.args.vararg and annotation_mentions_banned_name(node.args.vararg.annotation):
            self.add(node.args.vararg, "variadic DB session arguments are not allowed")
        if node.args.kwarg and annotation_mentions_banned_name(node.args.kwarg.annotation):
            self.add(node.args.kwarg, "keyword DB session arguments are not allowed")
        if annotation_mentions_banned_name(node.returns):
            self.add(node, "DB session types are not allowed in return annotations")

    def visit_Name(self, node: ast.Name) -> None:
        if node.id in BANNED_TYPE_NAMES:
            message = (
                "api.py must not reference DB session types"
                if self.kind == "api.py"
                else "non-store backend modules must not reference DB session types"
            )
            self.add(node, message)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        if isinstance(func, ast.Attribute):
            if func.attr in BANNED_SESSION_METHODS and looks_like_db_handle(func.value):
                self.add(
                    node,
                    f"non-store backend modules must not call session method .{func.attr}()",
                )
        self.generic_visit(node)


def check_paths(paths: list[Path]) -> list[Violation]:
    violations: list[Violation] = []
    for path in paths:
        checker = BoundaryChecker(path)
        tree = ast.parse(path.read_text(), filename=str(path))
        checker.visit(tree)
        violations.extend(checker.violations)
    return violations


def main() -> int:
    paths = iter_target_files(REPO_ROOT)
    violations = check_paths(paths)
    if not violations:
        print("Server boundary check passed.")
        return 0

    for violation in sorted(violations, key=lambda item: item.format(REPO_ROOT)):
        print(violation.format(REPO_ROOT))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
