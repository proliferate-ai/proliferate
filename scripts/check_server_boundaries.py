#!/usr/bin/env python3

from __future__ import annotations

import ast
from collections import Counter, defaultdict
from dataclasses import dataclass
import os
from pathlib import Path
import shutil
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "server_boundaries_allowlist.txt"
CHECK_ROOTS = [
    REPO_ROOT / "server" / "proliferate" / "server",
    REPO_ROOT / "server" / "proliferate" / "auth",
    REPO_ROOT / "server" / "proliferate" / "db" / "models",
    REPO_ROOT / "server" / "proliferate" / "db" / "store",
    REPO_ROOT / "server" / "proliferate" / "integrations",
]
EXCLUDED_PARTS = {"__pycache__", "alembic", "migrations"}
STRUCTURE_ROOTS = CHECK_ROOTS
DUNDER_MODULES = {"__init__.py", "__main__.py"}
BANNED_JUNK_DRAWER_MODULES = {
    "common.py",
    "helper.py",
    "helpers.py",
    "misc.py",
    "utils.py",
}
BANNED_JUNK_DRAWER_SUFFIXES = ("_helper.py", "_helpers.py", "_utils.py")

ALLOWED_API_ORM_IMPORT = ("proliferate.db.models.auth", "User")
ALLOWED_API_ENGINE_IMPORTS = {"get_async_session"}
ALLOWED_SQLALCHEMY_TYPE_IMPORT = ("sqlalchemy.ext.asyncio", "AsyncSession")
SERVICE_DB_METHODS = {"execute", "commit", "rollback", "add", "delete", "refresh"}
SERVICE_DB_SESSION_OPS_METHODS = {
    "open_async_session",
    "open_async_transaction",
    "commit_session",
    "rollback_session",
    "run_after_commit",
    "defer_after_commit",
    "is_integrity_error",
}
API_DB_METHODS = {"execute", "commit", "rollback", "add", "delete", "refresh"}
STORE_FORBIDDEN_SESSION_METHODS = {"commit", "rollback"}
RAW_HTTP_MODULES = {"httpx", "requests"}


@dataclass(frozen=True)
class Violation:
    rule_id: str
    path: Path
    lineno: int
    message: str

    def relative_path(self, repo_root: Path = REPO_ROOT) -> str:
        try:
            return self.path.relative_to(repo_root).as_posix()
        except ValueError:
            return self.path.as_posix()

    def format(self, repo_root: Path = REPO_ROOT) -> str:
        return f"{self.relative_path(repo_root)}:{self.lineno}: [{self.rule_id}] {self.message}"


@dataclass(frozen=True)
class AllowlistEntry:
    rule_id: str
    path: str
    count: int
    reason: str


@dataclass(frozen=True)
class SourceKind:
    is_api: bool = False
    is_service: bool = False
    is_domain: bool = False
    is_product_models: bool = False
    is_store: bool = False
    is_orm_model: bool = False
    is_integration: bool = False
    is_product: bool = False


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


def iter_structure_folders(repo_root: Path) -> list[Path]:
    folders: set[Path] = set()
    for root in STRUCTURE_ROOTS:
        if not root.is_dir():
            continue
        folders.add(root)
        for path in sorted(root.rglob("*")):
            if path.is_dir() and not should_skip(path):
                folders.add(path)
    return sorted(folders)


def relative_path(path: Path, repo_root: Path = REPO_ROOT) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return path.as_posix()


def logical_parts(path: Path) -> tuple[str, ...]:
    try:
        return Path(path.relative_to(REPO_ROOT)).parts
    except ValueError:
        path_parts = path.parts
        marker = ("server", "proliferate")
        width = len(marker)
        for index in range(len(path_parts) - width + 1):
            if path_parts[index : index + width] == marker:
                return path_parts[index:]
    return path.parts


def _starts_with(parts: tuple[str, ...], prefix: tuple[str, ...]) -> bool:
    return parts[: len(prefix)] == prefix


def classify_path(path: Path) -> SourceKind:
    parts = logical_parts(path)
    is_product = _starts_with(parts, ("server", "proliferate", "server"))
    is_store = _starts_with(parts, ("server", "proliferate", "db", "store"))
    is_orm_model = _starts_with(parts, ("server", "proliferate", "db", "models"))
    is_integration = _starts_with(parts, ("server", "proliferate", "integrations"))
    name = path.name

    return SourceKind(
        is_api=is_product and name == "api.py",
        is_service=is_product and name == "service.py",
        is_domain=is_product and "domain" in path.parts,
        is_product_models=is_product and name == "models.py",
        is_store=is_store,
        is_orm_model=is_orm_model,
        is_integration=is_integration,
        is_product=is_product,
    )


