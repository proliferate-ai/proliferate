#!/usr/bin/env python3
"""Frontend layer-boundary checker.

The rules themselves are records under `lints/frontend/*.toml`; this file is only
the engine. Diagnostics are rendered from the record (rule sentence, legal
alternative, record path) via `scripts/lint_records.py`, and grandfathered
violation sites live in `lints/frontend/exceptions.toml` as fine-grained
`(path, site)` fingerprints — never counts.
"""

from __future__ import annotations

import posixpath
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

try:
    from scripts.frontend_imports import (
        ImportStatement,
        Token,
        collect_imports,
        collect_module_specifiers,
        could_contain_literal_sequence,
        tokenize_typescript,
    )
except ModuleNotFoundError:  # Direct `python3 scripts/...` execution.
    from frontend_imports import (
        ImportStatement,
        Token,
        collect_imports,
        collect_module_specifiers,
        could_contain_literal_sequence,
        tokenize_typescript,
    )

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    # Run as `python3 scripts/check_frontend_boundaries.py` from the repo root,
    # sys.path[0] is scripts/ — the shared loader lives one level up.
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CHECKER = "scripts/check_frontend_boundaries.py"
RULES = lint_records.load("frontend")
OWNED_RULE_IDS = frozenset(rule.id for rule in RULES.rules.values() if rule.enforced_by == CHECKER)

DESKTOP_SRC = REPO_ROOT / "apps" / "desktop" / "src"
WEB_SRC = REPO_ROOT / "apps" / "web" / "src"
MOBILE_SRC = REPO_ROOT / "apps" / "mobile" / "src"
DESIGN_SRC = REPO_ROOT / "apps" / "packages" / "design" / "src"
PRODUCT_CLIENT_SRC = REPO_ROOT / "apps" / "packages" / "product-client" / "src"
PRODUCT_CLIENT_DOMAIN_SRC = PRODUCT_CLIENT_SRC / "domain"
PRODUCT_CLIENT_PRIMITIVES_SRC = PRODUCT_CLIENT_SRC / "primitives"
EXTENSIONS = {".ts", ".tsx"}
GENERATED_PREFIXES: set[str] = set()

# Component-library taxonomy (specs/DESIGN_SYSTEM.md):
# ProductClient owns root primitive files plus these support directories.
PRODUCT_CLIENT_PRIMITIVES_ALLOWED_SUPPORT_DIRECTORIES = {
    "icons",
    "patterns",
    "utils",
    "overlays",
    "__tests__",
}

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

# `--color-warning` is a fill token; using it as ink (or alpha-modifying an
# already-alpha fill) renders invisible. See find_warning_ink_violations.
WARNING_INK_RE = re.compile(
    r"\btext-warning(?![\w-])"
    r"|\b(?:bg|border)-warning/\d+(?![\w-])"
)

RADIX_SPECIFIER_RE = re.compile(r"@radix-ui/[A-Za-z0-9._/-]+")
OPENAPI_CLIENT_VERB_RE = re.compile(r"\bclient\.(GET|POST|PUT|PATCH|DELETE)\s*\(")
QUERY_CACHE_CALL_RE = re.compile(
    r"\bqueryClient\.(" + "|".join(sorted(QUERY_CACHE_METHODS)) + r")\s*\("
)
REACT_IMPORT_RE = re.compile(r"^\s*import(?:\s+type)?(?:\s+[^;]*\s+from)?\s+['\"]react['\"]")
QUERY_HOOK_NAMES = {
    "useInfiniteQuery",
    "useMutation",
    "useQueries",
    "useQuery",
    "useSuspenseQuery",
}
RAW_CLIENT_BINDINGS = {
    "AnyHarnessClient",
    "createProliferateClient",
    "getAnyHarnessClient",
    "getProliferateClient",
}
PRODUCT_CLIENT_FORBIDDEN_LAYER_EDGES = {
    ("hooks", "components"),
    ("lib", "components"),
    ("lib", "hooks"),
    ("lib", "providers"),
    ("lib", "stores"),
    ("stores", "components"),
    ("stores", "hooks"),
    ("stores", "providers"),
}

PRODUCT_CLIENT_DOMAIN_ALLOWED_ANYHARNESS_RUNTIME_IMPORTS = {
    "createTranscriptState",
    "deriveCanonicalPlan",
    "parseToolBackgroundWork",
    "reduceEvents",
}
PRODUCT_CLIENT_DOMAIN_RAW_CLOUD_CLIENT_IMPORTS = {
    "CreateProliferateClientOptions",
    "ProliferateCloudClient",
    "ProliferateOpenApiClient",
}
PRODUCT_CLIENT_DOMAIN_RAW_ANYHARNESS_CLIENT_CORE_IMPORTS = {
    "AnyHarnessClient",
    "AnyHarnessClientOptions",
    "AnyHarnessError",
    "AnyHarnessMeasurementOperationId",
    "AnyHarnessRequestOptions",
    "AnyHarnessRequestStartEvent",
    "AnyHarnessRequestTimingLifecycle",
    "AnyHarnessTimingCategory",
    "AnyHarnessTimingEvent",
    "AnyHarnessTimingObserver",
    "AnyHarnessTimingScope",
    "AnyHarnessTransport",
}
MOBILE_PRODUCT_CLIENT_DOMAIN_PREFIX = "@proliferate/product-client/internal/domain/"
PRODUCT_CLIENT_DOMAIN_STYLE_SUFFIXES = {
    ".css",
    ".less",
    ".sass",
    ".scss",
    ".styl",
}
PRODUCT_CLIENT_DOMAIN_FORBIDDEN_GLOBALS = {
    "document",
    "localStorage",
    "navigator",
    "sessionStorage",
    "window",
}
PRODUCT_CLIENT_DOMAIN_FIXTURE_IMPORTS = {
    (
        "workflows/definition-v2.test.ts",
        "../../../../../../fixtures/contracts/workflow-definition/v2-full.json",
    ): "fixtures/contracts/workflow-definition/v2-full.json",
    (
        "chats/transcript/transcript-presentation.test.ts",
        "../../../../../../../fixtures/contracts/native-subagent-transcript/claude.json",
    ): "fixtures/contracts/native-subagent-transcript/claude.json",
    (
        "chats/transcript/transcript-presentation.test.ts",
        "../../../../../../../fixtures/contracts/native-subagent-transcript/codex.json",
    ): "fixtures/contracts/native-subagent-transcript/codex.json",
}


# A violation's fingerprint is `<enclosing symbol>::<content anchor>` — never a
# line number, so a grandfathered site survives reformatting and moves within its
# file while a NEW hit in the same file gets its own site and fails. The symbol is
# the nearest declaration above the hit; the anchor is the import specifier or the
# matched token itself.
SYMBOL_RES = (
    (
        re.compile(
            r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*"
            r"([A-Za-z_$][\w$]*)"
        ),
        "function",
    ),
    (
        re.compile(r"^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)"),
        "class",
    ),
    (
        re.compile(r"^\s*(?:export\s+)?(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)"),
        "type",
    ),
    (
        re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)"),
        "const",
    ),
)

_LINES_CACHE: dict[tuple[str, int, int], list[str]] = {}


def file_lines(path: Path) -> list[str]:
    if not path.is_file():
        return []
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    cached = _LINES_CACHE.get(key)
    if cached is None:
        cached = path.read_text().splitlines()
        _LINES_CACHE[key] = cached
    return cached


def enclosing_symbol(path: Path, lineno: int) -> str:
    """Nearest declaration above `lineno`, e.g. `function useThing`.

    Import statements sit above every declaration, so a hit in the import block
    fingerprints on its specifier alone — which is already unique per specifier.
    """
    lines = file_lines(path)
    for index in range(min(lineno, len(lines)) - 1, -1, -1):
        line = strip_line_comment(lines[index])
        for pattern, kind in SYMBOL_RES:
            match = pattern.search(line)
            if match:
                return f"{kind} {match.group(1)}"
    return ""


def fingerprint(path: Path, lineno: int, anchor: str) -> str:
    symbol = enclosing_symbol(path, lineno)
    return f"{symbol}::{anchor}" if symbol else anchor


def line_anchor(path: Path, lineno: int, pattern: re.Pattern[str] | None = None) -> str:
    """Anchor text for a line-scanned hit: the matched token, else the whole line."""
    lines = file_lines(path)
    if not 1 <= lineno <= len(lines):
        return ""
    line = strip_line_comment(lines[lineno - 1])
    if pattern is not None:
        match = pattern.search(line)
        if match:
            return re.sub(r"\s+", " ", match.group(0)).strip()
    return re.sub(r"\s+", " ", line).strip()


@dataclass(frozen=True)
class Violation:
    rule_id: str
    path: Path
    lineno: int
    site: str
    detail: str

    @property
    def relative_path(self) -> str:
        try:
            return self.path.relative_to(REPO_ROOT).as_posix()
        except ValueError:
            return self.path.as_posix()

    @property
    def key(self) -> tuple[str, str]:
        return (self.relative_path, self.site)

    def format(self) -> str:
        """The record-generated diagnostic: rule, alternative, record path."""
        return lint_records.render_diagnostic(
            RULES.rule(self.rule_id),
            f"{self.relative_path}:{self.lineno}",
            self.detail,
        )


@dataclass(frozen=True)
class ScopedLocalBinding:
    name: str
    start: int
    end: int
    namespace: bool = False
    tracked_import_start: int | None = None


def strip_line_comment(line: str) -> str:
    return line.split("//", 1)[0]


def is_block_comment_line(line: str) -> bool:
    """True for a JSDoc/block-comment body line (`* ...`) or opener (`/* ...`
    / `/** ...`). Only meaningful for rules that scan comment-tolerant prose
    (like the radix-import rule) — general import/boundary rules must not use
    this, since a `**bold**` markdown line inside a template-literal fixture
    also starts with `*` and is not a comment.
    """
    stripped = line.lstrip()
    return stripped.startswith("/*") or stripped.startswith("*")


def should_skip(path: Path, *, include_tests: bool = False) -> bool:
    relative = path.relative_to(REPO_ROOT).as_posix()
    if any(relative.startswith(prefix) for prefix in GENERATED_PREFIXES):
        return True
    name = path.name
    if name.endswith(".d.ts"):
        return True
    if include_tests:
        return False
    return is_test_path(path)


def is_test_path(path: Path) -> bool:
    return (
        ".test." in path.name
        or ".spec." in path.name
        or any(part in {"__tests__", "__mocks__"} for part in path.parts)
    )


ALL_FRONTEND_SRC_ROOTS = [
    DESKTOP_SRC,
    WEB_SRC,
    MOBILE_SRC,
    DESIGN_SRC,
    PRODUCT_CLIENT_SRC,
]

# Icon source (specs/DESIGN_SYSTEM.md, UI-conformance review check 5). Matches
# the package and every deep entry point (`lucide-react/dynamicIconImports`,
# `lucide-react/icons/x`), in import, re-export, and dynamic-import position.
LUCIDE_SPECIFIER_RE = re.compile(r"""["']lucide(?:-react)?(?:/[^"']*)?["']""")
# The manifest half of the same rule: a declared dependency, in any of the four
# dependency maps npm honours.
LUCIDE_MANIFEST_ENTRY_RE = re.compile(r"""^\s*["']lucide(?:-react)?["']\s*:""")
LUCIDE_SCANNED_MANIFESTS = [
    REPO_ROOT / "apps" / "packages" / "product-client" / "package.json",
    REPO_ROOT / "apps" / "packages" / "design" / "package.json",
    REPO_ROOT / "apps" / "desktop" / "package.json",
    REPO_ROOT / "apps" / "web" / "package.json",
    REPO_ROOT / "apps" / "mobile" / "package.json",
]


def iter_files_in_roots(roots: list[Path], *, include_tests: bool = False) -> list[Path]:
    files: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        files.extend(
            path
            for path in sorted(root.rglob("*"))
            if path.is_file()
            and path.suffix in EXTENSIONS
            and not should_skip(path, include_tests=include_tests)
        )
    return files


