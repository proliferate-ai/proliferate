#!/usr/bin/env python3

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
import re
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_SRC = REPO_ROOT / "apps" / "desktop" / "src"
PRODUCT_CLIENT_SRC = REPO_ROOT / "apps" / "packages" / "product-client" / "src"
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "frontend_boundaries_allowlist.txt"
EXTENSIONS = {".ts", ".tsx"}
GENERATED_PREFIXES: set[str] = set()

QUERY_CACHE_METHODS = {
    "cancelQueries",
    "ensureQueryData",
    "fetchInfiniteQuery",
    "fetchQuery",
    "getQueryData",
    "getQueriesData",
    "invalidateQueries",
    "prefetchInfiniteQuery",
    "prefetchQuery",
    "refetchQueries",
    "removeQueries",
    "resetQueries",
    "setQueriesData",
    "setQueryData",
}

OPENAPI_CLIENT_VERB_RE = re.compile(r"\bclient\.(GET|POST|PUT|PATCH|DELETE)\s*\(")
QUERY_CACHE_CALL_RE = re.compile(
    r"\bqueryClient\.("
    + "|".join(sorted(QUERY_CACHE_METHODS))
    + r")\s*\("
)
REACT_IMPORT_RE = re.compile(
    r"^\s*import(?:\s+type)?(?:\s+[^;]*\s+from)?\s+['\"]react['\"]"
)


@dataclass(frozen=True)
class Violation:
    rule_id: str
    path: Path
    lineno: int
    message: str

    @property
    def relative_path(self) -> str:
        return self.path.relative_to(REPO_ROOT).as_posix()

    def format(self) -> str:
        return f"{self.relative_path}:{self.lineno}: [{self.rule_id}] {self.message}"


@dataclass(frozen=True)
class AllowlistEntry:
    rule_id: str
    relative_path: str
    count: int
    reason: str


def strip_line_comment(line: str) -> str:
    return line.split("//", 1)[0]


def should_skip(path: Path) -> bool:
    relative = path.relative_to(REPO_ROOT).as_posix()
    if any(relative.startswith(prefix) for prefix in GENERATED_PREFIXES):
        return True
    name = path.name
    if ".test." in name or ".spec." in name or name.endswith(".d.ts"):
        return True
    return any(part in {"__tests__", "__mocks__"} for part in path.parts)


def iter_frontend_files() -> list[Path]:
    roots = [DESKTOP_SRC, PRODUCT_CLIENT_SRC]
    files: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        files.extend(
            path
            for path in sorted(root.rglob("*"))
            if path.is_file()
            and path.suffix in EXTENSIONS
            and not should_skip(path)
        )
    return files


def relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def is_under(relative_path: str, prefix: str) -> bool:
    return relative_path.startswith(prefix)


def is_tauri_access_path(relative_path: str) -> bool:
    return is_under(relative_path, "apps/desktop/src/lib/access/tauri/")


def is_anyharness_client_path(relative_path: str) -> bool:
    return (
        is_under(relative_path, "apps/desktop/src/lib/access/anyharness/")
        or is_under(relative_path, "apps/desktop/src/hooks/access/anyharness/")
    )


def is_cloud_access_path(relative_path: str) -> bool:
    return is_under(relative_path, "apps/desktop/src/lib/access/cloud/")


def is_query_cache_owner_path(relative_path: str) -> bool:
    return (
        is_under(relative_path, "apps/desktop/src/hooks/access/")
        or is_under(relative_path, "apps/desktop/src/lib/infra/query/")
        or (
            is_under(relative_path, "apps/desktop/src/hooks/")
            and "/cache/" in relative_path
        )
    )


def add_if(
    violations: list[Violation],
    condition: bool,
    rule_id: str,
    path: Path,
    lineno: int,
    message: str,
) -> None:
    if condition:
        violations.append(Violation(rule_id, path, lineno, message))