def is_module(module: str, prefix: str) -> bool:
    return module == prefix or module.startswith(f"{prefix}.")


def imported_names(node: ast.ImportFrom) -> set[str]:
    return {alias.name for alias in node.names}


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


def is_public_async_export(node: ast.AsyncFunctionDef) -> bool:
    return not node.name.startswith("_")


def is_dunder_module(path: Path) -> bool:
    return path.name in DUNDER_MODULES


def has_single_underscore_prefix(path: Path) -> bool:
    return (
        path.suffix == ".py"
        and path.name.startswith("_")
        and not path.name.startswith("__")
    )


def is_banned_junk_drawer_module(path: Path) -> bool:
    return path.name in BANNED_JUNK_DRAWER_MODULES or path.name.endswith(
        BANNED_JUNK_DRAWER_SUFFIXES
    )


def is_product_domain_folder(folder: Path) -> bool:
    parts = logical_parts(folder)
    return _starts_with(parts, ("server", "proliferate", "server")) and folder.name == "domain"


def is_meaningful_domain_module(path: Path) -> bool:
    return (
        path.suffix == ".py"
        and not has_single_underscore_prefix(path)
        and not path.name.endswith("_service.py")
        and not is_banned_junk_drawer_module(path)
    )


def is_allowed_single_file_domain_folder(
    folder: Path,
    source_files: list[Path],
    child_folders: list[Path],
) -> bool:
    return (
        is_product_domain_folder(folder)
        and len(source_files) == 1
        and not child_folders
        and is_meaningful_domain_module(source_files[0])
    )