def iter_frontend_files() -> list[Path]:
    return iter_files_in_roots([DESKTOP_SRC, PRODUCT_CLIENT_SRC])


def relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def read_source_text(path: Path, cache: dict[Path, str] | None = None) -> str:
    if cache is None:
        return path.read_text()
    if path not in cache:
        cache[path] = path.read_text()
    return cache[path]


def is_under(relative_path: str, prefix: str) -> bool:
    return relative_path.startswith(prefix)


def is_product_client_path(path: Path, prefix: str = "") -> bool:
    try:
        product_relative = path.relative_to(PRODUCT_CLIENT_SRC).as_posix()
    except ValueError:
        return False
    return not prefix or product_relative.startswith(prefix)


def product_client_relative(path: Path) -> str:
    return path.relative_to(PRODUCT_CLIENT_SRC).as_posix()


def resolve_product_client_import(path: Path, source: str) -> str | None:
    if source.startswith("#product/"):
        target = source.removeprefix("#product/")
    elif source.startswith("@proliferate/product-client/internal/"):
        target = source.removeprefix("@proliferate/product-client/internal/")
    elif source.startswith("@proliferate/product-client/host/"):
        target = f"host/{source.removeprefix('@proliferate/product-client/host/')}"
    elif source == "@proliferate/product-client/infra/measurement":
        target = "lib/infra/measurement/measurement-port"
    elif source == "@proliferate/product-client/infra/cloud-gateway":
        target = "lib/access/cloud/sandbox-gateway-access"
    elif source == "@proliferate/product-client/ProductClient":
        target = "ProductClient"
    elif source.startswith("."):
        target = posixpath.normpath(posixpath.join(product_client_relative(path.parent), source))
    else:
        return None

    target = target.split("?", 1)[0]
    normalized = posixpath.normpath(target)
    if normalized == ".." or normalized.startswith("../"):
        return None
    return normalized


def product_client_layer(path_or_target: str) -> str:
    return path_or_target.split("/", 1)[0]


def is_product_client_query_owner(path: Path) -> bool:
    target = product_client_relative(path)
    return (
        target.startswith("hooks/access/")
        or target.startswith("lib/infra/query/")
        or (target.startswith("hooks/") and "/cache/" in f"/{target}")
    )


def is_product_client_query_hook_owner(path: Path) -> bool:
    target = product_client_relative(path)
    return target.startswith("hooks/access/") or (
        target.startswith("hooks/") and "/cache/" in f"/{target}"
    )


def first_present(line: str, candidates: tuple[str, ...]) -> str:
    """The first candidate substring present in `line` — the site anchor."""
    for candidate in candidates:
        if candidate in line:
            return candidate
    return ""


def first_match(line: str, patterns: tuple[re.Pattern[str], ...]) -> str:
    """The first pattern's matched text, whitespace-collapsed — the site anchor."""
    for pattern in patterns:
        match = pattern.search(line)
        if match:
            return re.sub(r"\s+", " ", match.group(0)).strip()
    return ""


SET_STATE_CALL_RE = re.compile(r"[A-Za-z_$][\w$.]*\.setState\s*\(")


def set_state_anchor(path: Path, lineno: int) -> str:
    """`<receiver>.setState` for a setState hit — the receiver names the store."""
    return (
        first_match(strip_line_comment_safe(path, lineno), (SET_STATE_CALL_RE,))
        .removesuffix("(")
        .strip()
        or "setState"
    )


def strip_line_comment_safe(path: Path, lineno: int) -> str:
    lines = file_lines(path)
    if not 1 <= lineno <= len(lines):
        return ""
    return strip_line_comment(lines[lineno - 1])


def code_only_text(text: str, *, jsx: bool) -> str:
    masked = ["\n" if char == "\n" else " " for char in text]
    for token in tokenize_typescript(text, jsx=jsx):
        if token.kind == "string":
            continue
        masked[token.start : token.end] = text[token.start : token.end]
    return "".join(masked)


def is_tauri_access_path(relative_path: str) -> bool:
    return is_under(relative_path, "apps/desktop/src/lib/access/tauri/")


def is_anyharness_client_path(relative_path: str) -> bool:
    return (
        is_under(relative_path, "apps/desktop/src/lib/access/anyharness/")
        or is_under(relative_path, "apps/desktop/src/hooks/access/anyharness/")
        or is_under(relative_path, "apps/packages/product-client/src/lib/access/anyharness/")
        or is_under(relative_path, "apps/packages/product-client/src/hooks/access/anyharness/")
    )


def is_cloud_access_path(relative_path: str) -> bool:
    return is_under(relative_path, "apps/desktop/src/lib/access/cloud/") or is_under(
        relative_path, "apps/packages/product-client/src/lib/access/cloud/"
    )


def is_ui_component_library_path(relative_path: str) -> bool:
    prefix = "apps/packages/product-client/src/primitives/"
    if not is_under(relative_path, prefix):
        return False
    primitive_relative = relative_path.removeprefix(prefix)
    return "/" not in primitive_relative or primitive_relative.startswith("patterns/")


def is_query_cache_owner_path(relative_path: str) -> bool:
    return (
        is_under(relative_path, "apps/desktop/src/hooks/access/")
        or is_under(relative_path, "apps/desktop/src/lib/infra/query/")
        or (is_under(relative_path, "apps/desktop/src/hooks/") and "/cache/" in relative_path)
        or is_under(relative_path, "apps/packages/product-client/src/hooks/access/")
        or is_under(relative_path, "apps/packages/product-client/src/lib/infra/query/")
        or (
            is_under(relative_path, "apps/packages/product-client/src/hooks/")
            and "/cache/" in relative_path
        )
    )


def add_if(
    violations: list[Violation],
    condition: bool,
    rule_id: str,
    path: Path,
    lineno: int,
    anchor: str,
    detail: str,
) -> None:
    """Record one violation, fingerprinted by enclosing symbol + content anchor."""
    if condition:
        violations.append(
            Violation(rule_id, path, lineno, fingerprint(path, lineno, anchor), detail)
        )


def check_file(path: Path) -> list[Violation]:
    violations: list[Violation] = []
    rel = relative(path)
    in_domain = is_under(rel, "apps/desktop/src/lib/domain/")
    in_workflows = is_under(rel, "apps/desktop/src/lib/workflows/")
    in_components = is_under(rel, "apps/desktop/src/components/")
    in_stores = is_under(rel, "apps/desktop/src/stores/")
    in_desktop = is_under(rel, "apps/desktop/src/")
    in_product_client = is_under(rel, "apps/packages/product-client/src/")
    text = path.read_text()
    scan_lines = (
        code_only_text(text, jsx=path.suffix == ".tsx").splitlines()
        if in_product_client
        else text.splitlines()
    )

    for lineno, raw_line in enumerate(scan_lines, start=1):
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
            "FE-ACCESS-1",
            path,
            lineno,
            "@tauri-apps/api",
            "@tauri-apps/api imported outside apps/desktop/src/lib/access/tauri/**",
        )
        add_if(
            violations,
            in_desktop and contains_anyharness_client and not is_anyharness_client_path(rel),
            "FE-ACCESS-2",
            path,
            lineno,
            "getAnyHarnessClient",
            "getAnyHarnessClient referenced outside the AnyHarness access layer",
        )
        add_if(
            violations,
            (in_desktop or in_product_client)
            and contains_openapi_client_verb
            and not is_cloud_access_path(rel),
            "FE-ACCESS-3",
            path,
            lineno,
            first_match(line, (OPENAPI_CLIENT_VERB_RE,)),
            f"raw OpenAPI verb {first_match(line, (OPENAPI_CLIENT_VERB_RE,))!r} "
            "outside lib/access/cloud/**",
        )
        add_if(
            violations,
            (in_desktop or in_product_client)
            and (contains_use_query_client or contains_query_cache_call)
            and not is_query_cache_owner_path(rel),
            "FE-CACHE-1",
            path,
            lineno,
            "useQueryClient"
            if contains_use_query_client
            else first_match(line, (QUERY_CACHE_CALL_RE,)),
            "QueryClient use outside an access hook, a hooks/**/cache/** owner, "
            "or lib/infra/query",
        )
        add_if(
            violations,
            in_desktop and contains_legacy_access,
            "FE-ACCESS-4",
            path,
            lineno,
            first_present(
                line,
                (
                    "@/platform/tauri",
                    "@/lib/integrations/cloud",
                    "@/lib/integrations/anyharness",
                ),
            ),
            "import of a retired legacy access path",
        )

        if in_domain:
            domain_anchor = first_present(
                line,
                (
                    "@tanstack/react-query",
                    "@/hooks/",
                    "@/stores/",
                    "@/lib/access/",
                    "@/lib/integrations/",
                    "@tauri-apps/api",
                ),
            ) or first_match(line, (REACT_IMPORT_RE,))
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
                "FE-DOMAIN-1",
                path,
                lineno,
                domain_anchor,
                f"lib/domain imports {domain_anchor!r}",
            )

        if in_workflows:
            workflow_anchor = first_present(
                line,
                (
                    "@tanstack/react-query",
                    "@/components/",
                    "@/hooks/",
                    "@tauri-apps/api",
                ),
            ) or first_match(line, (REACT_IMPORT_RE,))
            add_if(
                violations,
                (
                    contains_react_import
                    or "@tanstack/react-query" in line
                    or "@/components/" in line
                    or "@/hooks/" in line
                    or contains_tauri_api
                ),
                "FE-DOMAIN-2",
                path,
                lineno,
                workflow_anchor,
                f"lib/workflows imports {workflow_anchor!r}",
            )

        if in_components:
            component_anchor = first_present(
                line, ("@/lib/access/", "@tauri-apps/api", "getAnyHarnessClient")
            )
            add_if(
                violations,
                ("@/lib/access/" in line or contains_tauri_api or contains_anyharness_client),
                "FE-COMPONENT-1",
                path,
                lineno,
                component_anchor,
                f"component owns raw access via {component_anchor!r}",
            )

        if in_stores:
            store_anchor = first_present(
                line,
                (
                    "@tanstack/react-query",
                    "@/lib/access/",
                    "@tauri-apps/api",
                    "getAnyHarnessClient",
                ),
            )
            add_if(
                violations,
                (
                    "@tanstack/react-query" in line
                    or "@/lib/access/" in line
                    or contains_tauri_api
                    or contains_anyharness_client
                ),
                "FE-STORE-1",
                path,
                lineno,
                store_anchor,
                f"store imports {store_anchor!r}",
            )

    return violations


def statement_identifiers(statement: ImportStatement) -> set[str]:
    """Return the module's exported names, not their local aliases.

    Identifier-sensitive rules describe external capabilities.  A local alias
    with the same spelling as a forbidden export is not that capability, while
    renaming the real export must not hide it.  The shared import parser owns
    that distinction for static, re-export, and dynamic forms.
    """

    return set(statement.imported_names)


def imported_bindings(statement: ImportStatement) -> set[str]:
    return set(statement.local_bindings)


def namespace_bindings(statement: ImportStatement) -> set[str]:
    return set(statement.namespace_bindings)


def scoped_import_bindings(statement: ImportStatement) -> list[ScopedLocalBinding]:
    return [
        ScopedLocalBinding(
            name=binding.name,
            start=binding.start,
            end=binding.end,
            namespace=binding.namespace,
        )
        for binding in statement.scoped_bindings
    ]


def is_package_source(source: str, package: str) -> bool:
    return source == package or source.startswith(f"{package}/")


def is_product_client_domain_path(path: Path) -> bool:
    try:
        path.relative_to(PRODUCT_CLIENT_DOMAIN_SRC)
    except ValueError:
        return False
    return True


def product_client_domain_relative(path: Path) -> str:
    return path.relative_to(PRODUCT_CLIENT_DOMAIN_SRC).as_posix()


def clean_module_source(source: str) -> str:
    return source.split("?", 1)[0].split("#", 1)[0]


