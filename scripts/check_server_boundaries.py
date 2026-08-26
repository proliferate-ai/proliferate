#!/usr/bin/env python3
"""Enforce the server grid coordinate boundaries recorded under lints/server/.

The rule statements, rationales, and grandfathered sites are canonical in the
TOML records (see lints/README.md); this module is only the detection engine.
Every diagnostic is rendered from the record through
``lint_records.render_diagnostic``.
"""

from __future__ import annotations

import ast
import os
import shutil
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402 - repo-root bootstrap above

# Every rule id this checker emits. Each must have a record under lints/server/.
OWNED_RULE_IDS = (
    "SRV-API-1",
    "SRV-API-2",
    "SRV-API-3",
    "SRV-API-4",
    "SRV-API-5",
    "SRV-SVC-1",
    "SRV-SVC-2",
    "SRV-SVC-3",
    "SRV-SVC-4",
    "SRV-STORE-1",
    "SRV-STORE-2",
    "SRV-STORE-3",
    "SRV-STORE-4",
    "SRV-STORE-5",
    "SRV-DOMAIN-1",
    "SRV-DOMAIN-2",
    "SRV-DOMAIN-3",
    "SRV-ERR-1",
    "SRV-MODELS-1",
    "SRV-MODELS-2",
    "SRV-MODELS-3",
    "SRV-INTEG-1",
    "SRV-INTEG-2",
    "SRV-INTEG-3",
    "SRV-INTEG-4",
    "SRV-STRUCT-1",
    "SRV-STRUCT-2",
    "SRV-STRUCT-3",
    "SRV-STRUCT-4",
    "SRV-MIGRATE-1",
)