class BoundaryChecker(ast.NodeVisitor):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.kind = classify_path(path)
        self.violations: list[Violation] = []

    def add(self, node: ast.AST, rule_id: str, message: str) -> None:
        self.violations.append(
            Violation(
                rule_id=rule_id,
                path=self.path,
                lineno=getattr(node, "lineno", 1),
                message=message,
            )
        )

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        names = imported_names(node)
        self._check_import(node, module, names)
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._check_import(node, alias.name, {"*"})
        self.generic_visit(node)

    def _check_import(
        self,
        node: ast.AST,
        module: str,
        names: set[str],
    ) -> None:
        if self.kind.is_api:
            self._check_api_import(node, module, names)
        if self.kind.is_service:
            self._check_service_import(node, module, names)
        if self.kind.is_domain:
            self._check_domain_import(node, module, names)
        if self.kind.is_product_models:
            self._check_product_models_import(node, module, names)
        if self.kind.is_store:
            self._check_store_import(node, module, names)
        if self.kind.is_orm_model:
            self._check_orm_model_import(node, module)
        if self.kind.is_integration:
            self._check_integration_import(node, module, names)
        if self.kind.is_product:
            self._check_product_raw_access_import(node, module)

    def _check_api_import(self, node: ast.AST, module: str, names: set[str]) -> None:
        if is_module(module, "proliferate.db.store"):
            self.add(node, "API_STORE_IMPORT", "api.py must not import db/store modules")
        if is_module(module, "sqlalchemy"):
            allowed = module == ALLOWED_SQLALCHEMY_TYPE_IMPORT[0] and names <= {
                ALLOWED_SQLALCHEMY_TYPE_IMPORT[1]
            }
            if not allowed:
                self.add(node, "API_SQLALCHEMY_IMPORT", "api.py must not import SQLAlchemy")
        if module == "proliferate.db.engine":
            forbidden = names - ALLOWED_API_ENGINE_IMPORTS
            if forbidden:
                self.add(
                    node,
                    "API_DB_ENGINE_IMPORT",
                    "api.py may import get_async_session only for Depends(...) injection",
                )
        if module == "proliferate.db" and ("engine" in names or "*" in names):
            self.add(
                node,
                "API_DB_ENGINE_IMPORT",
                "api.py may import get_async_session only for Depends(...) injection",
            )
        if is_module(module, "proliferate.db.models"):
            allowed_module, allowed_name = ALLOWED_API_ORM_IMPORT
            if not (module == allowed_module and names <= {allowed_name}):
                self.add(
                    node,
                    "API_ORM_IMPORT",
                    "api.py may only import User from proliferate.db.models.auth",
                )

    def _check_service_import(self, node: ast.AST, module: str, names: set[str]) -> None:
        if is_module(module, "sqlalchemy"):
            allowed = module == ALLOWED_SQLALCHEMY_TYPE_IMPORT[0] and names <= {
                ALLOWED_SQLALCHEMY_TYPE_IMPORT[1]
            }
            if not allowed:
                self.add(
                    node,
                    "SERVICE_SQLALCHEMY_IMPORT",
                    "service.py must not import SQLAlchemy query/building APIs",
                )
        if module == "proliferate.db.engine":
            self.add(
                node,
                "SERVICE_DB_ENGINE_IMPORT",
                "service.py must not import DB session entrypoint helpers",
            )
        if module == "proliferate.db.session_ops":
            self.add(
                node,
                "SERVICE_DB_ENGINE_IMPORT",
                "service.py must not import DB session entrypoint helpers",
            )
        if module == "proliferate.db" and (
            "engine" in names or "session_ops" in names or "*" in names
        ):
            self.add(
                node,
                "SERVICE_DB_ENGINE_IMPORT",
                "service.py must not import DB session entrypoint helpers",
            )
        if is_module(module, "proliferate.db.models"):
            self.add(
                node,
                "SERVICE_ORM_IMPORT",
                "service.py must not import ORM models directly",
            )

    def _check_domain_import(self, node: ast.AST, module: str, names: set[str]) -> None:
        forbidden_modules = (
            "fastapi",
            "sqlalchemy",
            "proliferate.config",
            "proliferate.db.models",
            "proliferate.db.store",
            "proliferate.integrations",
        )
        if any(is_module(module, prefix) for prefix in forbidden_modules):
            self.add(
                node,
                "DOMAIN_FORBIDDEN_IMPORT",
                "domain modules must be pure and must not import framework, "
                "DB, config, or integration modules",
            )
        if is_module(module, "proliferate.server") and module.endswith(".service"):
            self.add(
                node,
                "DOMAIN_SERVICE_IMPORT",
                "domain modules must not import service.py",
            )
        if module == "fastapi" and "HTTPException" in names:
            self.add(
                node,
                "HTTP_EXCEPTION_FORBIDDEN",
                "HTTPException is banned outside HTTP boundary code",
            )

    def _check_product_models_import(
        self,
        node: ast.AST,
        module: str,
        names: set[str],
    ) -> None:
        if is_module(module, "proliferate.db.models"):
            self.add(
                node,
                "MODELS_ORM_IMPORT",
                "server/<domain>/models.py must not import ORM models",
            )

    def _check_store_import(self, node: ast.AST, module: str, names: set[str]) -> None:
        if module == "proliferate.db" and ("engine" in names or "*" in names):
            self.add(
                node,
                "STORE_SESSION_FACTORY_IMPORT",
                "store modules must not import DB session factories",
            )
        if module == "proliferate.db.engine":
            self.add(
                node,
                "STORE_SESSION_FACTORY_IMPORT",
                "store modules must not import DB session factories",
            )
        if is_module(module, "fastapi"):
            self.add(node, "STORE_FORBIDDEN_IMPORT", "store modules must not import FastAPI")
        if is_module(module, "proliferate.integrations"):
            self.add(
                node,
                "STORE_FORBIDDEN_IMPORT",
                "store modules must not import integrations",
            )
        if is_module(module, "proliferate.server"):
            self.add(
                node,
                "STORE_FORBIDDEN_IMPORT",
                "store modules must not import product server modules",
            )

    def _check_orm_model_import(self, node: ast.AST, module: str) -> None:
        forbidden_modules = (
            "proliferate.db.store",
            "proliferate.server",
            "proliferate.integrations",
        )
        if any(is_module(module, prefix) for prefix in forbidden_modules):
            self.add(
                node,
                "ORM_MODEL_FORBIDDEN_IMPORT",
                "db/models modules must not import stores, services, or integrations",
            )

    def _check_integration_import(self, node: ast.AST, module: str, names: set[str]) -> None:
        if is_module(module, "proliferate.db"):
            self.add(
                node,
                "INTEGRATION_DB_IMPORT",
                "integrations must not import database modules",
            )
        if is_module(module, "proliferate.server"):
            self.add(
                node,
                "INTEGRATION_PRODUCT_IMPORT",
                "integrations must not import product server domains",
            )
        if is_module(module, "proliferate.db.store"):
            self.add(
                node,
                "INTEGRATION_STORE_IMPORT",
                "integrations must not import db/store modules",
            )
        if module == "fastapi" and "HTTPException" in names:
            self.add(
                node,
                "HTTP_EXCEPTION_FORBIDDEN",
                "HTTPException is banned outside HTTP boundary code",
            )

    def _check_product_raw_access_import(self, node: ast.AST, module: str) -> None:
        top_level = module.split(".", 1)[0]
        if top_level in RAW_HTTP_MODULES:
            self.add(
                node,
                "PRODUCT_RAW_HTTP_IMPORT",
                "product domains must not own raw external HTTP clients",
            )

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        if self.kind.is_domain and is_public_async_export(node):
            self.add(
                node,
                "DOMAIN_ASYNC_EXPORT",
                "domain modules must not export async functions",
            )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        self._check_call(node)
        self.generic_visit(node)

    def _check_call(self, node: ast.Call) -> None:
        func = node.func
        if isinstance(func, ast.Attribute):
            if (
                self.kind.is_api
                and func.attr in API_DB_METHODS
                and looks_like_db_handle(func.value)
            ):
                self.add(
                    node,
                    "API_DB_METHOD_CALL",
                    f"api.py must not call session method .{func.attr}()",
                )
            if (
                self.kind.is_service
                and func.attr in SERVICE_DB_METHODS
                and looks_like_db_handle(func.value)
            ):
                self.add(
                    node,
                    "SERVICE_DB_METHOD_CALL",
                    f"service.py must not call session method .{func.attr}()",
                )
            if (
                self.kind.is_service
                and func.attr in SERVICE_DB_SESSION_OPS_METHODS
                and isinstance(func.value, ast.Name)
                and func.value.id in {"db_session", "session_ops"}
            ):
                self.add(
                    node,
                    "SERVICE_DB_METHOD_CALL",
                    f"service.py must not call session boundary helper .{func.attr}()",
                )
            if (
                self.kind.is_store
                and func.attr in STORE_FORBIDDEN_SESSION_METHODS
                and looks_like_db_handle(func.value)
            ):
                self.add(
                    node,
                    "STORE_COMMIT_ROLLBACK",
                    f"store modules must not call session method .{func.attr}()",
                )
            if (
                self.kind.is_store
                and func.attr == "async_session_factory"
                and isinstance(func.value, ast.Name)
            ):
                self.add(
                    node,
                    "STORE_SESSION_FACTORY_CALL",
                    "store modules must not open DB sessions",
                )
        if isinstance(func, ast.Name):
            if self.kind.is_store and func.id == "async_session_factory":
                self.add(
                    node,
                    "STORE_SESSION_FACTORY_CALL",
                    "store modules must not open DB sessions",
                )
            if func.id == "ConfigDict" and self.kind.is_product_models:
                for keyword in node.keywords:
                    if keyword.arg == "from_attributes":
                        self.add(
                            node,
                            "MODELS_FROM_ATTRIBUTES",
                            "Pydantic response models must not map ORM objects "
                            "with from_attributes",
                        )
        if isinstance(func, ast.Name) and func.id == "HTTPException":
            if self.kind.is_domain or self.kind.is_store or self.kind.is_integration:
                self.add(
                    node,
                    "HTTP_EXCEPTION_FORBIDDEN",
                    "HTTPException is banned outside HTTP boundary code",
                )