def product_client_domain_raw_capability_names(
    source: str, statement: ImportStatement
) -> set[str]:
    """Return SDK client-plumbing names forbidden even as type imports."""

    imported_names = set(statement.imported_names)
    if "*" in imported_names:
        return {"*"}
    if source == "@proliferate/cloud-sdk":
        return imported_names & PRODUCT_CLIENT_DOMAIN_RAW_CLOUD_CLIENT_IMPORTS
    if source == "@anyharness/sdk":
        return imported_names & PRODUCT_CLIENT_DOMAIN_RAW_ANYHARNESS_CLIENT_CORE_IMPORTS
    return set()


def permitted_product_client_domain_fixture(path: Path, source: str, resolved: Path) -> bool:
    if not is_test_path(path):
        return False
    expected_relative = PRODUCT_CLIENT_DOMAIN_FIXTURE_IMPORTS.get(
        (product_client_domain_relative(path), source)
    )
    if expected_relative is None:
        return False
    expected = (REPO_ROOT / expected_relative).resolve()
    return resolved == expected and expected.is_file()


def find_product_client_domain_violations(path: Path) -> list[Violation]:
    """Enforce the nested, Mobile-safe ProductClient domain boundary."""

    if not is_product_client_domain_path(path):
        return []

    violations: list[Violation] = []
    text = path.read_text()
    if path.suffix == ".tsx":
        violations.append(
            Violation(
                "FE-PC-1",
                path,
                1,
                path.name,
                f"{path.name} is a .tsx file under src/domain",
            )
        )

    for statement in collect_module_specifiers(path, text):
        source = statement.source
        clean_source = clean_module_source(source)
        if Path(clean_source).suffix.lower() in PRODUCT_CLIENT_DOMAIN_STYLE_SUFFIXES:
            violations.append(
                Violation(
                    "FE-PC-2",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, source),
                    f"domain imports style asset {source!r}",
                )
            )
            continue

        if source.startswith("."):
            resolved = (path.parent / clean_source).resolve()
            try:
                resolved.relative_to(PRODUCT_CLIENT_DOMAIN_SRC.resolve())
            except ValueError:
                if permitted_product_client_domain_fixture(path, source, resolved):
                    continue
                violations.append(
                    Violation(
                        "FE-PC-3",
                        path,
                        statement.lineno,
                        fingerprint(path, statement.lineno, source),
                        f"relative import {source!r} resolves outside src/domain",
                    )
                )
            continue

        if source == "vitest" and is_test_path(path):
            continue

        if source in {"@proliferate/cloud-sdk", "@anyharness/sdk"}:
            raw_capabilities = product_client_domain_raw_capability_names(source, statement)
            if raw_capabilities:
                violations.append(
                    Violation(
                        "FE-PC-2",
                        path,
                        statement.lineno,
                        fingerprint(
                            path,
                            statement.lineno,
                            f"{source}:{','.join(sorted(raw_capabilities))}",
                        ),
                        "domain imports raw client/request/timing/transport plumbing: "
                        f"{', '.join(sorted(raw_capabilities))}",
                    )
                )
                continue

        if source == "@proliferate/cloud-sdk":
            if statement.runtime_imported_names:
                violations.append(
                    Violation(
                        "FE-PC-2",
                        path,
                        statement.lineno,
                        fingerprint(
                            path,
                            statement.lineno,
                            f"{source}:{','.join(sorted(statement.runtime_imported_names))}",
                        ),
                        "domain imports Cloud SDK runtime values, not just contract "
                        f"types: {', '.join(sorted(statement.runtime_imported_names))}",
                    )
                )
            continue

        if source == "@anyharness/sdk":
            forbidden_runtime = (
                set(statement.runtime_imported_names)
                - PRODUCT_CLIENT_DOMAIN_ALLOWED_ANYHARNESS_RUNTIME_IMPORTS
            )
            if forbidden_runtime:
                violations.append(
                    Violation(
                        "FE-PC-2",
                        path,
                        statement.lineno,
                        fingerprint(
                            path,
                            statement.lineno,
                            f"{source}:{','.join(sorted(forbidden_runtime))}",
                        ),
                        "domain imports AnyHarness runtime values beyond the approved "
                        f"pure helpers: {', '.join(sorted(forbidden_runtime))}",
                    )
                )
            continue

        violations.append(
            Violation(
                "FE-PC-2",
                path,
                statement.lineno,
                fingerprint(path, statement.lineno, source),
                f"domain imports {source!r}, which is outside the allowed set "
                "(Cloud SDK types, AnyHarness contract types/approved pure helpers, "
                "test-only vitest)",
            )
        )

    tokens = tokenize_typescript(text, jsx=path.suffix == ".tsx")
    for token in tokens:
        if token.kind != "identifier":
            continue
        if token.value in PRODUCT_CLIENT_DOMAIN_FORBIDDEN_GLOBALS or token.value.startswith(
            "__TAURI"
        ):
            violations.append(
                Violation(
                    "FE-PC-4",
                    path,
                    token.lineno,
                    fingerprint(path, token.lineno, token.value),
                    f"domain references browser/Tauri global {token.value!r}",
                )
            )

    return violations


def mobile_relative_import_targets_product_client(path: Path, source: str) -> bool:
    if not source.startswith("."):
        return False
    resolved = (path.parent / clean_module_source(source)).resolve()
    try:
        resolved.relative_to(PRODUCT_CLIENT_SRC.parent.resolve())
    except ValueError:
        return False
    return True


def find_mobile_product_client_import_violations(path: Path) -> list[Violation]:
    """Allow Mobile to consume only concrete nested domain modules."""

    try:
        path.relative_to(MOBILE_SRC)
    except ValueError:
        return []

    violations: list[Violation] = []
    for statement in collect_module_specifiers(path, path.read_text()):
        source = statement.source
        if mobile_relative_import_targets_product_client(path, source):
            violations.append(
                Violation(
                    "FE-MOBILE-1",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, source),
                    "Mobile must reach ProductClient through its package export, "
                    f"not a relative source path; found {source!r}",
                )
            )
            continue
        if not is_package_source(source, "@proliferate/product-client"):
            continue
        if not source.startswith(MOBILE_PRODUCT_CLIENT_DOMAIN_PREFIX):
            violations.append(
                Violation(
                    "FE-MOBILE-1",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, source),
                    "Mobile may import ProductClient only through "
                    f"{MOBILE_PRODUCT_CLIENT_DOMAIN_PREFIX}<concrete-file>; found {source!r}",
                )
            )
            continue

        target = source.removeprefix(MOBILE_PRODUCT_CLIENT_DOMAIN_PREFIX)
        segments = target.split("/")
        concrete = (
            bool(target)
            and not target.endswith("/")
            and all(segment not in {"", ".", ".."} for segment in segments)
            and "?" not in target
            and "#" not in target
            and "\\" not in target
            and (PRODUCT_CLIENT_DOMAIN_SRC / f"{target}.ts").is_file()
        )
        if not concrete:
            violations.append(
                Violation(
                    "FE-MOBILE-1",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, source),
                    "Mobile ProductClient domain imports must name an existing concrete "
                    f"src/domain TypeScript file; found {source!r}",
                )
            )

    return violations


def namespace_member_identifiers(
    text: str,
    bindings: set[str],
    *,
    jsx: bool,
    tracked_import_starts: dict[str, set[int]] | None = None,
) -> set[str]:
    if not bindings:
        return set()
    tokens = tokenize_typescript(text, jsx=jsx)
    _, brace_reverse = _matching_token_pairs(tokens, "{", "}")
    _, closing_parens = _matching_token_pairs(tokens, "(", ")")
    shadow_ranges = _function_shadow_ranges(tokens, bindings)
    members: set[str] = set()
    for index, token in enumerate(tokens):
        if token.kind != "identifier" or token.value not in bindings:
            continue
        if not _is_imported_binding_occurrence(
            tokens,
            index,
            shadow_ranges,
            brace_reverse,
            (tracked_import_starts or {}).get(token.value, set()),
        ):
            continue
        member_cursor = _transparent_receiver_end(tokens, index + 1, index, closing_parens)
        member = _member_name_after(tokens, member_cursor) if member_cursor is not None else None
        if member is not None:
            members.add(member[0])
        members.update(_namespace_destructure_names(tokens, index))
    return members


def _matching_token_pairs(
    tokens: list[Token],
    opener: str,
    closer: str,
) -> tuple[dict[int, int], dict[int, int]]:
    opens: list[int] = []
    forward: dict[int, int] = {}
    reverse: dict[int, int] = {}
    for index, token in enumerate(tokens):
        if token.value == opener:
            opens.append(index)
        elif token.value == closer and opens:
            open_index = opens.pop()
            forward[open_index] = index
            reverse[index] = open_index
    return forward, reverse


def _statement_import_index(tokens: list[Token], statement: ImportStatement) -> int | None:
    return next(
        (
            index
            for index, token in enumerate(tokens)
            if token.start == statement.start and token.value == "import"
        ),
        None,
    )


def _function_body_ranges(tokens: list[Token]) -> list[tuple[int, int]]:
    parens, _ = _matching_token_pairs(tokens, "(", ")")
    braces, _ = _matching_token_pairs(tokens, "{", "}")
    body_opens: set[int] = set()

    for index, token in enumerate(tokens):
        if token.value != "function":
            continue
        open_index = index + 1
        while open_index < len(tokens) and tokens[open_index].value != "(":
            if tokens[open_index].value in {"{", ";"}:
                break
            open_index += 1
        close_index = parens.get(open_index)
        if (
            close_index is not None
            and close_index + 1 < len(tokens)
            and tokens[close_index + 1].value == "{"
        ):
            body_opens.add(close_index + 1)

    for arrow_index, token in enumerate(tokens):
        is_combined_arrow = token.value == "=>"
        is_split_arrow = (
            token.value == "="
            and arrow_index + 1 < len(tokens)
            and tokens[arrow_index + 1].value == ">"
        )
        if not (is_combined_arrow or is_split_arrow):
            continue
        body_open = arrow_index + (2 if is_split_arrow else 1)
        if body_open < len(tokens) and tokens[body_open].value == "{":
            body_opens.add(body_open)

    control_owners = {"await", "catch", "for", "if", "switch", "while", "with"}
    for open_index, close_index in parens.items():
        if close_index + 1 >= len(tokens) or tokens[close_index + 1].value != "{":
            continue
        owner = tokens[open_index - 1] if open_index else None
        if owner is None or (owner.kind == "identifier" and owner.value in control_owners):
            continue
        if owner.kind == "identifier" or owner.value in {"]", ">"}:
            body_opens.add(close_index + 1)

    return sorted(
        (body_open + 1, braces[body_open]) for body_open in body_opens if body_open in braces
    )


def _static_block_ranges(tokens: list[Token]) -> list[tuple[int, int]]:
    braces, _ = _matching_token_pairs(tokens, "{", "}")
    return sorted(
        (open_index + 1, close_index)
        for open_index, close_index in braces.items()
        if open_index > 0 and tokens[open_index - 1].value == "static"
    )


def _var_scope_token_range(tokens: list[Token], index: int) -> tuple[int, int] | None:
    ranges = [
        scope
        for scope in _function_body_ranges(tokens) + _static_block_ranges(tokens)
        if scope[0] <= index < scope[1]
    ]
    return max(ranges) if ranges else None


def _enclosing_for_header(tokens: list[Token], index: int) -> tuple[int, int] | None:
    parens, _ = _matching_token_pairs(tokens, "(", ")")
    headers = []
    for open_index, close_index in parens.items():
        if not (open_index < index < close_index) or open_index == 0:
            continue
        owner = tokens[open_index - 1].value
        if owner == "for" or (
            owner == "await" and open_index > 1 and tokens[open_index - 2].value == "for"
        ):
            headers.append((open_index, close_index))
    return max(headers) if headers else None