CHECK_ROOTS = [
    REPO_ROOT / "server" / "proliferate" / "background",
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
ALLOWED_WORKER_SERVICE_SQLALCHEMY_TYPE_IMPORTS = {
    "AsyncSession",
    "async_sessionmaker",
}
SERVICE_DB_METHODS = {"execute", "commit", "rollback", "add", "delete", "refresh"}
WORKER_SERVICE_DB_METHODS = SERVICE_DB_METHODS | {
    "add_all",
    "connection",
    "flush",
    "get",
    "get_one",
    "merge",
    "run_sync",
    "scalar",
    "scalars",
    "stream",
    "stream_scalars",
}
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
# Named product concerns that own service orchestration outside a generic
# service.py retain the same database-boundary rules even when relocated.
OWNED_SERVICE_CONCERN_FILES = {"workflow_runtime.py"}
# Lane 6 split service.py into top-level agent-auth concern modules. Until those
# concerns move to documented subdomains or entry points, keep service boundary
# debt visible for the same layer law that applies to service.py.
AGENT_AUTH_SERVICE_CONCERN_EXCLUDED_FILES = {
    "__init__.py",
    "api.py",
    "errors.py",
    "models.py",
    "reconciler.py",
}
SERVICE_BOUNDARY_DEBT_MODULES: set[str] = set()


@dataclass(frozen=True)
class NamedStoreBoundary:
    store_module: str
    protected_symbols: frozenset[str]
    owner_label: str
    product_owner_prefix: tuple[str, ...]
    persistence_owner_paths: frozenset[str]
    owner_service_hint: str


NAMED_STORE_BOUNDARIES: dict[str, NamedStoreBoundary] = {
    "proliferate.db.store.organizations": NamedStoreBoundary(
        store_module="proliferate.db.store.organizations",
        protected_symbols=frozenset(
            {
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
            }
        ),
        owner_label="Organization",
        product_owner_prefix=(
            "server",
            "proliferate",
            "server",
            "organizations",
        ),
        persistence_owner_paths=frozenset(
            {
                "server/proliferate/db/store/organization_invitations.py",
                "server/proliferate/db/store/organizations.py",
            }
        ),
        owner_service_hint="proliferate.server.organizations.service",
    ),
    "proliferate.db.store.organization_invitations": NamedStoreBoundary(
        store_module="proliferate.db.store.organization_invitations",
        protected_symbols=frozenset(
            {
                "accept_pending_invitation_for_organization_email",
                "create_or_rotate_organization_invitation",
                "mark_invitation_delivery",
            }
        ),
        owner_label="Organization",
        product_owner_prefix=(
            "server",
            "proliferate",
            "server",
            "organizations",
        ),
        persistence_owner_paths=frozenset(
            {
                "server/proliferate/db/store/organization_invitations.py",
                "server/proliferate/db/store/organizations.py",
            }
        ),
        owner_service_hint="proliferate.server.organizations.service",
    ),
}


@dataclass(frozen=True)
class Violation:
    """One detected violation, keyed on a line-number-free site fingerprint."""

    rule_id: str
    path: Path
    lineno: int
    site: str
    detail: str = ""

    def relative_path(self, repo_root: Path = REPO_ROOT) -> str:
        try:
            return self.path.relative_to(repo_root).as_posix()
        except ValueError:
            return self.path.as_posix()

    def key(self, repo_root: Path = REPO_ROOT) -> tuple[str, str, str]:
        return (self.rule_id, self.relative_path(repo_root), self.site)

    def format(self, repo_root: Path = REPO_ROOT) -> str:
        rule = ruleset().rule(self.rule_id)
        location = f"{self.relative_path(repo_root)}:{self.lineno}"
        detail = self.detail or self.site
        return lint_records.render_diagnostic(rule, location, detail)


_RULESET: lint_records.RuleSet | None = None


def ruleset() -> lint_records.RuleSet:
    """The loaded lints/ records; loaded once per process."""
    global _RULESET
    if _RULESET is None:
        _RULESET = lint_records.load()
        for rule_id in OWNED_RULE_IDS:
            _RULESET.rule(rule_id)
    return _RULESET


# ── Site fingerprints ────────────────────────────────────────────────────────
# A site names WHERE inside a file a violation sits, without a line number, so
# an exception entry survives edits above it. The anchor is the enclosing
# symbol chain plus the control-flow branch path; the suffix names the matched
# import, call, or module.

MODULE_ANCHOR = "<module>"


def _handler_label(handler: ast.ExceptHandler) -> str:
    if handler.type is None:
        return "except"
    return f"except:{ast.unparse(handler.type)}"


_BRANCH_NODES = (ast.Try, ast.If, ast.With, ast.AsyncWith, ast.For, ast.AsyncFor, ast.While)


def anchor_map(tree: ast.AST) -> dict[int, str]:
    """Map each node to its enclosing symbol + control-flow branch anchor."""
    anchors: dict[int, str] = {}

    def walk(node: ast.AST, symbols: tuple[str, ...], branch: tuple[str, ...]) -> None:
        for field_name, value in ast.iter_fields(node):
            children = value if isinstance(value, list) else [value]
            for child in children:
                if not isinstance(child, ast.AST):
                    continue
                next_symbols, next_branch = symbols, branch
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    next_symbols, next_branch = (*symbols, child.name), ()
                elif isinstance(child, ast.ExceptHandler):
                    next_branch = (*branch, _handler_label(child))
                elif isinstance(node, _BRANCH_NODES):
                    label = type(node).__name__.lower().removeprefix("async")
                    if field_name == "orelse":
                        label = f"{label}-else"
                    elif field_name == "finalbody":
                        label = "finally"
                    next_branch = (*branch, label)
                parts = (*next_symbols, *next_branch)
                anchors[id(child)] = "/".join(parts) if parts else MODULE_ANCHOR
                walk(child, next_symbols, next_branch)

    anchors[id(tree)] = MODULE_ANCHOR
    walk(tree, (), ())
    return anchors


@dataclass(frozen=True)
class SourceKind:
    is_api: bool = False
    is_service: bool = False
    is_worker_service: bool = False
    is_service_boundary_debt: bool = False
    is_domain: bool = False
    is_product_models: bool = False
    is_store: bool = False
    is_orm_model: bool = False
    is_integration: bool = False
    is_product: bool = False
    is_migration: bool = False


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


def iter_migration_files(repo_root: Path) -> list[Path]:
    migration_root = repo_root / "server" / "alembic" / "versions"
    if not migration_root.is_dir():
        return []
    return sorted(migration_root.glob("*.py"))


def iter_named_write_target_files(repo_root: Path) -> list[Path]:
    root = repo_root / "server" / "proliferate"
    if not root.is_dir():
        return []
    return [path for path in sorted(root.rglob("*.py")) if not should_skip(path)]


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


def is_canonical_worker_service_path(path: Path) -> bool:
    parts = logical_parts(path)
    return (
        len(parts) == 6
        and _starts_with(parts, ("server", "proliferate", "server"))
        and parts[4:] == ("worker", "service.py")
    )


def classify_path(path: Path) -> SourceKind:
    parts = logical_parts(path)
    is_product = _starts_with(parts, ("server", "proliferate", "server"))
    is_store = _starts_with(parts, ("server", "proliferate", "db", "store"))
    is_orm_model = _starts_with(parts, ("server", "proliferate", "db", "models"))
    is_integration = _starts_with(parts, ("server", "proliferate", "integrations"))
    is_migration = _starts_with(parts, ("server", "alembic", "versions"))
    name = path.name
    relative = relative_path(path)
    is_agent_auth_service_concern = (
        _starts_with(
            parts,
            ("server", "proliferate", "server", "cloud", "agent_auth"),
        )
        and len(parts) == 6
        and path.suffix == ".py"
        and name not in AGENT_AUTH_SERVICE_CONCERN_EXCLUDED_FILES
    )
    is_worker_service = is_canonical_worker_service_path(path)

    return SourceKind(
        is_api=is_product and name == "api.py",
        is_service=(
            is_product
            and (
                name == "service.py"
                or name in OWNED_SERVICE_CONCERN_FILES
                or is_agent_auth_service_concern
            )
        ),
        is_worker_service=is_worker_service,
        is_service_boundary_debt=relative in SERVICE_BOUNDARY_DEBT_MODULES,
        is_domain=is_product and "domain" in path.parts,
        is_product_models=is_product and name == "models.py",
        is_store=is_store,
        is_orm_model=is_orm_model,
        is_integration=is_integration,
        is_product=is_product,
        is_migration=is_migration,
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
    return path.suffix == ".py" and path.name.startswith("_") and not path.name.startswith("__")


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


def is_allowed_single_file_worker_folder(
    folder: Path,
    source_files: list[Path],
    child_folders: list[Path],
) -> bool:
    return (
        len(source_files) == 1
        and source_files[0].name == "service.py"
        and is_canonical_worker_service_path(source_files[0])
        and not child_folders
    )


def is_background_tasks_folder(folder: Path) -> bool:
    parts = logical_parts(folder)
    return _starts_with(parts, ("server", "proliferate", "background", "tasks"))


def import_site_suffix(module: str, names: set[str]) -> str:
    if names == {"*"}:
        return f"import:{module}"
    return f"import:{module}:{','.join(sorted(names))}"


class BoundaryChecker(ast.NodeVisitor):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.kind = classify_path(path)
        self.violations: list[Violation] = []
        self.anchors: dict[int, str] = {}

    def check(self, tree: ast.Module) -> list[Violation]:
        self.anchors = anchor_map(tree)
        self.visit(tree)
        return self.violations

    def visit(self, node: ast.AST) -> None:
        if not self.anchors:
            # Direct visit() without check(): still fingerprint deterministically.
            self.anchors = anchor_map(node)
        super().visit(node)

    def add(self, node: ast.AST, rule_id: str, suffix: str, detail: str = "") -> None:
        anchor = self.anchors.get(id(node), MODULE_ANCHOR)
        self.violations.append(
            Violation(
                rule_id=rule_id,
                path=self.path,
                lineno=getattr(node, "lineno", 1),
                site=f"{anchor}::{suffix}",
                detail=detail or suffix,
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
        if self.kind.is_service or self.kind.is_service_boundary_debt:
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
        if self.kind.is_migration and is_module(module, "proliferate"):
            self.add(node, "SRV-MIGRATE-1", import_site_suffix(module, names))

    def _check_api_import(self, node: ast.AST, module: str, names: set[str]) -> None:
        suffix = import_site_suffix(module, names)
        if is_module(module, "proliferate.db.store"):
            self.add(node, "SRV-API-1", suffix)
        if is_module(module, "sqlalchemy"):
            allowed = module == ALLOWED_SQLALCHEMY_TYPE_IMPORT[0] and names <= {
                ALLOWED_SQLALCHEMY_TYPE_IMPORT[1]
            }
            if not allowed:
                self.add(node, "SRV-API-2", suffix)
        if module == "proliferate.db.engine":
            forbidden = names - ALLOWED_API_ENGINE_IMPORTS
            if forbidden:
                self.add(node, "SRV-API-3", suffix)
        if module == "proliferate.db" and ("engine" in names or "*" in names):
            self.add(node, "SRV-API-3", suffix)
        if is_module(module, "proliferate.db.models"):
            allowed_module, allowed_name = ALLOWED_API_ORM_IMPORT
            if not (module == allowed_module and names <= {allowed_name}):
                self.add(node, "SRV-API-4", suffix)

    def _check_service_import(self, node: ast.AST, module: str, names: set[str]) -> None:
        suffix = import_site_suffix(module, names)
        if is_module(module, "sqlalchemy"):
            allowed_names = (
                ALLOWED_WORKER_SERVICE_SQLALCHEMY_TYPE_IMPORTS
                if self.kind.is_worker_service
                else {ALLOWED_SQLALCHEMY_TYPE_IMPORT[1]}
            )
            allowed = module == ALLOWED_SQLALCHEMY_TYPE_IMPORT[0] and names <= allowed_names
            if not allowed:
                self.add(node, "SRV-SVC-1", suffix)
        if module == "proliferate.db.engine":
            self.add(node, "SRV-SVC-2", suffix)
        if module == "proliferate.db.session_ops":
            self.add(node, "SRV-SVC-2", suffix)
        if module == "proliferate.db" and (
            "engine" in names or "session_ops" in names or "*" in names
        ):
            self.add(node, "SRV-SVC-2", suffix)
        if is_module(module, "proliferate.db.models"):
            self.add(node, "SRV-SVC-3", suffix)

    def _check_domain_import(self, node: ast.AST, module: str, names: set[str]) -> None:
        suffix = import_site_suffix(module, names)
        forbidden_modules = (
            "fastapi",
            "sqlalchemy",
            "proliferate.config",
            "proliferate.db.models",
            "proliferate.db.store",
            "proliferate.integrations",
        )
        if any(is_module(module, prefix) for prefix in forbidden_modules):
            self.add(node, "SRV-DOMAIN-1", suffix)
        if is_module(module, "proliferate.server") and module.endswith(".service"):
            self.add(node, "SRV-DOMAIN-2", suffix)
        if module == "fastapi" and "HTTPException" in names:
            self.add(node, "SRV-ERR-1", suffix)

    def _check_product_models_import(
        self,
        node: ast.AST,
        module: str,
        names: set[str],
    ) -> None:
        if is_module(module, "proliferate.db.models"):
            self.add(node, "SRV-MODELS-1", import_site_suffix(module, names))

    def _check_store_import(self, node: ast.AST, module: str, names: set[str]) -> None:
        suffix = import_site_suffix(module, names)
        if module == "proliferate.db" and ("engine" in names or "*" in names):
            self.add(node, "SRV-STORE-1", suffix)
        if module == "proliferate.db.engine":
            self.add(node, "SRV-STORE-1", suffix)
        if is_module(module, "fastapi"):
            self.add(node, "SRV-STORE-2", suffix)
        if is_module(module, "proliferate.integrations"):
            self.add(node, "SRV-STORE-2", suffix)
        if is_module(module, "proliferate.server"):
            self.add(node, "SRV-STORE-2", suffix)

    def _check_orm_model_import(self, node: ast.AST, module: str) -> None:
        forbidden_modules = (
            "proliferate.db.store",
            "proliferate.server",
            "proliferate.integrations",
        )
        if any(is_module(module, prefix) for prefix in forbidden_modules):
            self.add(node, "SRV-MODELS-3", f"import:{module}")

    def _check_integration_import(self, node: ast.AST, module: str, names: set[str]) -> None:
        suffix = import_site_suffix(module, names)
        if is_module(module, "proliferate.db"):
            self.add(node, "SRV-INTEG-1", suffix)
        if is_module(module, "proliferate.server"):
            self.add(node, "SRV-INTEG-2", suffix)
        if is_module(module, "proliferate.db.store"):
            self.add(node, "SRV-INTEG-3", suffix)
        if module == "fastapi" and "HTTPException" in names:
            self.add(node, "SRV-ERR-1", suffix)

    def _check_product_raw_access_import(self, node: ast.AST, module: str) -> None:
        top_level = module.split(".", 1)[0]
        if top_level in RAW_HTTP_MODULES:
            self.add(node, "SRV-INTEG-4", f"import:{module}")

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        if self.kind.is_domain and is_public_async_export(node):
            self.add(node, "SRV-DOMAIN-3", f"async-def:{node.name}")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        self._check_call(node)
        self.generic_visit(node)

    def _check_call(self, node: ast.Call) -> None:
        func = node.func
        if isinstance(func, ast.Attribute):
            receiver = func.value.id if isinstance(func.value, ast.Name) else "<expr>"
            call_suffix = f"{receiver}.{func.attr}"
            if (
                self.kind.is_api
                and func.attr in API_DB_METHODS
                and looks_like_db_handle(func.value)
            ):
                self.add(node, "SRV-API-5", call_suffix, detail=f"await {call_suffix}()")
            service_db_methods = (
                WORKER_SERVICE_DB_METHODS if self.kind.is_worker_service else SERVICE_DB_METHODS
            )
            if (
                (self.kind.is_service or self.kind.is_service_boundary_debt)
                and func.attr in service_db_methods
                and looks_like_db_handle(func.value)
            ):
                self.add(node, "SRV-SVC-4", call_suffix, detail=f"await {call_suffix}()")
            if (
                (self.kind.is_service or self.kind.is_service_boundary_debt)
                and func.attr in SERVICE_DB_SESSION_OPS_METHODS
                and isinstance(func.value, ast.Name)
                and func.value.id in {"db_session", "session_ops"}
            ):
                self.add(
                    node,
                    "SRV-SVC-4",
                    call_suffix,
                    detail=f"session boundary helper {call_suffix}()",
                )
            if (
                self.kind.is_store
                and func.attr in STORE_FORBIDDEN_SESSION_METHODS
                and looks_like_db_handle(func.value)
            ):
                self.add(node, "SRV-STORE-3", call_suffix, detail=f"await {call_suffix}()")
            if (
                self.kind.is_store
                and func.attr == "async_session_factory"
                and isinstance(func.value, ast.Name)
            ):
                self.add(node, "SRV-STORE-4", call_suffix, detail=f"{call_suffix}()")
        if isinstance(func, ast.Name):
            if self.kind.is_store and func.id == "async_session_factory":
                self.add(
                    node,
                    "SRV-STORE-4",
                    "async_session_factory",
                    detail="async_session_factory()",
                )
            if func.id == "ConfigDict" and self.kind.is_product_models:
                for keyword in node.keywords:
                    if keyword.arg == "from_attributes":
                        self.add(
                            node,
                            "SRV-MODELS-2",
                            "ConfigDict.from_attributes",
                            detail="ConfigDict(from_attributes=...)",
                        )
        if (
            isinstance(func, ast.Name)
            and func.id == "HTTPException"
            and (self.kind.is_domain or self.kind.is_store or self.kind.is_integration)
        ):
            self.add(node, "SRV-ERR-1", "raise:HTTPException", detail="HTTPException(...)")


def _dotted_name(node: ast.AST) -> tuple[str, ...] | None:
    if isinstance(node, ast.Name):
        return (node.id,)
    if isinstance(node, ast.Attribute):
        prefix = _dotted_name(node.value)
        if prefix is not None:
            return (*prefix, node.attr)
    return None


class NamedCrossDomainWriteChecker(ast.NodeVisitor):
    def __init__(self, path: Path, repo_root: Path) -> None:
        self.path = path
        self.repo_root = repo_root
        self.module_aliases: dict[str, set[str]] = defaultdict(set)
        self.imported_modules: set[str] = set()
        self.violations: list[Violation] = []
        self.anchors: dict[int, str] = {}

    def check(self, tree: ast.Module) -> list[Violation]:
        self.anchors = anchor_map(tree)
        self._collect_import_bindings(tree)
        self.visit(tree)
        return self.violations

    def _collect_import_bindings(self, tree: ast.Module) -> None:
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                self._collect_import_from(node)
            elif isinstance(node, ast.Import):
                self._collect_import(node)

    def _collect_import_from(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        boundary = NAMED_STORE_BOUNDARIES.get(module)
        if boundary is not None:
            for alias in node.names:
                if alias.name == "*":
                    for symbol in sorted(boundary.protected_symbols):
                        self._add(node, boundary, symbol)
                elif alias.name in boundary.protected_symbols:
                    self._add(node, boundary, alias.name)

        for alias in node.names:
            imported_module = f"{module}.{alias.name}" if module else alias.name
            if imported_module in NAMED_STORE_BOUNDARIES:
                local_name = alias.asname or alias.name
                self.module_aliases[local_name].add(imported_module)

    def _collect_import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name not in NAMED_STORE_BOUNDARIES:
                continue
            if alias.asname is not None:
                self.module_aliases[alias.asname].add(alias.name)
            else:
                self.imported_modules.add(alias.name)

    def _is_owner(self, boundary: NamedStoreBoundary) -> bool:
        try:
            relative = self.path.relative_to(self.repo_root)
        except ValueError:
            return False
        if _starts_with(relative.parts, boundary.product_owner_prefix):
            return True
        return relative.as_posix() in boundary.persistence_owner_paths

    def _add(
        self,
        node: ast.AST,
        boundary: NamedStoreBoundary,
        symbol: str,
    ) -> None:
        if self._is_owner(boundary):
            return
        qualified_symbol = f"{boundary.store_module}.{symbol}"
        anchor = self.anchors.get(id(node), MODULE_ANCHOR)
        self.violations.append(
            Violation(
                rule_id="SRV-STORE-5",
                path=self.path,
                lineno=getattr(node, "lineno", 1),
                site=f"{anchor}::write:{qualified_symbol}",
                detail=(
                    f"{qualified_symbol} is a protected {boundary.owner_label} "
                    "store mutation; cross-domain callers must use "
                    f"{boundary.owner_service_hint}"
                ),
            )
        )

    def _resolve_store_modules(self, node: ast.AST) -> set[str]:
        dotted = _dotted_name(node)
        if dotted is None:
            return set()
        if len(dotted) == 1:
            return set(self.module_aliases.get(dotted[0], set()))
        full_module = ".".join(dotted)
        if full_module in self.imported_modules:
            return {full_module}
        return set()

    def visit_Attribute(self, node: ast.Attribute) -> None:
        dotted = _dotted_name(node)
        if dotted is not None and len(dotted) >= 2:
            symbol = dotted[-1]
            candidate_modules: set[str] = set()
            if len(dotted) == 2:
                candidate_modules.update(self.module_aliases.get(dotted[0], set()))
            full_module = ".".join(dotted[:-1])
            if full_module in self.imported_modules:
                candidate_modules.add(full_module)

            for module in sorted(candidate_modules):
                boundary = NAMED_STORE_BOUNDARIES[module]
                if symbol in boundary.protected_symbols:
                    self._add(node, boundary, symbol)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if (
            isinstance(node.func, ast.Name)
            and node.func.id == "getattr"
            and len(node.args) >= 2
            and isinstance(node.args[1], ast.Constant)
            and isinstance(node.args[1].value, str)
        ):
            symbol = node.args[1].value
            for module in sorted(self._resolve_store_modules(node.args[0])):
                boundary = NAMED_STORE_BOUNDARIES[module]
                if symbol in boundary.protected_symbols:
                    self._add(node, boundary, symbol)
        self.generic_visit(node)


def parse_source(path: Path) -> ast.Module:
    return ast.parse(path.read_text(), filename=str(path))


def check_paths(paths: list[Path]) -> list[Violation]:
    violations: list[Violation] = []
    for path in paths:
        checker = BoundaryChecker(path)
        violations.extend(checker.check(parse_source(path)))
    return violations


def check_named_cross_domain_writes(
    paths: list[Path],
    repo_root: Path = REPO_ROOT,
) -> list[Violation]:
    violations: list[Violation] = []
    for path in paths:
        tree = parse_source(path)
        checker = NamedCrossDomainWriteChecker(path, repo_root)
        violations.extend(checker.check(tree))
    return violations


def check_structure(repo_root: Path = REPO_ROOT) -> list[Violation]:
    violations: list[Violation] = []

    for path in iter_target_files(repo_root):
        if has_single_underscore_prefix(path):
            violations.append(
                Violation(
                    rule_id="SRV-STRUCT-1",
                    path=path,
                    lineno=1,
                    site=f"module:{path.name}",
                    detail=f"module name {path.name}",
                )
            )
        if path.name.endswith("_service.py"):
            violations.append(
                Violation(
                    rule_id="SRV-STRUCT-2",
                    path=path,
                    lineno=1,
                    site=f"module:{path.name}",
                    detail=f"module name {path.name}",
                )
            )
        if is_banned_junk_drawer_module(path):
            violations.append(
                Violation(
                    rule_id="SRV-STRUCT-3",
                    path=path,
                    lineno=1,
                    site=f"module:{path.name}",
                    detail=f"module name {path.name}",
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
        if is_allowed_single_file_worker_folder(folder, source_files, child_folders):
            continue
        if is_background_tasks_folder(folder):
            continue

        if len(source_files) == 1 and not child_folders:
            only_file = source_files[0].name
            violations.append(
                Violation(
                    rule_id="SRV-STRUCT-4",
                    path=folder,
                    lineno=1,
                    site=f"folder:{only_file}",
                    detail=f"folder holds only {only_file}",
                )
            )

    return violations


def disambiguate(
    violations: list[Violation], repo_root: Path = REPO_ROOT
) -> list[Violation]:
    """Give repeated fingerprints an occurrence ordinal, in file order.

    Two hits of the same rule can share a fingerprint — the same matched token
    twice inside one function. The ledger keys on `(path, site)`, so without an
    ordinal the second occurrence would be excused by the first one's entry.
    The ordinal is an occurrence index, not a line number: reformatting does not
    move it, and adding a hit only ever appends a new `#n` site.
    """
    grouped: dict[tuple[str, str, str], list[Violation]] = {}
    for violation in violations:
        grouped.setdefault(violation.key(repo_root), []).append(violation)
    out: list[Violation] = []
    for group in grouped.values():
        if len(group) == 1:
            out.extend(group)
            continue
        for ordinal, violation in enumerate(
            sorted(group, key=lambda item: item.lineno), start=1
        ):
            out.append(
                violation
                if ordinal == 1
                else Violation(
                    rule_id=violation.rule_id,
                    path=violation.path,
                    lineno=violation.lineno,
                    site=f"{violation.site}#{ordinal}",
                    detail=violation.detail,
                )
            )
    return sorted(
        out,
        key=lambda item: (
            item.relative_path(repo_root),
            item.lineno,
            item.rule_id,
            item.site,
        ),
    )


def apply_exceptions(
    violations: list[Violation],
    ledger: lint_records.RuleSet | None = None,
) -> tuple[list[Violation], list[str]]:
    """Split violations into failures and report stale exception entries.

    A ledgered (rule, path, site) triple is tolerated. A ledger entry whose
    site no longer violates is stale and must be deleted in the same change.
    """
    records = ledger if ledger is not None else ruleset()
    observed = {violation.key() for violation in violations}
    failing = [
        violation
        for violation in violations
        if violation.key()[1:] not in records.exception_sites(violation.rule_id)
    ]
    stale = [
        f"{rule_id} {path} {site}"
        for rule_id in OWNED_RULE_IDS
        for path, site in sorted(records.exception_sites(rule_id))
        if (rule_id, path, site) not in observed
    ]
    return failing, sorted(stale)


def reexec_with_python_312() -> None:
    if sys.version_info >= (3, 12):  # noqa: UP036 - bootstrap may start under older Python
        return
    python_312 = shutil.which("python3.12")
    if python_312 is None:
        return
    if Path(python_312).resolve() == Path(sys.executable).resolve():
        return
    os.execv(python_312, [python_312, *sys.argv])


def main() -> int:
    reexec_with_python_312()
    if sys.version_info < (3, 12):  # noqa: UP036 - emit a useful bootstrap failure
        print("Server boundary check requires Python 3.12+ to parse server source.")
        return 2

    paths = [*iter_target_files(REPO_ROOT), *iter_migration_files(REPO_ROOT)]
    named_write_paths = iter_named_write_target_files(REPO_ROOT)
    violations = disambiguate(
        [
            *check_paths(paths),
            *check_named_cross_domain_writes(named_write_paths),
            *check_structure(REPO_ROOT),
        ]
    )
    failing, stale = apply_exceptions(violations)

    if not failing and not stale:
        print("Server boundary check passed.")
        return 0

    if failing:
        print("Server boundary violations with no exception-ledger entry:")
        for violation in sorted(failing, key=lambda item: item.key()):
            print(violation.format())
            print()

    if stale:
        print(
            "Stale exception entries in lints/server/exceptions.toml — these sites "
            "no longer violate; delete the entries in this change:"
        )
        for entry in stale:
            print(f"  {entry}")

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