def parse_source(path: Path) -> ast.Module:
    return ast.parse(path.read_text(), filename=str(path))


def check_paths(paths: list[Path]) -> list[Violation]:
    violations: list[Violation] = []
    for path in paths:
        checker = BoundaryChecker(path)
        tree = parse_source(path)
        checker.visit(tree)
        violations.extend(checker.violations)
    return violations


def check_structure(repo_root: Path = REPO_ROOT) -> list[Violation]:
    violations: list[Violation] = []

    for path in iter_target_files(repo_root):
        if has_single_underscore_prefix(path):
            violations.append(
                Violation(
                    rule_id="UNDERSCORE_PREFIXED_MODULE",
                    path=path,
                    lineno=1,
                    message="server module names must not start with a single underscore",
                )
            )
        if path.name.endswith("_service.py"):
            violations.append(
                Violation(
                    rule_id="SERVICE_SUFFIX_MODULE",
                    path=path,
                    lineno=1,
                    message="server modules must use service.py, not *_service.py",
                )
            )
        if is_banned_junk_drawer_module(path):
            violations.append(
                Violation(
                    rule_id="JUNK_DRAWER_MODULE",
                    path=path,
                    lineno=1,
                    message=(
                        "server modules must use owned concern names, "
                        "not helper/misc/common/utils names"
                    ),
                )
            )

    for folder in iter_structure_folders(repo_root):
        if should_skip(folder):
            continue
        source_files = [
            path
            for path in folder.iterdir()
            if path.is_file() and path.suffix == ".py" and not is_dunder_module(path)
        ]
        child_folders = [
            path
            for path in folder.iterdir()
            if path.is_dir() and not should_skip(path) and path.name != "__pycache__"
        ]
        if is_allowed_single_file_domain_folder(folder, source_files, child_folders):
            continue

        if len(source_files) == 1 and not child_folders:
            only_file = source_files[0].name
            violations.append(
                Violation(
                    rule_id="SINGLE_FILE_FOLDER",
                    path=folder,
                    lineno=1,
                    message=f"single-file folders are forbidden; inline or promote {only_file}",
                )
            )

    return violations