def _controlled_statement_end(tokens: list[Token], start: int) -> int:
    if start >= len(tokens):
        return len(tokens)
    parens, _ = _matching_token_pairs(tokens, "(", ")")
    braces, _ = _matching_token_pairs(tokens, "{", "}")
    if tokens[start].value == "{" and start in braces:
        return braces[start] + 1

    if tokens[start].value == "if":
        condition_open = start + 1
        while condition_open < len(tokens) and tokens[condition_open].value != "(":
            condition_open += 1
        condition_close = parens.get(condition_open)
        if condition_close is not None:
            then_end = _controlled_statement_end(tokens, condition_close + 1)
            if then_end < len(tokens) and tokens[then_end].value == "else":
                return _controlled_statement_end(tokens, then_end + 1)
            return then_end

    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{"}
    cursor = start
    while cursor < len(tokens):
        if cursor > start and not nesting and _line_starts_new_statement(tokens, cursor):
            return cursor
        value = tokens[cursor].value
        if value in {"(", "[", "{"}:
            nesting.append(value)
        elif value in matching:
            if nesting and nesting[-1] == matching[value]:
                nesting.pop()
            elif not nesting:
                return cursor
        if value == ";" and not nesting:
            return cursor + 1
        cursor += 1
    return len(tokens)


def _line_starts_new_statement(tokens: list[Token], index: int) -> bool:
    if index <= 0 or tokens[index].lineno <= tokens[index - 1].lineno:
        return False
    continuation_tokens = {
        ".",
        "?",
        "[",
        "(",
        "`",
        ",",
        ":",
        "+",
        "-",
        "*",
        "/",
        "%",
        "&",
        "|",
        "^",
        "<",
        ">",
        "=",
        "as",
        "satisfies",
        "instanceof",
        "in",
    }
    return (
        tokens[index].value not in continuation_tokens
        and tokens[index - 1].value not in continuation_tokens
    )


def _declaration_keyword_before(tokens: list[Token], binding_start: int) -> tuple[str, int] | None:
    if binding_start == 0:
        return None
    cursor = binding_start - 1
    if tokens[cursor].value in {"const", "let", "var"}:
        return tokens[cursor].value, cursor
    if tokens[cursor].value != ",":
        return None

    nesting: list[str] = []
    matching = {"(": ")", "[": "]", "{": "}"}
    cursor -= 1
    while cursor >= 0:
        value = tokens[cursor].value
        if value in {")", "]", "}"}:
            nesting.append(value)
        elif value in matching:
            if nesting and nesting[-1] == matching[value]:
                nesting.pop()
            elif not nesting:
                return None
        elif not nesting and value in {"const", "let", "var"}:
            return value, cursor
        elif not nesting and value in {";", "{"}:
            return None
        cursor -= 1
    return None


def _dynamic_import_declaration(tokens: list[Token], import_index: int) -> tuple[str, int] | None:
    _, brace_reverse = _matching_token_pairs(tokens, "{", "}")
    _, bracket_reverse = _matching_token_pairs(tokens, "[", "]")
    cursor = import_index - 1
    while cursor >= 0:
        value = tokens[cursor].value
        if value in {";", "{"}:
            return None
        if value == "=" and not (cursor + 1 < len(tokens) and tokens[cursor + 1].value == ">"):
            binding_end = cursor - 1
            if binding_end < 0:
                return None
            if tokens[binding_end].kind == "identifier":
                binding_start = binding_end
            elif tokens[binding_end].value == "}":
                binding_start = brace_reverse.get(binding_end, -1)
            elif tokens[binding_end].value == "]":
                binding_start = bracket_reverse.get(binding_end, -1)
            else:
                return None
            return _declaration_keyword_before(tokens, binding_start)
        cursor -= 1
    return None


def _declaration_scope_end(
    text: str,
    tokens: list[Token],
    declaration: tuple[str, int] | None,
    origin_index: int,
) -> int:
    kind, declaration_index = declaration or ("", -1)
    if kind == "var":
        scope = _var_scope_token_range(tokens, declaration_index)
        return tokens[scope[1]].start if scope is not None else len(text)
    if kind in {"const", "let"}:
        header = _enclosing_for_header(tokens, declaration_index)
        if header is not None:
            body_end = _controlled_statement_end(tokens, header[1] + 1)
            return tokens[body_end - 1].end if body_end else len(text)

    braces, _ = _matching_token_pairs(tokens, "{", "}")
    containers = [
        (open_index, close_index)
        for open_index, close_index in braces.items()
        if open_index < origin_index < close_index
    ]
    return tokens[max(containers)[1]].start if containers else len(text)


def _statement_binding_scope(
    text: str,
    tokens: list[Token],
    statement: ImportStatement,
) -> tuple[int, int]:
    import_index = _statement_import_index(tokens, statement)
    if (
        import_index is None
        or import_index + 1 >= len(tokens)
        or tokens[import_index + 1].value != "("
    ):
        return 0, len(text)

    declaration = _dynamic_import_declaration(tokens, import_index)
    return statement.start, _declaration_scope_end(text, tokens, declaration, import_index)


def _is_dynamic_import_statement(tokens: list[Token], statement: ImportStatement) -> bool:
    import_index = _statement_import_index(tokens, statement)
    return (
        import_index is not None
        and import_index + 1 < len(tokens)
        and tokens[import_index + 1].value == "("
    )


def _top_level_token_index(tokens: list[Token], value: str) -> int | None:
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    for index, token in enumerate(tokens):
        if token.value in {"(", "[", "{", "<"}:
            nesting.append(token.value)
        elif token.value in matching and nesting and nesting[-1] == matching[token.value]:
            nesting.pop()
        elif not nesting and token.value == value:
            return index
    return None


def _split_top_level_tokens(tokens: list[Token], delimiter: str) -> list[list[Token]]:
    entries: list[list[Token]] = []
    current: list[Token] = []
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    for token in tokens:
        if token.value in {"(", "[", "{", "<"}:
            nesting.append(token.value)
        elif token.value in matching and nesting and nesting[-1] == matching[token.value]:
            nesting.pop()
        if token.value == delimiter and not nesting:
            entries.append(current)
            current = []
        else:
            current.append(token)
    entries.append(current)
    return entries


def _binding_names_in_pattern(tokens: list[Token], bindings: set[str]) -> set[str]:
    """Return imported names rebound by one parameter/declaration pattern."""

    cursor = 0
    while cursor < len(tokens) and tokens[cursor].value in {
        ".",
        "override",
        "private",
        "protected",
        "public",
        "readonly",
    }:
        cursor += 1
    if cursor >= len(tokens):
        return set()
    first = tokens[cursor]
    if first.kind == "identifier":
        return {first.value} & bindings
    if first.value not in {"{", "["}:
        return set()

    opener = first.value
    closer = "}" if opener == "{" else "]"
    depth = 1
    close_index = cursor + 1
    while close_index < len(tokens) and depth:
        token = tokens[close_index]
        if token.value == opener:
            depth += 1
        elif token.value == closer:
            depth -= 1
        close_index += 1
    if depth:
        return set()

    entries = _split_top_level_tokens(tokens[cursor + 1 : close_index - 1], ",")
    rebound: set[str] = set()
    for entry in entries:
        while entry and entry[0].value == ".":
            entry = entry[1:]
        if not entry:
            continue

        equals_index = _top_level_token_index(entry, "=")
        binding_part = entry[:equals_index] if equals_index is not None else entry
        if opener == "{":
            colon_index = _top_level_token_index(binding_part, ":")
            if colon_index is not None:
                # Object property keys—including computed keys—are reads, not
                # bindings.  Only the pattern to the right of `:` can shadow.
                binding_part = binding_part[colon_index + 1 :]
        rebound.update(_binding_names_in_pattern(binding_part, bindings))
    return rebound


def _binding_names_in_parameter_tokens(tokens: list[Token], bindings: set[str]) -> set[str]:
    """Return imported names rebound by a function-like parameter list."""

    entries: list[list[Token]] = []
    current: list[Token] = []
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    for token in tokens:
        if token.value in {"(", "[", "{", "<"}:
            nesting.append(token.value)
        elif token.value in matching and nesting and nesting[-1] == matching[token.value]:
            nesting.pop()
        if token.value == "," and not nesting:
            entries.append(current)
            current = []
        else:
            current.append(token)
    entries.append(current)

    rebound: set[str] = set()
    for entry in entries:
        rebound.update(_binding_names_in_pattern(entry, bindings))
    return rebound


def _is_named_expression(tokens: list[Token], keyword_index: int) -> bool:
    """Whether `function`/`class Name` introduces an inner-only name."""

    cursor = keyword_index - 1
    if cursor >= 0 and tokens[cursor].value == "async":
        cursor -= 1
    if cursor < 0:
        return False
    if tokens[cursor].value == ">" and cursor > 0 and tokens[cursor - 1].value == "=":
        return True
    return tokens[cursor].value in {
        "(",
        "!",
        "%",
        "&",
        "*",
        "+",
        ",",
        "-",
        "/",
        ":",
        "<",
        "=",
        ">",
        "[",
        "?",
        "^",
        "await",
        "delete",
        "extends",
        "in",
        "instanceof",
        "new",
        "return",
        "void",
        "yield",
        "|",
        "~",
    }


def _function_shadow_ranges(
    tokens: list[Token], bindings: set[str]
) -> list[tuple[int, int, set[str]]]:
    parens, closing_parens = _matching_token_pairs(tokens, "(", ")")
    braces, _ = _matching_token_pairs(tokens, "{", "}")
    ranges: list[tuple[int, int, set[str]]] = []

    def add_range(
        param_start: int,
        param_end: int,
        body_start: int,
        body_end: int,
        extra_rebound: set[str] | None = None,
    ) -> None:
        rebound = _binding_names_in_parameter_tokens(tokens[param_start:param_end], bindings)
        rebound.update(extra_rebound or set())
        if rebound:
            ranges.append((body_start, body_end, rebound))

    # Function declarations/expressions and catch clauses.
    for index, token in enumerate(tokens):
        if token.value not in {"function", "catch"}:
            continue
        open_index = index + 1
        while open_index < len(tokens) and tokens[open_index].value != "(":
            if tokens[open_index].value in {"{", ";"}:
                break
            open_index += 1
        close_index = parens.get(open_index)
        if close_index is None or close_index + 1 >= len(tokens):
            continue
        body_open = close_index + 1
        if tokens[body_open].value != "{" or body_open not in braces:
            continue
        inner_name = (
            tokens[index + 1].value
            if token.value == "function"
            and index + 1 < open_index
            and tokens[index + 1].kind == "identifier"
            and tokens[index + 1].value in bindings
            and _is_named_expression(tokens, index)
            else None
        )
        add_range(
            open_index + 1,
            close_index,
            body_open + 1,
            braces[body_open],
            {inner_name} if inner_name is not None else None,
        )

    # A named class expression binds its name only inside the class body.
    for index, token in enumerate(tokens):
        if (
            token.value != "class"
            or index + 1 >= len(tokens)
            or tokens[index + 1].kind != "identifier"
            or tokens[index + 1].value not in bindings
            or not _is_named_expression(tokens, index)
        ):
            continue
        body_open = index + 2
        while body_open < len(tokens) and tokens[body_open].value != "{":
            if tokens[body_open].value == ";":
                break
            body_open += 1
        if body_open in braces:
            ranges.append(
                (
                    body_open + 1,
                    braces[body_open],
                    {tokens[index + 1].value},
                )
            )

    # Arrow functions, including a single bare parameter.
    for arrow_index, token in enumerate(tokens):
        is_combined_arrow = token.value == "=>"
        is_split_arrow = (
            token.value == "="
            and arrow_index + 1 < len(tokens)
            and tokens[arrow_index + 1].value == ">"
        )
        if (
            not (is_combined_arrow or is_split_arrow)
            or arrow_index == 0
            or arrow_index + (2 if is_split_arrow else 1) >= len(tokens)
        ):
            continue
        before = arrow_index - 1
        if tokens[before].value == ")" and before in closing_parens:
            open_index = closing_parens[before]
            param_start, param_end = open_index + 1, before
        elif tokens[before].kind == "identifier":
            param_start, param_end = before, arrow_index
        else:
            continue

        body_start = arrow_index + (2 if is_split_arrow else 1)
        if tokens[body_start].value == "{" and body_start in braces:
            body_end = braces[body_start]
            add_range(param_start, param_end, body_start + 1, body_end)
            continue

        # An expression body ends at the first delimiter in its containing
        # expression. This is deliberately conservative: skipping a false
        # positive is preferable to attributing an unrelated object's call to
        # an imported Zustand binding.
        body_end = len(tokens)
        depth = 0
        for cursor in range(body_start, len(tokens)):
            value = tokens[cursor].value
            if value in {"(", "[", "{"}:
                depth += 1
            elif value in {
                ")",
                "]",
                "}",
            }:
                if depth == 0:
                    body_end = cursor
                    break
                depth -= 1
            elif depth == 0 and value in {",", ";"}:
                body_end = cursor
                break
        add_range(param_start, param_end, body_start, body_end)

    # Object/class methods have the same parameter/body spelling but no
    # `function` keyword. Limit this to a closing parameter list immediately
    # followed by a body; control-flow constructs contain no imported binding
    # parameter and therefore do not add a range.
    for open_index, close_index in parens.items():
        if open_index == 0:
            continue
        owner = tokens[open_index - 1]
        if owner.kind != "identifier" or owner.value in {
            "catch",
            "for",
            "if",
            "switch",
            "while",
            "with",
        }:
            continue
        if close_index + 1 >= len(tokens) or tokens[close_index + 1].value != "{":
            continue
        body_open = close_index + 1
        if body_open not in braces:
            continue
        add_range(open_index + 1, close_index, body_open + 1, braces[body_open])

    # `let`/`const` bindings declared by a for-loop are scoped to its body and
    # must not hide the imported binding after the loop completes.
    for for_index, token in enumerate(tokens):
        if token.value != "for":
            continue
        open_index = for_index + 1
        while open_index < len(tokens) and tokens[open_index].value != "(":
            if tokens[open_index].value in {"{", ";"}:
                break
            open_index += 1
        close_index = parens.get(open_index)
        if close_index is None:
            continue
        initializer_end = close_index
        nesting: list[str] = []
        matching = {")": "(", "]": "[", "}": "{"}
        for cursor in range(open_index + 1, close_index):
            value = tokens[cursor].value
            if value in {"(", "[", "{"}:
                nesting.append(value)
            elif value in matching and nesting and nesting[-1] == matching[value]:
                nesting.pop()
            elif value == ";" and not nesting:
                initializer_end = cursor
                break

        declaration_index = open_index + 1
        if declaration_index >= initializer_end or tokens[declaration_index].value not in {
            "const",
            "let",
        }:
            declaration_index = None
        rebound = (
            _binding_names_in_parameter_tokens(
                tokens[declaration_index + 1 : initializer_end], bindings
            )
            if declaration_index is not None
            else set()
        )
        if not rebound or close_index + 1 >= len(tokens):
            continue
        body_start = close_index + 1
        if tokens[body_start].value == "{" and body_start in braces:
            ranges.append((body_start + 1, braces[body_start], rebound))
            continue
        body_end = body_start
        while body_end < len(tokens) and tokens[body_end].value != ";":
            body_end += 1
        ranges.append((body_start, body_end, rebound))

    return ranges


def _declares_binding_in_scope(
    tokens: list[Token],
    binding: str,
    candidate_index: int,
    brace_reverse: dict[int, int],
    tracked_import_starts: set[int],
) -> bool:
    """Whether a local declaration shadows an imported binding at a call."""

    # Lexical declarations shadow the import for their whole scope, including
    # before initialization (where JavaScript's temporal dead zone applies).
    enclosing_starts = {0} | {
        open_index + 1
        for close_index, open_index in brace_reverse.items()
        if open_index < candidate_index < close_index
    }
    paren_forward, _ = _matching_token_pairs(tokens, "(", ")")

    for index in range(len(tokens)):
        if tokens[index].value not in {"const", "let", "var", "class", "function"}:
            continue
        if tokens[index].value in {"const", "let"}:
            in_for_header = any(
                open_index < index < close_index
                and open_index > 0
                and tokens[open_index - 1].value in {"for", "await"}
                for open_index, close_index in paren_forward.items()
            )
            if in_for_header:
                continue
        if tokens[index].value == "var":
            # `var` belongs to its containing function/static block, not the
            # nearest ordinary block. Descendant closures see it; sibling
            # functions and module code outside that owner do not.
            var_scope = _var_scope_token_range(tokens, index)
            if var_scope is not None and not (var_scope[0] <= candidate_index < var_scope[1]):
                continue
        else:
            # The declaration itself must begin inside one of the candidate's
            # enclosing blocks, not a completed sibling/nested block.
            declaration_containers = [
                (open_index, close_index)
                for close_index, open_index in brace_reverse.items()
                if open_index < index < close_index
            ]
            declaration_scope = 0
            if declaration_containers:
                open_index, close_index = max(declaration_containers)
                if not (open_index < candidate_index < close_index):
                    continue
                declaration_scope = open_index + 1
            if declaration_scope not in enclosing_starts:
                continue

        if tokens[index].value in {"class", "function"}:
            if (
                index + 1 < len(tokens)
                and tokens[index + 1].kind == "identifier"
                and tokens[index + 1].value == binding
                and not _is_named_expression(tokens, index)
            ):
                return True
            continue

        # Walk every declarator in `const a = 1, b = 2;`, but inspect only its
        # binding pattern—not type annotations or initializer expressions.
        cursor = index + 1
        while cursor < len(tokens):
            declarator_start = cursor
            nesting: list[str] = []
            matching = {")": "(", "]": "[", "}": "{", ">": "<"}
            while cursor < len(tokens):
                value = tokens[cursor].value
                if value in {"(", "[", "{", "<"}:
                    nesting.append(value)
                elif value in matching and nesting and nesting[-1] == matching[value]:
                    nesting.pop()
                if not nesting and value in {",", ";"}:
                    break
                cursor += 1
            declarator = tokens[declarator_start:cursor]
            if binding in _binding_names_in_pattern(declarator, {binding}):
                if not any(
                    token.value == "import" and token.start in tracked_import_starts
                    for token in declarator
                ):
                    return True
            if cursor >= len(tokens) or tokens[cursor].value == ";":
                break
            cursor += 1
    return False


def _is_property_identifier(tokens: list[Token], index: int) -> bool:
    return (index > 0 and tokens[index - 1].value == ".") or (
        index > 1 and tokens[index - 2].value == "?" and tokens[index - 1].value == "."
    )


def _is_imported_binding_occurrence(
    tokens: list[Token],
    index: int,
    shadow_ranges: list[tuple[int, int, set[str]]],
    brace_reverse: dict[int, int],
    tracked_import_starts: set[int],
) -> bool:
    token = tokens[index]
    if token.kind != "identifier" or _is_property_identifier(tokens, index):
        return False
    if any(
        start <= index < end and token.value in rebound for start, end, rebound in shadow_ranges
    ):
        return False
    return not _declares_binding_in_scope(
        tokens,
        token.value,
        index,
        brace_reverse,
        tracked_import_starts,
    )


def _member_name_after(tokens: list[Token], cursor: int) -> tuple[str, int] | None:
    """Return a statically named member and the token after its access."""

    if cursor < len(tokens) and tokens[cursor].value == "!":
        cursor += 1
    optional = (
        cursor + 1 < len(tokens)
        and tokens[cursor].value == "?"
        and tokens[cursor + 1].value == "."
    )
    if optional:
        cursor += 2
    elif cursor < len(tokens) and tokens[cursor].value == ".":
        cursor += 1

    if cursor < len(tokens) and tokens[cursor].kind == "identifier":
        # An identifier member requires a preceding dot/optional-chain dot.
        if optional or (cursor > 0 and tokens[cursor - 1].value == "."):
            return tokens[cursor].value, cursor + 1
        return None
    if cursor + 1 < len(tokens) and tokens[cursor].value == "[":
        name = tokens[cursor + 1]
        if name.kind == "string" and cursor + 2 < len(tokens) and tokens[cursor + 2].value == "]":
            return name.value, cursor + 3
    return None


def _namespace_destructure_pattern(tokens: list[Token], index: int) -> tuple[int, int, int] | None:
    cursor = index - 1
    receiver_groups = 0
    while cursor >= 0 and tokens[cursor].value == "(":
        receiver_groups += 1
        cursor -= 1
    if cursor < 1 or tokens[cursor].value != "=" or tokens[cursor - 1].value != "}":
        return None

    _, reverse = _matching_token_pairs(tokens, "{", "}")
    close_index = cursor - 1
    open_index = reverse.get(close_index)
    if open_index is None:
        return None
    declaration = _declaration_keyword_before(tokens, open_index)

    after = index + 1
    while after < len(tokens):
        while after < len(tokens) and tokens[after].value == "!":
            after += 1
        if after < len(tokens) and tokens[after].value in {"as", "satisfies"}:
            after = _namespace_assertion_end(tokens, after)
            continue
        if receiver_groups and tokens[after].value == ")":
            receiver_groups -= 1
            after += 1
            continue
        break
    if receiver_groups:
        return None

    if after < len(tokens) and tokens[after].value != ";":
        next_token = tokens[after]
        previous_token = tokens[after - 1]
        continuation_starters = {
            ".",
            "?",
            "[",
            "(",
            "`",
            ",",
            ":",
            "+",
            "-",
            "*",
            "/",
            "%",
            "&",
            "|",
            "^",
            "<",
            ">",
            "=",
            "as",
            "satisfies",
            "instanceof",
            "in",
        }
        declarator_boundary = next_token.value == "," and declaration is not None
        has_asi_boundary = (
            declarator_boundary
            or next_token.value == "}"
            or (
                next_token.lineno > previous_token.lineno
                and next_token.value not in continuation_starters
            )
        )
        if not has_asi_boundary:
            # `const { useMutation } = Query.options` destructures a property
            # value, not the imported namespace itself. A line continuation
            # such as `Query\n.options` is likewise still the same expression.
            return None
    return open_index, close_index, after


def _namespace_assertion_end(tokens: list[Token], assertion_index: int) -> int:
    cursor = assertion_index + 1
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    while cursor < len(tokens):
        value = tokens[cursor].value
        if (
            cursor > assertion_index + 1
            and not nesting
            and _line_starts_new_statement(tokens, cursor)
        ):
            return cursor
        if not nesting and value in {",", ";", ")", "}"}:
            return cursor
        if value in {"(", "[", "{", "<"}:
            nesting.append(value)
        elif value in matching and nesting and nesting[-1] == matching[value]:
            nesting.pop()
        cursor += 1
    return cursor


def _namespace_destructure_names(tokens: list[Token], index: int) -> set[str]:
    """Return exports selected from an imported namespace at this occurrence."""

    pattern = _namespace_destructure_pattern(tokens, index)
    if pattern is None:
        return set()
    open_index, close_index, _ = pattern

    names: set[str] = set()
    for entry in _split_top_level_tokens(tokens[open_index + 1 : close_index], ","):
        while entry and entry[0].value == ".":
            entry = entry[1:]
        if not entry:
            continue
        equals_index = _top_level_token_index(entry, "=")
        binding_part = entry[:equals_index] if equals_index is not None else entry
        colon_index = _top_level_token_index(binding_part, ":")
        key = binding_part[:colon_index] if colon_index is not None else binding_part
        if key and key[0].kind in {"identifier", "string"}:
            names.add(key[0].value)
        elif (
            len(key) == 3
            and key[0].value == "["
            and key[1].kind == "string"
            and key[2].value == "]"
        ):
            names.add(key[1].value)
    return names


def _namespace_destructure_local_bindings(
    tokens: list[Token], open_index: int, close_index: int
) -> set[tuple[str, bool]]:
    bindings: set[tuple[str, bool]] = set()
    for entry in _split_top_level_tokens(tokens[open_index + 1 : close_index], ","):
        if not entry:
            continue
        is_namespace = len(entry) >= 3 and all(token.value == "." for token in entry[:3])
        if is_namespace:
            binding_part = entry[3:]
        else:
            equals_index = _top_level_token_index(entry, "=")
            binding_part = entry[:equals_index] if equals_index is not None else entry
            colon_index = _top_level_token_index(binding_part, ":")
            if colon_index is not None:
                binding_part = binding_part[colon_index + 1 :]
        if len(binding_part) == 1 and binding_part[0].kind == "identifier":
            bindings.add((binding_part[0].value, is_namespace))
    return bindings


def namespace_destructured_bindings(
    text: str,
    bindings: set[str],
    *,
    jsx: bool,
    tracked_import_starts: dict[str, set[int]] | None = None,
) -> list[ScopedLocalBinding]:
    if not bindings:
        return []
    tokens = tokenize_typescript(text, jsx=jsx)
    _, brace_reverse = _matching_token_pairs(tokens, "{", "}")
    shadow_ranges = _function_shadow_ranges(tokens, bindings)
    derived: set[ScopedLocalBinding] = set()
    for index, token in enumerate(tokens):
        if token.kind != "identifier" or token.value not in bindings:
            continue
        if not _is_imported_binding_occurrence(
            tokens,
            index,
            shadow_ranges,
            brace_reverse,
            (tracked_import_starts or {}).get(token.value, set()),
        ):
            continue
        pattern = _namespace_destructure_pattern(tokens, index)
        if pattern is None:
            continue
        open_index, close_index, after_index = pattern
        if after_index < len(tokens) and tokens[after_index].value in {",", ";"}:
            range_start = tokens[after_index].end
        elif after_index < len(tokens):
            range_start = tokens[after_index].start
        else:
            range_start = token.end
        declaration = _declaration_keyword_before(tokens, open_index)
        if declaration is not None:
            range_end = _declaration_scope_end(text, tokens, declaration, open_index)
        else:
            containers = [
                (brace_open, brace_close)
                for brace_close, brace_open in brace_reverse.items()
                if brace_open < index < brace_close
            ]
            range_end = tokens[max(containers)[1]].start if containers else len(text)
        if range_start >= range_end:
            continue
        for name, namespace in _namespace_destructure_local_bindings(
            tokens, open_index, close_index
        ):
            derived.add(
                ScopedLocalBinding(
                    name=name,
                    start=range_start,
                    end=range_end,
                    namespace=namespace,
                )
            )
    return sorted(derived, key=lambda binding: (binding.start, binding.end, binding.name))


def _simple_alias_declaration(
    tokens: list[Token], receiver_index: int
) -> tuple[str, tuple[str, int], int] | None:
    cursor = receiver_index - 1
    receiver_groups = 0
    while cursor >= 0 and tokens[cursor].value == "(":
        receiver_groups += 1
        cursor -= 1
    if cursor >= 0 and tokens[cursor].value == ",":
        parens, _ = _matching_token_pairs(tokens, "(", ")")
        comma_groups = [
            (open_index, close_index)
            for open_index, close_index in parens.items()
            if open_index < cursor < receiver_index < close_index
        ]
        if not comma_groups:
            return None
        declaration_open, _ = max(comma_groups)
        receiver_groups += 1
        while declaration_open > 0 and tokens[declaration_open - 1].value == "(":
            declaration_open -= 1
            receiver_groups += 1
        cursor = declaration_open - 1

    if cursor < 1 or tokens[cursor].value != "=":
        return None
    binding = tokens[cursor - 1]
    if binding.kind != "identifier":
        return None
    declaration = _declaration_keyword_before(tokens, cursor - 1)
    if declaration is None:
        return None
    return binding.value, declaration, receiver_groups


def _simple_alias_receiver_end(
    tokens: list[Token], cursor: int, receiver_groups: int
) -> int | None:
    while cursor < len(tokens):
        while cursor < len(tokens) and tokens[cursor].value == "!":
            cursor += 1
        if cursor < len(tokens) and tokens[cursor].value in {"as", "satisfies"}:
            cursor = _namespace_assertion_end(tokens, cursor)
            continue
        if receiver_groups and tokens[cursor].value == ")":
            receiver_groups -= 1
            cursor += 1
            continue
        break
    return cursor if not receiver_groups else None


def _alias_range_start(tokens: list[Token], receiver_end: int) -> int | None:
    if receiver_end >= len(tokens):
        return tokens[-1].end if tokens else 0
    token = tokens[receiver_end]
    if token.value in {",", ";"}:
        return token.end
    previous = tokens[receiver_end - 1]
    continuation_starters = {
        ".",
        "?",
        "[",
        "(",
        "`",
        ":",
        "+",
        "-",
        "*",
        "/",
        "%",
        "&",
        "|",
        "^",
        "<",
        ">",
        "=",
        "as",
        "satisfies",
        "instanceof",
        "in",
    }
    if token.value == "}" or (
        token.lineno > previous.lineno and token.value not in continuation_starters
    ):
        return token.start
    return None


def simple_store_value_aliases(
    text: str,
    bindings: set[str],
    *,
    jsx: bool,
    namespace_bindings: set[str] | None = None,
    tracked_import_starts: dict[str, set[int]] | None = None,
) -> list[ScopedLocalBinding]:
    if not bindings:
        return []
    tokens = tokenize_typescript(text, jsx=jsx)
    _, brace_reverse = _matching_token_pairs(tokens, "{", "}")
    shadow_ranges = _function_shadow_ranges(tokens, bindings)
    aliases: set[ScopedLocalBinding] = set()
    for index, token in enumerate(tokens):
        if token.kind != "identifier" or token.value not in bindings:
            continue
        if not _is_imported_binding_occurrence(
            tokens,
            index,
            shadow_ranges,
            brace_reverse,
            (tracked_import_starts or {}).get(token.value, set()),
        ):
            continue
        alias_declaration = _simple_alias_declaration(tokens, index)
        if alias_declaration is None:
            continue

        alias_name, declaration, receiver_groups = alias_declaration
        candidates: list[tuple[int | None, bool]] = []
        direct_end = _simple_alias_receiver_end(tokens, index + 1, receiver_groups)
        candidates.append((direct_end, token.value in (namespace_bindings or set())))
        if token.value in (namespace_bindings or set()):
            member = _member_name_after(tokens, index + 1)
            if member is not None:
                member_end = _simple_alias_receiver_end(tokens, member[1], receiver_groups)
                candidates.append((member_end, False))

        for receiver_end, alias_is_namespace in candidates:
            if receiver_end is None:
                continue
            range_start = _alias_range_start(tokens, receiver_end)
            if range_start is None:
                continue
            range_end = _declaration_scope_end(text, tokens, declaration, index)
            if range_start < range_end:
                aliases.add(
                    ScopedLocalBinding(
                        name=alias_name,
                        start=range_start,
                        end=range_end,
                        namespace=alias_is_namespace,
                    )
                )
            break
    return sorted(aliases, key=lambda binding: (binding.start, binding.end, binding.name))


def expanded_store_value_aliases(
    text: str,
    seeds: set[ScopedLocalBinding],
    *,
    jsx: bool,
) -> set[ScopedLocalBinding]:
    aliases: set[ScopedLocalBinding] = set()
    queue = list(seeds)
    while queue:
        source = queue.pop()
        start = max(0, min(len(text), source.start))
        end = max(start, min(len(text), source.end))
        segment = text[start:end]
        tracked_starts = (
            {source.name: {source.tracked_import_start - start}}
            if source.tracked_import_start is not None
            and start <= source.tracked_import_start < end
            else None
        )
        for derived in simple_store_value_aliases(
            segment,
            {source.name},
            jsx=jsx,
            namespace_bindings={source.name} if source.namespace else set(),
            tracked_import_starts=tracked_starts,
        ):
            absolute = ScopedLocalBinding(
                name=derived.name,
                start=start + derived.start,
                end=min(end, start + derived.end),
                namespace=derived.namespace,
            )
            if absolute in seeds or absolute in aliases:
                continue
            aliases.add(absolute)
            queue.append(absolute)
    return aliases


def _parenthesis_is_grouping(tokens: list[Token], open_index: int) -> bool:
    if open_index == 0:
        return True
    previous = tokens[open_index - 1]
    if previous.kind == "identifier":
        return previous.value in {
            "await",
            "case",
            "delete",
            "do",
            "else",
            "return",
            "throw",
            "typeof",
            "void",
            "yield",
        }
    return previous.value not in {")", "]", "}", "."}


def _skip_type_assertion(
    tokens: list[Token],
    cursor: int,
    receiver_index: int,
    closing_parens: dict[int, int],
) -> int | None:
    """Skip an `as`/`satisfies` type up to its receiver's grouping close."""

    if cursor >= len(tokens) or tokens[cursor].value not in {"as", "satisfies"}:
        return cursor
    cursor += 1
    nesting: list[str] = []
    matching = {")": "(", "]": "[", "}": "{", ">": "<"}
    saw_conditional_extends = False
    while cursor < len(tokens):
        value = tokens[cursor].value
        if value == ")" and not nesting:
            open_index = closing_parens.get(cursor)
            if open_index is not None and open_index < receiver_index:
                return cursor
            return None
        if value in {",", ";"} and not nesting:
            return None
        if not nesting:
            if value == "extends":
                saw_conditional_extends = True
            elif (
                value in {"instanceof", "in", "+", "-", "*", "/", "%", "^"}
                or value in {"?", ":"}
                and not saw_conditional_extends
                or (
                    value in {"&", "|"}
                    and cursor + 1 < len(tokens)
                    and tokens[cursor + 1].value == value
                )
                or value == "="
                and (cursor + 1 >= len(tokens) or tokens[cursor + 1].value != ">")
            ):
                return None
        if value in {"(", "[", "{", "<"}:
            nesting.append(value)
        elif value in matching and nesting and nesting[-1] == matching[value]:
            nesting.pop()
        cursor += 1
    return None


def _transparent_receiver_end(
    tokens: list[Token],
    cursor: int,
    receiver_index: int,
    closing_parens: dict[int, int],
) -> int | None:
    """Consume wrappers that preserve the value of a binding expression."""

    while cursor < len(tokens):
        while cursor < len(tokens) and tokens[cursor].value == "!":
            cursor += 1
        if cursor < len(tokens) and tokens[cursor].value in {"as", "satisfies"}:
            cursor = _skip_type_assertion(tokens, cursor, receiver_index, closing_parens)
            if cursor is None:
                return None
            continue
        if cursor < len(tokens) and tokens[cursor].value == ")":
            open_index = closing_parens.get(cursor)
            if open_index is None or not _parenthesis_is_grouping(tokens, open_index):
                return None
            cursor += 1
            continue
        break
    return cursor


def _member_call_after(tokens: list[Token], cursor: int, member: str) -> bool:
    access = _member_name_after(tokens, cursor)
    if access is None or access[0] != member:
        return False
    call_cursor = access[1]
    while call_cursor < len(tokens) and tokens[call_cursor].value == "!":
        call_cursor += 1
    if (
        call_cursor + 1 < len(tokens)
        and tokens[call_cursor].value == "?"
        and tokens[call_cursor + 1].value == "."
    ):
        call_cursor += 2
    return call_cursor < len(tokens) and tokens[call_cursor].value == "("


def member_call_lines(
    text: str,
    bindings: set[str],
    member: str,
    *,
    jsx: bool,
    namespace_bindings: set[str] | None = None,
    tracked_import_starts: dict[str, set[int]] | None = None,
) -> list[int]:
    if not bindings:
        return []
    tokens = tokenize_typescript(text, jsx=jsx)
    _, brace_reverse = _matching_token_pairs(tokens, "{", "}")
    _, closing_parens = _matching_token_pairs(tokens, "(", ")")
    shadow_ranges = _function_shadow_ranges(tokens, bindings)
    lines: list[int] = []
    for index, token in enumerate(tokens):
        if token.kind != "identifier" or token.value not in bindings:
            continue
        if not _is_imported_binding_occurrence(
            tokens,
            index,
            shadow_ranges,
            brace_reverse,
            (tracked_import_starts or {}).get(token.value, set()),
        ):
            continue
        cursor = _transparent_receiver_end(tokens, index + 1, index, closing_parens)
        if cursor is not None and _member_call_after(tokens, cursor, member):
            lines.append(token.lineno)
            continue

        if token.value not in (namespace_bindings or set()):
            continue
        namespace_member = _member_name_after(tokens, index + 1)
        if namespace_member is None:
            continue
        cursor = _transparent_receiver_end(tokens, namespace_member[1], index, closing_parens)
        if cursor is not None and _member_call_after(tokens, cursor, member):
            lines.append(token.lineno)
    return lines


def scoped_member_call_lines(
    text: str,
    binding: ScopedLocalBinding,
    member: str,
    *,
    jsx: bool,
) -> list[int]:
    start = max(0, min(len(text), binding.start))
    end = max(start, min(len(text), binding.end))
    segment = text[start:end]
    line_offset = text.count("\n", 0, start)
    tracked_import_starts = (
        {
            binding.name: {
                binding.tracked_import_start - start,
            }
        }
        if binding.tracked_import_start is not None and start <= binding.tracked_import_start < end
        else None
    )
    return [
        line_offset + lineno
        for lineno in member_call_lines(
            segment,
            {binding.name},
            member,
            jsx=jsx,
            namespace_bindings={binding.name} if binding.namespace else set(),
            tracked_import_starts=tracked_import_starts,
        )
    ]


def direct_call_lines(text: str, binding: str, *, jsx: bool) -> list[int]:
    tokens = tokenize_typescript(text, jsx=jsx)
    return [
        token.lineno
        for index, token in enumerate(tokens[:-1])
        if token.kind == "identifier"
        and token.value == binding
        and tokens[index + 1].value == "("
        and (index == 0 or tokens[index - 1].value != ".")
    ]


def is_product_client_forbidden_import(path: Path, source: str) -> bool:
    if (
        source.startswith("@tauri-apps/")
        or source.startswith("@/")
        or source.startswith("apps/desktop/")
        or source.startswith("apps/web/")
    ):
        return True
    if not source.startswith("."):
        return False
    clean_source = source.split("?", 1)[0]
    resolved = (path.parent / clean_source).resolve()
    return any(
        is_under(resolved.as_posix(), root.resolve().as_posix() + "/")
        for root in (REPO_ROOT / "apps" / "desktop", REPO_ROOT / "apps" / "web")
    )


def find_product_client_violations(path: Path) -> list[Violation]:
    if not is_product_client_path(path):
        return []

    violations: list[Violation] = []
    text = path.read_text()
    statements = collect_imports(path, text)
    jsx = path.suffix == ".tsx"
    source_tokens = tokenize_typescript(text, jsx=jsx)
    source_layer = product_client_layer(product_client_relative(path))
    lib_area = product_client_relative(path).split("/", 2)[1] if source_layer == "lib" else None
    imported_store_bindings: set[str] = set()
    imported_store_namespace_bindings: set[str] = set()
    imported_store_binding_starts: dict[str, set[int]] = defaultdict(set)
    scoped_store_bindings: set[ScopedLocalBinding] = set()
    store_value_seeds: set[ScopedLocalBinding] = set()

    for statement in statements:
        identifiers = statement_identifiers(statement)
        statement_is_dynamic = _is_dynamic_import_statement(source_tokens, statement)
        statement_namespaces = namespace_bindings(statement)
        statement_namespace_aliases: list[ScopedLocalBinding] = []
        if statement_namespaces:
            scope_start, scope_end = _statement_binding_scope(text, source_tokens, statement)
            scope_text = text[scope_start:scope_end]
            relative_import_start = statement.start - scope_start
            tracked_starts = {binding: {relative_import_start} for binding in statement_namespaces}
            identifiers.update(
                namespace_member_identifiers(
                    scope_text,
                    statement_namespaces,
                    jsx=jsx,
                    tracked_import_starts=tracked_starts,
                )
            )
            statement_namespace_aliases = [
                ScopedLocalBinding(
                    name=binding.name,
                    start=scope_start + binding.start,
                    end=scope_start + binding.end,
                    namespace=binding.namespace,
                )
                for binding in namespace_destructured_bindings(
                    scope_text,
                    statement_namespaces,
                    jsx=jsx,
                    tracked_import_starts=tracked_starts,
                )
            ]

        statement_scoped_bindings = scoped_import_bindings(statement)
        scoped_namespace_aliases: list[ScopedLocalBinding] = []
        for binding in statement_scoped_bindings:
            if not binding.namespace:
                continue
            scoped_text = text[binding.start : binding.end]
            identifiers.update(
                namespace_member_identifiers(
                    scoped_text,
                    {binding.name},
                    jsx=jsx,
                )
            )
            scoped_namespace_aliases.extend(
                ScopedLocalBinding(
                    name=alias.name,
                    start=binding.start + alias.start,
                    end=binding.start + alias.end,
                    namespace=alias.namespace,
                )
                for alias in namespace_destructured_bindings(
                    scoped_text,
                    {binding.name},
                    jsx=jsx,
                )
            )
        if is_product_client_forbidden_import(path, statement.source):
            violations.append(
                Violation(
                    "FE-PC-5",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, statement.source),
                    "product-client must use its typed host boundary instead of "
                    f"importing {statement.source!r}",
                )
            )
            continue

        target = resolve_product_client_import(path, statement.source)
        target_layer = product_client_layer(target) if target is not None else None
        forbidden_layer_edge = target_layer is not None and (
            (source_layer, target_layer) in PRODUCT_CLIENT_FORBIDDEN_LAYER_EDGES
            or (source_layer == "primitives" and target_layer != "primitives")
        )
        if forbidden_layer_edge:
            edge_kind = "type-only" if statement.type_only else "runtime"
            violations.append(
                Violation(
                    "FE-PC-6",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, statement.source),
                    f"{edge_kind} {source_layer} -> {target_layer} import is upward; "
                    "move the dependency or its owned type to the lower layer",
                )
            )

        if target_layer == "stores":
            statement_bindings = imported_bindings(statement)
            if statement_is_dynamic:
                scope_start, scope_end = _statement_binding_scope(text, source_tokens, statement)
                dynamic_bindings = {
                    ScopedLocalBinding(
                        name=binding,
                        start=scope_start,
                        end=scope_end,
                        namespace=binding in statement_namespaces,
                        tracked_import_start=statement.start,
                    )
                    for binding in statement_bindings
                }
                scoped_store_bindings.update(dynamic_bindings)
                store_value_seeds.update(dynamic_bindings)
            else:
                imported_store_bindings.update(statement_bindings)
                imported_store_namespace_bindings.update(statement_namespaces)
                store_value_seeds.update(
                    ScopedLocalBinding(
                        name=binding,
                        start=0,
                        end=len(text),
                        namespace=binding in statement_namespaces,
                        tracked_import_start=statement.start,
                    )
                    for binding in statement_bindings
                )
            scoped_store_bindings.update(statement_scoped_bindings)
            scoped_store_bindings.update(statement_namespace_aliases)
            scoped_store_bindings.update(scoped_namespace_aliases)
            store_value_seeds.update(statement_scoped_bindings)
            store_value_seeds.update(statement_namespace_aliases)
            store_value_seeds.update(scoped_namespace_aliases)
            if statement.local_bindings and not statement_is_dynamic:
                for binding in statement_bindings:
                    imported_store_binding_starts[binding].add(statement.start)

        query_hook_has_specific_owner = source_layer == "stores" or (
            source_layer == "lib" and lib_area in {"domain", "workflows"}
        )
        if (
            not query_hook_has_specific_owner
            and is_package_source(statement.source, "@tanstack/react-query")
            and identifiers.intersection(QUERY_HOOK_NAMES)
            and not is_product_client_query_hook_owner(path)
        ):
            hook_names = sorted(identifiers.intersection(QUERY_HOOK_NAMES))
            violations.append(
                Violation(
                    "FE-CACHE-2",
                    path,
                    statement.lineno,
                    fingerprint(
                        path, statement.lineno, f"{statement.source}:{','.join(hook_names)}"
                    ),
                    f"Query hook(s) {', '.join(hook_names)} used outside hooks/access/** "
                    "or a hooks/**/cache/** owner",
                )
            )

        internal_store_access = (
            source_layer == "stores" and target is not None and target.startswith("lib/access/")
        )

        if (
            "getAnyHarnessClient" in identifiers
            and not internal_store_access
            and not is_anyharness_client_path(relative(path))
        ):
            violations.append(
                Violation(
                    "FE-ACCESS-2",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, "getAnyHarnessClient"),
                    f"getAnyHarnessClient imported from {statement.source!r} outside the "
                    "AnyHarness access layer",
                )
            )

        if (
            source_layer == "components"
            and target is not None
            and target.startswith("lib/access/")
        ):
            violations.append(
                Violation(
                    "FE-COMPONENT-1",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, statement.source),
                    f"component imports lib/access module {statement.source!r} directly",
                )
            )

        if internal_store_access:
            violations.append(
                Violation(
                    "FE-STORE-1",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, statement.source),
                    f"store imports lib/access module {statement.source!r}",
                )
            )

        runtime_access_import = (
            not statement.type_only
            and source_layer == "stores"
            and not internal_store_access
            and (
                is_package_source(statement.source, "@tanstack/react-query")
                or is_package_source(statement.source, "@proliferate/cloud-sdk-react")
                or is_package_source(statement.source, "@anyharness/sdk-react")
                or bool(identifiers.intersection(RAW_CLIENT_BINDINGS))
            )
        )
        if runtime_access_import:
            violations.append(
                Violation(
                    "FE-STORE-2",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, statement.source),
                    f"store imports runtime client surface {statement.source!r}",
                )
            )

        if source_layer == "lib":
            rule_id = (
                "FE-DOMAIN-1"
                if lib_area == "domain"
                else "FE-DOMAIN-2"
                if lib_area == "workflows"
                else None
            )
            forbidden_lib_import = any(
                is_package_source(statement.source, package)
                for package in {"react", "react-dom", "@tanstack/react-query"}
            ) or (target is not None and target.startswith("lib/access/"))
            if rule_id is not None and forbidden_lib_import:
                violations.append(
                    Violation(
                        rule_id,
                        path,
                        statement.lineno,
                        fingerprint(path, statement.lineno, statement.source),
                        f"lib/{lib_area} imports {statement.source!r}",
                    )
                )

    scoped_store_bindings.update(expanded_store_value_aliases(text, store_value_seeds, jsx=jsx))

    for lineno in member_call_lines(
        text,
        imported_store_bindings,
        "setState",
        jsx=jsx,
        namespace_bindings=imported_store_namespace_bindings,
        tracked_import_starts=imported_store_binding_starts,
    ):
        violations.append(
            Violation(
                "FE-STORE-3",
                path,
                lineno,
                fingerprint(path, lineno, set_state_anchor(path, lineno)),
                f"{set_state_anchor(path, lineno)} on an imported store",
            )
        )

    for binding in sorted(
        scoped_store_bindings,
        key=lambda item: (
            item.start,
            item.end,
            item.name,
            item.namespace,
            item.tracked_import_start if item.tracked_import_start is not None else -1,
        ),
    ):
        for lineno in scoped_member_call_lines(
            text,
            binding,
            "setState",
            jsx=jsx,
        ):
            violations.append(
                Violation(
                    "FE-STORE-3",
                    path,
                    lineno,
                    fingerprint(path, lineno, set_state_anchor(path, lineno)),
                    f"{set_state_anchor(path, lineno)} on an imported store",
                )
            )

    if source_layer == "stores":
        for lineno in direct_call_lines(text, "fetch", jsx=jsx):
            violations.append(
                Violation(
                    "FE-STORE-2",
                    path,
                    lineno,
                    fingerprint(path, lineno, "fetch("),
                    "store calls fetch( directly",
                )
            )

    for token in tokenize_typescript(text, jsx=jsx):
        if token.kind == "identifier" and token.value.startswith("__TAURI"):
            violations.append(
                Violation(
                    "FE-PC-5",
                    path,
                    token.lineno,
                    fingerprint(path, token.lineno, token.value),
                    f"raw {token.value} global referenced in product-client",
                )
            )

    return violations