def check_file(path: Path) -> list[Violation]:
    violations: list[Violation] = []
    rel = relative(path)
    in_domain = is_under(rel, "apps/desktop/src/lib/domain/")
    in_workflows = is_under(rel, "apps/desktop/src/lib/workflows/")
    in_components = is_under(rel, "apps/desktop/src/components/")
    in_stores = is_under(rel, "apps/desktop/src/stores/")
    in_desktop = is_under(rel, "apps/desktop/src/")
    in_product_client = is_under(rel, "apps/packages/product-client/src/")

    for lineno, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = strip_line_comment(raw_line)
        if not line.strip():
            continue

        contains_tauri_api = "@tauri-apps/api" in line
        contains_anyharness_client = "getAnyHarnessClient" in line
        contains_openapi_client_verb = bool(OPENAPI_CLIENT_VERB_RE.search(line))
        contains_use_query_client = "useQueryClient" in line
        contains_query_cache_call = bool(QUERY_CACHE_CALL_RE.search(line))
        contains_react_import = bool(REACT_IMPORT_RE.search(line))
        contains_legacy_access = (
            "@/platform/tauri" in line
            or "@/lib/integrations/cloud" in line
            or "@/lib/integrations/anyharness" in line
        )

        add_if(
            violations,
            in_desktop and contains_tauri_api and not is_tauri_access_path(rel),
            "TAURI_API_OUTSIDE_ACCESS",
            path,
            lineno,
            "Tauri API imports must stay under apps/desktop/src/lib/access/tauri/**",
        )
        add_if(
            violations,
            in_desktop
            and contains_anyharness_client
            and not is_anyharness_client_path(rel),
            "ANYHARNESS_CLIENT_OUTSIDE_ACCESS",
            path,
            lineno,
            "getAnyHarnessClient must stay behind AnyHarness access boundaries",
        )
        add_if(
            violations,
            in_desktop
            and contains_openapi_client_verb
            and not is_cloud_access_path(rel),
            "CLOUD_OPENAPI_CLIENT_OUTSIDE_ACCESS",
            path,
            lineno,
            "raw OpenAPI client verbs must stay under apps/desktop/src/lib/access/cloud/**",
        )
        add_if(
            violations,
            in_desktop
            and (contains_use_query_client or contains_query_cache_call)
            and not is_query_cache_owner_path(rel),
            "QUERY_CLIENT_OUTSIDE_CACHE_OWNER",
            path,
            lineno,
            "React Query client/cache shape must be owned by access hooks, product cache hooks, or lib/infra/query",
        )
        add_if(
            violations,
            in_desktop and contains_legacy_access,
            "LEGACY_ACCESS_IMPORT",
            path,
            lineno,
            "legacy cloud/AnyHarness/Tauri access paths are not allowed",
        )

        if in_product_client:
            add_if(
                violations,
                contains_tauri_api
                or "@tauri-apps/" in line
                or "apps/desktop/" in line
                or "apps/web/" in line
                or "@/" in line,
                "PRODUCT_CLIENT_FORBIDDEN_IMPORT",
                path,
                lineno,
                (
                    "product-client must not import either host (apps/desktop, "
                    "apps/web), Tauri, or Desktop-relative @/ aliases"
                ),
            )

        if in_domain:
            add_if(
                violations,
                (
                    contains_react_import
                    or "@tanstack/react-query" in line
                    or "@/hooks/" in line
                    or "@/stores/" in line
                    or "@/lib/access/" in line
                    or "@/lib/integrations/" in line
                    or contains_tauri_api
                ),
                "DOMAIN_FORBIDDEN_IMPORT",
                path,
                lineno,
                "lib/domain must stay pure: no React, hooks, stores, access, integrations, Tauri, or TanStack Query",
            )

        if in_workflows:
            add_if(
                violations,
                (
                    contains_react_import
                    or "@tanstack/react-query" in line
                    or "@/components/" in line
                    or "@/hooks/" in line
                    or contains_tauri_api
                ),
                "WORKFLOW_FORBIDDEN_IMPORT",
                path,
                lineno,
                "lib/workflows must not import React, components, hooks, Tauri, or TanStack Query",
            )

        if in_components:
            add_if(
                violations,
                (
                    "@/lib/access/" in line
                    or contains_tauri_api
                    or contains_anyharness_client
                    or contains_use_query_client
                    or contains_query_cache_call
                ),
                "COMPONENT_FORBIDDEN_ACCESS",
                path,
                lineno,
                "components must not own raw access or React Query cache shape",
            )

        if in_stores:
            add_if(
                violations,
                (
                    "@tanstack/react-query" in line
                    or "@/lib/access/" in line
                    or contains_tauri_api
                    or contains_anyharness_client
                ),
                "STORE_FORBIDDEN_ACCESS",
                path,
                lineno,
                "stores must not import raw access, Tauri, TanStack Query, or AnyHarness clients",
            )

    return violations


def load_allowlist() -> dict[tuple[str, str], AllowlistEntry]:
    if not ALLOWLIST_PATH.exists():
        return {}
    entries: dict[tuple[str, str], AllowlistEntry] = {}
    for lineno, raw_line in enumerate(ALLOWLIST_PATH.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(maxsplit=3)
        if len(parts) < 4:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{lineno}: "
                "expected: RULE_ID path count reason"
            )
        rule_id, relative_path, count_raw, reason = parts
        try:
            count = int(count_raw)
        except ValueError as error:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{lineno}: "
                f"invalid count {count_raw!r}"
            ) from error
        if count < 1:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{lineno}: count must be >= 1"
            )
        key = (rule_id, relative_path)
        if key in entries:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{lineno}: duplicate allowlist entry "
                f"for {rule_id} {relative_path}"
            )
        entries[key] = AllowlistEntry(rule_id, relative_path, count, reason)
    return entries


def collect_violations() -> list[Violation]:
    violations: list[Violation] = []
    for path in iter_frontend_files():
        violations.extend(check_file(path))
    return violations


def main() -> int:
    allowlist = load_allowlist()
    violations = collect_violations()

    grouped: dict[tuple[str, str], list[Violation]] = defaultdict(list)
    for violation in violations:
        grouped[(violation.rule_id, violation.relative_path)].append(violation)

    failures: list[str] = []
    stale_entries: list[str] = []

    for key, items in sorted(grouped.items()):
        allowed_count = allowlist.get(key).count if key in allowlist else 0
        if len(items) <= allowed_count:
            continue
        excess = items[allowed_count:]
        for violation in excess:
            failures.append(
                f"{violation.format()} (observed {len(items)}, allowed {allowed_count})"
            )

    observed_counts = Counter((violation.rule_id, violation.relative_path) for violation in violations)
    for key, entry in sorted(allowlist.items()):
        observed = observed_counts.get(key, 0)
        if observed < entry.count:
            stale_entries.append(
                f"{entry.relative_path}:1: [{entry.rule_id}] stale allowlist count "
                f"(observed {observed}, allowed {entry.count})"
            )

    if not failures and not stale_entries:
        print("Frontend boundary check passed.")
        return 0

    if failures:
        print("Frontend boundary violations:")
        for failure in failures:
            print(f"  {failure}")

    if stale_entries:
        if failures:
            print()
        print("Stale frontend boundary allowlist entries:")
        for stale in stale_entries:
            print(f"  {stale}")

    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as error:
        print(error, file=sys.stderr)
        raise SystemExit(2)