def load_allowlist(path: Path = ALLOWLIST_PATH) -> dict[tuple[str, str], AllowlistEntry]:
    if not path.exists():
        return {}
    entries: dict[tuple[str, str], AllowlistEntry] = {}
    for line_number, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(maxsplit=3)
        if len(parts) != 4:
            raise ValueError(
                f"{path.relative_to(REPO_ROOT)}:{line_number}: expected RULE_ID path count reason"
            )
        rule_id, entry_path, raw_count, reason = parts
        try:
            count = int(raw_count)
        except ValueError as exc:
            raise ValueError(
                f"{path.relative_to(REPO_ROOT)}:{line_number}: count must be an integer"
            ) from exc
        if count < 1:
            raise ValueError(
                f"{path.relative_to(REPO_ROOT)}:{line_number}: count must be positive"
            )
        key = (rule_id, entry_path)
        if key in entries:
            raise ValueError(
                f"{path.relative_to(REPO_ROOT)}:{line_number}: duplicate allowlist entry"
            )
        entries[key] = AllowlistEntry(
            rule_id=rule_id,
            path=entry_path,
            count=count,
            reason=reason,
        )
    return entries


def apply_allowlist(
    violations: list[Violation],
    allowlist: dict[tuple[str, str], AllowlistEntry],
) -> tuple[list[Violation], list[str]]:
    grouped: dict[tuple[str, str], list[Violation]] = defaultdict(list)
    for violation in violations:
        grouped[(violation.rule_id, violation.relative_path())].append(violation)

    failing: list[Violation] = []
    stale: list[str] = []

    for key, group in grouped.items():
        entry = allowlist.get(key)
        if entry is None:
            failing.extend(group)
            continue
        if len(group) > entry.count:
            failing.extend(group[entry.count :])

    for key, entry in allowlist.items():
        observed = len(grouped.get(key, []))
        if observed < entry.count:
            stale.append(
                f"{entry.rule_id} {entry.path} allowlisted={entry.count} observed={observed}"
            )
        elif not (REPO_ROOT / entry.path).exists():
            stale.append(
                f"{entry.rule_id} {entry.path} allowlisted={entry.count} observed=missing-file"
            )

    return failing, stale


def print_summary(
    violations: list[Violation],
    allowlist: dict[tuple[str, str], AllowlistEntry],
) -> None:
    observed = Counter(
        (violation.rule_id, violation.relative_path()) for violation in violations
    )
    if not observed:
        return
    print("Observed server boundary debt:")
    for (rule_id, path), count in sorted(observed.items()):
        entry = allowlist.get((rule_id, path))
        suffix = f" allowlisted={entry.count}" if entry else " unallowlisted"
        print(f"  {rule_id} {path}: {count}{suffix}")
    print()


def reexec_with_python_312() -> None:
    if sys.version_info >= (3, 12):
        return
    python_312 = shutil.which("python3.12")
    if python_312 is None:
        return
    if Path(python_312).resolve() == Path(sys.executable).resolve():
        return
    os.execv(python_312, [python_312, *sys.argv])


def main() -> int:
    reexec_with_python_312()
    if sys.version_info < (3, 12):
        print("Server boundary check requires Python 3.12+ to parse server source.")
        return 2

    paths = iter_target_files(REPO_ROOT)
    allowlist = load_allowlist()
    violations = [*check_paths(paths), *check_structure(REPO_ROOT)]
    failing, stale = apply_allowlist(violations, allowlist)

    if not failing and not stale:
        print("Server boundary check passed.")
        return 0

    print_summary(violations, allowlist)

    if failing:
        print("Server boundary violations not covered by allowlist:")
        for violation in sorted(failing, key=lambda item: item.format()):
            print(violation.format())

    if stale:
        if failing:
            print()
        print("Stale server boundary allowlist entries:")
        for entry in sorted(stale):
            print(f"  {entry}")

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