def find_radix_import_violations(
    paths: list[Path] | None = None,
    *,
    source_cache: dict[Path, str] | None = None,
) -> list[Violation]:
    """Rule: `@radix-ui/*` imports are legal only in root primitive files and
    the nested `patterns/` tier per the component-library taxonomy in
    specs/DESIGN_SYSTEM.md.
    """
    violations: list[Violation] = []
    candidates = (
        paths
        if paths is not None
        else iter_files_in_roots(ALL_FRONTEND_SRC_ROOTS, include_tests=True)
    )
    for path in candidates:
        rel = relative(path)
        if is_ui_component_library_path(rel):
            continue
        text = read_source_text(path, source_cache)
        for lineno, raw_line in enumerate(text.splitlines(), start=1):
            if is_block_comment_line(raw_line):
                continue
            line = strip_line_comment(raw_line)
            if not line.strip():
                continue
            if "@radix-ui/" in line:
                anchor = first_match(line, (RADIX_SPECIFIER_RE,)) or "@radix-ui/"
                violations.append(
                    Violation(
                        "FE-UI-1",
                        path,
                        lineno,
                        fingerprint(path, lineno, anchor),
                        f"{anchor} imported outside the component library",
                    )
                )
    return violations


def find_tailwind_merge_import_violations(
    paths: list[Path] | None = None,
    *,
    source_cache: dict[Path, str] | None = None,
) -> list[Violation]:
    """Keep Tailwind class merging behind the configured ProductClient wrapper.

    The stock package does not know ProductClient's semantic text utilities and
    can discard them as conflicting color classes.  The wrapper extends that
    configuration, so every frontend caller must import it instead of reaching
    the package directly.
    """

    violations: list[Violation] = []
    wrapper_path = PRODUCT_CLIENT_PRIMITIVES_SRC / "utils" / "tw-merge.ts"
    candidates = (
        paths
        if paths is not None
        else iter_files_in_roots(ALL_FRONTEND_SRC_ROOTS, include_tests=True)
    )
    for path in candidates:
        if path == wrapper_path:
            continue
        text = read_source_text(path, source_cache)
        if not could_contain_literal_sequence(text, "tailwind-merge"):
            continue
        for statement in collect_module_specifiers(path, text):
            if not is_package_source(statement.source, "tailwind-merge"):
                continue
            violations.append(
                Violation(
                    "FE-UI-2",
                    path,
                    statement.lineno,
                    fingerprint(path, statement.lineno, statement.source),
                    f"bare {statement.source!r} import outside the tw-merge wrapper",
                )
            )
    return violations


def find_warning_ink_violations() -> list[Violation]:
    """Rule: `--color-warning` is a FILL token, never ink.

    In dark mode `--color-warning` is `rgba(255, 180, 50, 0.15)` and in light
    mode it is `#fff8e6` — a near-transparent / near-white *fill*. Applied as
    ink via `text-warning` it renders the label at 15% opacity against a dark
    surface, i.e. effectively invisible. Every other tone (`success`, `info`,
    `destructive`) is an opaque hex, which is why only `warning` has this trap
    and why the DS ships a separate `--color-warning-foreground` (`#ffb432`).

    The purpose-built tokens are:
      ink    -> text-warning-foreground
      fill   -> bg-warning-subtle
      border -> border-warning-border

    Alpha-modified fills (`bg-warning/10`) are also flagged: multiplying an
    already-0.15-alpha token yields ~1.5% alpha, so the fill does not read
    either. Solid `bg-warning` is intentionally NOT flagged — using the fill
    token as a fill is correct (e.g. status dots, `OfflineIndicator`).

    This defect shipped to users across ~20 call sites and was invisible to
    every existing check, hence the gate.
    """
    violations: list[Violation] = []
    for path in iter_files_in_roots([PRODUCT_CLIENT_SRC, DESKTOP_SRC, WEB_SRC]):
        for lineno, line in enumerate(path.read_text().splitlines(), start=1):
            for match in WARNING_INK_RE.finditer(strip_line_comment(line)):
                utility = match.group(0)
                replacement = (
                    "text-warning-foreground"
                    if utility.startswith("text-")
                    # A `bg-warning/N` is either a panel wash or a solid dot;
                    # the wash wants the subtle fill, the dot wants the ink.
                    else "bg-warning-subtle (panel fill) or bg-warning-foreground (solid dot)"
                    if utility.startswith("bg-")
                    else "border-warning-border"
                )
                violations.append(
                    Violation(
                        "FE-UI-3",
                        path,
                        lineno,
                        fingerprint(path, lineno, utility),
                        f"`{utility}` uses the warning FILL token where the "
                        f"purpose-built token belongs — use `{replacement}`. "
                        "`--color-warning` is rgba(...,0.15) in dark mode, so "
                        "this renders effectively invisible.",
                    )
                )
    return violations


def find_lucide_icon_source_violations(
    paths: list[Path] | None = None,
    *,
    source_cache: dict[Path, str] | None = None,
) -> list[Violation]:
    """Rule: glyphs come from `primitives/icons/`, never from `lucide-react`.

    This is UI-conformance review check 5 made mechanical, in the amended
    wording: "Feature code imports zero lucide identifiers and the product
    packages no longer declare the dependency; any reintroduction — import line
    or `package.json` entry — is a finding." Both halves are checked here,
    because a package that still declares the dependency is one autocomplete
    away from importing it again; the import ban alone is a ratchet with the
    door left open behind it.
    """
    violations: list[Violation] = []
    candidates = (
        paths
        if paths is not None
        else iter_files_in_roots(ALL_FRONTEND_SRC_ROOTS, include_tests=True)
    )
    for path in candidates:
        text = read_source_text(path, source_cache)
        for lineno, raw_line in enumerate(text.splitlines(), start=1):
            if is_block_comment_line(raw_line):
                continue
            line = strip_line_comment(raw_line)
            if not line.strip():
                continue
            specifier_match = LUCIDE_SPECIFIER_RE.search(line)
            if specifier_match:
                violations.append(
                    Violation(
                        "LUCIDE_ICON_SOURCE",
                        path,
                        lineno,
                        fingerprint(path, lineno, specifier_match.group(0).strip("\"'")),
                        (
                            "glyphs come from apps/packages/product-client/src/"
                            "primitives/icons/**, never from lucide-react"
                        ),
                    )
                )

    for manifest in LUCIDE_SCANNED_MANIFESTS:
        if not manifest.exists():
            continue
        for lineno, raw_line in enumerate(manifest.read_text().splitlines(), start=1):
            if LUCIDE_MANIFEST_ENTRY_RE.search(raw_line):
                dependency = "lucide-react" if "lucide-react" in raw_line else "lucide"
                violations.append(
                    Violation(
                        "LUCIDE_PACKAGE_DEPENDENCY",
                        manifest,
                        lineno,
                        fingerprint(manifest, lineno, dependency),
                        (
                            "product packages no longer declare lucide; remove the "
                            "dependency entry instead of leaving the door open"
                        ),
                    )
                )
    return violations


def find_primitives_top_level_violations() -> list[Violation]:
    """Rule: ProductClient primitives owns root source files plus the support
    directories named by the component-library taxonomy.
    """
    violations: list[Violation] = []
    if not PRODUCT_CLIENT_PRIMITIVES_SRC.exists():
        return violations
    for entry in sorted(PRODUCT_CLIENT_PRIMITIVES_SRC.iterdir()):
        if entry.name.startswith("."):
            # Dotfiles (.DS_Store and similar OS/editor artifacts) are not
            # library taxonomy entries at all — nothing to flag.
            continue
        if entry.is_file() and entry.suffix in EXTENSIONS:
            continue
        if entry.is_dir() and entry.name in PRODUCT_CLIENT_PRIMITIVES_ALLOWED_SUPPORT_DIRECTORIES:
            continue
        violations.append(
            Violation(
                "FE-PC-7",
                entry,
                1,
                entry.name,
                f"primitives/{entry.name} is not an allowed root source file or "
                "support directory per the component-library taxonomy "
                "(support directories: "
                f"{', '.join(sorted(PRODUCT_CLIENT_PRIMITIVES_ALLOWED_SUPPORT_DIRECTORIES))})",
            )
        )
    return violations


def disambiguate(violations: list[Violation]) -> list[Violation]:
    """Give repeated fingerprints an occurrence ordinal, in file order.

    Two hits of the same rule can share a fingerprint — the same matched token
    twice inside one function. The ledger keys on `(path, site)`, so without an
    ordinal the second occurrence would be excused by the first one's entry.
    The ordinal is an occurrence index, not a line number: reformatting does not
    move it, and adding a hit only ever appends a new `#n` site.
    """
    grouped: dict[tuple[str, str, str], list[Violation]] = {}
    for violation in violations:
        grouped.setdefault(
            (violation.rule_id, violation.relative_path, violation.site), []
        ).append(violation)
    out: list[Violation] = []
    for group in grouped.values():
        if len(group) == 1:
            out.extend(group)
            continue
        for ordinal, violation in enumerate(sorted(group, key=lambda item: item.lineno), start=1):
            out.append(
                violation
                if ordinal == 1
                else Violation(
                    violation.rule_id,
                    violation.path,
                    violation.lineno,
                    f"{violation.site}#{ordinal}",
                    violation.detail,
                )
            )
    return sorted(out, key=lambda item: (item.relative_path, item.lineno, item.rule_id, item.site))


def collect_violations() -> list[Violation]:
    violations: list[Violation] = []
    for path in iter_frontend_files():
        violations.extend(check_file(path))
        violations.extend(find_product_client_violations(path))
    for path in iter_files_in_roots([PRODUCT_CLIENT_DOMAIN_SRC], include_tests=True):
        violations.extend(find_product_client_domain_violations(path))
    for path in iter_files_in_roots([MOBILE_SRC], include_tests=True):
        violations.extend(find_mobile_product_client_import_violations(path))
    all_frontend_paths = iter_files_in_roots(ALL_FRONTEND_SRC_ROOTS, include_tests=True)
    frontend_source_cache: dict[Path, str] = {}
    violations.extend(
        find_radix_import_violations(all_frontend_paths, source_cache=frontend_source_cache)
    )
    violations.extend(
        find_tailwind_merge_import_violations(
            all_frontend_paths, source_cache=frontend_source_cache
        )
    )
    violations.extend(
        find_lucide_icon_source_violations(all_frontend_paths, source_cache=frontend_source_cache)
    )
    violations.extend(find_primitives_top_level_violations())
    violations.extend(find_warning_ink_violations())
    return disambiguate(violations)


def tolerated_sites() -> dict[str, set[tuple[str, str]]]:
    """The grandfathered sites this checker owns, per rule id."""
    return {rule_id: RULES.exception_sites(rule_id) for rule_id in OWNED_RULE_IDS}


def apply_exceptions(
    violations: list[Violation],
    tolerated: dict[str, set[tuple[str, str]]] | None = None,
) -> tuple[list[Violation], list[str]]:
    """Split violations into failures and report exception entries gone stale."""
    ledger = tolerated_sites() if tolerated is None else tolerated
    observed: dict[str, set[tuple[str, str]]] = {}
    failures: list[Violation] = []
    for violation in violations:
        observed.setdefault(violation.rule_id, set()).add(violation.key)
        if violation.key not in ledger.get(violation.rule_id, set()):
            failures.append(violation)

    stale: list[str] = []
    for rule_id, sites in sorted(ledger.items()):
        for path, site in sorted(sites - observed.get(rule_id, set())):
            stale.append(
                f"{path}: [{rule_id}] site '{site}' no longer violates the rule — "
                f"delete this entry from lints/frontend/exceptions.toml"
            )
    return failures, stale


def main() -> int:
    violations = collect_violations()
    failures, stale = apply_exceptions(violations)

    if not failures and not stale:
        print("Frontend boundary check passed.")
        return 0

    if failures:
        print("Frontend boundary violations without a grandfathered exception:")
        for violation in sorted(
            failures,
            key=lambda item: (item.relative_path, item.lineno, item.rule_id, item.site),
        ):
            print(violation.format())
            print()

    if stale:
        print("Stale frontend exception entries:")
        for entry in stale:
            print(f"  {entry}")

    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as error:
        print(error, file=sys.stderr)
        raise SystemExit(2)
