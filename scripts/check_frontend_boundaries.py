#!/usr/bin/env python3

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
import posixpath
import re
import sys

try:
    from scripts.frontend_imports import (
        ImportStatement,
        Token,
        collect_imports,
        tokenize_typescript,
    )
except ModuleNotFoundError:  # Direct `python3 scripts/...` execution.
    from frontend_imports import ImportStatement, Token, collect_imports, tokenize_typescript

REPO_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_SRC = REPO_ROOT / "apps" / "desktop" / "src"
WEB_SRC = REPO_ROOT / "apps" / "web" / "src"
MOBILE_SRC = REPO_ROOT / "apps" / "mobile" / "src"
DESIGN_SRC = REPO_ROOT / "apps" / "packages" / "design" / "src"
UI_SRC = REPO_ROOT / "apps" / "packages" / "ui" / "src"
PRODUCT_DOMAIN_SRC = REPO_ROOT / "apps" / "packages" / "product-domain" / "src"
PRODUCT_UI_SRC = REPO_ROOT / "apps" / "packages" / "product-ui" / "src"
PRODUCT_SURFACES_SRC = REPO_ROOT / "apps" / "packages" / "product-surfaces" / "src"
PRODUCT_CLIENT_SRC = REPO_ROOT / "apps" / "packages" / "product-client" / "src"
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "frontend_boundaries_allowlist.txt"
EXTENSIONS = {".ts", ".tsx"}
GENERATED_PREFIXES: set[str] = set()

# Component-library taxonomy (specs/codebase/platforms/product/design-system.md):
# apps/packages/ui/src is base primitives + one-level-up compositions only.
UI_SRC_ALLOWED_TOP_LEVEL_ENTRIES = {
    "primitives",
    "patterns",
    "icons",
    "lib",
    "utils",
    "overlays",
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

OPENAPI_CLIENT_VERB_RE = re.compile(r"\bclient\.(GET|POST|PUT|PATCH|DELETE)\s*\(")
QUERY_CACHE_CALL_RE = re.compile(
    r"\bqueryClient\.("
    + "|".join(sorted(QUERY_CACHE_METHODS))
    + r")\s*\("
)
REACT_IMPORT_RE = re.compile(
    r"^\s*import(?:\s+type)?(?:\s+[^;]*\s+from)?\s+['\"]react['\"]"
)
QUERY_HOOK_NAMES = {
    "useInfiniteQuery",
    "useMutation",
    "useQueries",
    "useQuery",
    "useSuspenseQuery",
}
RAW_CLIENT_BINDINGS = {
    "createCloudClient",
    "getAnyHarnessClient",
    "getCloudClient",
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


def is_block_comment_line(line: str) -> bool:
    """True for a JSDoc/block-comment body line (`* ...`) or opener (`/* ...`
    / `/** ...`). Only meaningful for rules that scan comment-tolerant prose
    (like the radix-import rule) — general import/boundary rules must not use
    this, since a `**bold**` markdown line inside a template-literal fixture
    also starts with `*` and is not a comment.
    """
    stripped = line.lstrip()
    return stripped.startswith("/*") or stripped.startswith("*")


def should_skip(path: Path) -> bool:
    relative = path.relative_to(REPO_ROOT).as_posix()
    if any(relative.startswith(prefix) for prefix in GENERATED_PREFIXES):
        return True
    name = path.name
    if ".test." in name or ".spec." in name or name.endswith(".d.ts"):
        return True
    return any(part in {"__tests__", "__mocks__"} for part in path.parts)


ALL_FRONTEND_SRC_ROOTS = [
    DESKTOP_SRC,
    WEB_SRC,
    MOBILE_SRC,
    DESIGN_SRC,
    UI_SRC,
    PRODUCT_DOMAIN_SRC,
    PRODUCT_UI_SRC,
    PRODUCT_SURFACES_SRC,
    PRODUCT_CLIENT_SRC,
]


def iter_files_in_roots(roots: list[Path]) -> list[Path]:
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


def iter_frontend_files() -> list[Path]:
    return iter_files_in_roots([DESKTOP_SRC, PRODUCT_CLIENT_SRC])


def relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


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
        target = posixpath.normpath(
            posixpath.join(product_client_relative(path.parent), source)
        )
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
    return is_under(relative_path, "apps/packages/ui/src/primitives/") or is_under(
        relative_path, "apps/packages/ui/src/patterns/"
    )


def is_query_cache_owner_path(relative_path: str) -> bool:
    return (
        is_under(relative_path, "apps/desktop/src/hooks/access/")
        or is_under(relative_path, "apps/desktop/src/lib/infra/query/")
        or (
            is_under(relative_path, "apps/desktop/src/hooks/")
            and "/cache/" in relative_path
        )
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
            (in_desktop or in_product_client)
            and contains_openapi_client_verb
            and not is_cloud_access_path(rel),
            "CLOUD_OPENAPI_CLIENT_OUTSIDE_ACCESS",
            path,
            lineno,
            "raw OpenAPI client verbs must stay under apps/desktop/src/lib/access/cloud/**",
        )
        add_if(
            violations,
            (in_desktop or in_product_client)
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
                ),
                "COMPONENT_FORBIDDEN_ACCESS",
                path,
                lineno,
                "components must not own raw access",
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


def statement_identifiers(statement: ImportStatement) -> set[str]:
    return set(statement.imported_names) | {
        token.value
        for token in tokenize_typescript(statement.statement)
        if token.kind == "identifier"
    }


def imported_bindings(statement: ImportStatement) -> set[str]:
    tokens = tokenize_typescript(statement.statement)
    bindings = set(statement.local_bindings)
    if not tokens or tokens[0].value != "import":
        return bindings
    try:
        from_index = next(
            index
            for index, token in enumerate(tokens[:-1])
            if token.value == "from" and tokens[index + 1].kind == "string"
        )
    except StopIteration:
        return bindings

    clause = tokens[1:from_index]
    if clause and clause[0].value == "type":
        clause = clause[1:]
    if clause and clause[0].kind == "identifier":
        bindings.add(clause[0].value)

    for index, token in enumerate(clause):
        if token.value == "*" and index + 2 < len(clause) and clause[index + 1].value == "as":
            bindings.add(clause[index + 2].value)

    try:
        open_index = next(index for index, token in enumerate(clause) if token.value == "{")
        close_index = max(index for index, token in enumerate(clause) if token.value == "}")
    except (StopIteration, ValueError):
        return bindings

    current: list = []
    entries: list[list] = []
    for token in clause[open_index + 1 : close_index]:
        if token.value == ",":
            if current:
                entries.append(current)
            current = []
        else:
            current.append(token)
    if current:
        entries.append(current)

    for entry in entries:
        if entry and entry[0].value == "type":
            entry = entry[1:]
        if not entry:
            continue
        alias_index = next(
            (index for index, token in enumerate(entry) if token.value == "as"),
            None,
        )
        if alias_index is not None and alias_index + 1 < len(entry):
            bindings.add(entry[alias_index + 1].value)
        elif entry[0].kind == "identifier":
            bindings.add(entry[0].value)
    return bindings


def namespace_bindings(statement: ImportStatement) -> set[str]:
    bindings = set(statement.namespace_bindings)
    tokens = tokenize_typescript(statement.statement)
    for index, token in enumerate(tokens):
        if (
            token.value == "*"
            and index + 2 < len(tokens)
            and tokens[index + 1].value == "as"
            and tokens[index + 2].kind == "identifier"
        ):
            bindings.add(tokens[index + 2].value)
    return bindings


def namespace_member_identifiers(
    text: str, bindings: set[str], *, jsx: bool
) -> set[str]:
    if not bindings:
        return set()
    tokens = tokenize_typescript(text, jsx=jsx)
    members: set[str] = set()
    for index, token in enumerate(tokens[:-2]):
        if token.kind != "identifier" or token.value not in bindings:
            continue
        cursor = index + 1
        if tokens[cursor].value == "?" and cursor + 1 < len(tokens):
            cursor += 1
        if (
            cursor + 1 < len(tokens)
            and tokens[cursor].value == "."
            and tokens[cursor + 1].kind == "identifier"
        ):
            members.add(tokens[cursor + 1].value)
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
    end = cursor + 1
    rebound: set[str] = set()
    while end < len(tokens) and depth:
        token = tokens[end]
        if token.value == opener:
            depth += 1
        elif token.value == closer:
            depth -= 1
        elif token.kind == "identifier" and token.value in bindings:
            next_value = tokens[end + 1].value if end + 1 < len(tokens) else None
            # `{ sourceName: localName }` does not bind the property key.
            if not (opener == "{" and next_value == ":"):
                rebound.add(token.value)
        end += 1
    return rebound


def _binding_names_in_parameter_tokens(
    tokens: list[Token], bindings: set[str]
) -> set[str]:
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
    if (
        tokens[cursor].value == ">"
        and cursor > 0
        and tokens[cursor - 1].value == "="
    ):
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
        rebound = _binding_names_in_parameter_tokens(
            tokens[param_start:param_end], bindings
        )
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
        if (
            declaration_index >= initializer_end
            or tokens[declaration_index].value not in {"const", "let"}
        ):
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


def member_call_lines(
    text: str,
    bindings: set[str],
    member: str,
    *,
    jsx: bool,
    tracked_import_starts: dict[str, set[int]] | None = None,
) -> list[int]:
    if not bindings:
        return []
    tokens = tokenize_typescript(text, jsx=jsx)
    _, brace_reverse = _matching_token_pairs(tokens, "{", "}")
    shadow_ranges = _function_shadow_ranges(tokens, bindings)
    lines: list[int] = []
    for index, token in enumerate(tokens):
        if token.kind != "identifier" or token.value not in bindings:
            continue
        # `fixture.store.setState()` and `fixture?.store.setState()` are calls
        # on a property, not on the imported binding with the same spelling.
        if index > 0 and tokens[index - 1].value == ".":
            continue
        if index > 1 and tokens[index - 2].value == "?" and tokens[index - 1].value == ".":
            continue

        # Parentheses and optional/non-null chaining do not change the receiver
        # binding: `(store).setState`, `store?.setState`, and
        # `(store)!.setState` all still target the imported store.
        preceding_parens = 0
        cursor = index - 1
        while cursor >= 0 and tokens[cursor].value == "(":
            preceding_parens += 1
            cursor -= 1
        if (
            preceding_parens
            and cursor >= 0
            and (
                tokens[cursor].kind == "identifier"
                or tokens[cursor].value in {")", "]"}
            )
        ):
            continue
        cursor = index + 1
        closed_parens = 0
        while cursor < len(tokens) and tokens[cursor].value == ")":
            closed_parens += 1
            cursor += 1
        if closed_parens != preceding_parens:
            continue
        if cursor < len(tokens) and tokens[cursor].value == "!":
            cursor += 1
        if cursor < len(tokens) and tokens[cursor].value == "?":
            cursor += 1
        if (
            cursor + 2 >= len(tokens)
            or tokens[cursor].value != "."
            or tokens[cursor + 1].value != member
        ):
            continue
        call_cursor = cursor + 2
        if (
            call_cursor + 1 < len(tokens)
            and tokens[call_cursor].value == "?"
            and tokens[call_cursor + 1].value == "."
        ):
            call_cursor += 2
        if call_cursor >= len(tokens) or tokens[call_cursor].value != "(":
            continue
        if any(
            start <= index < end and token.value in rebound
            for start, end, rebound in shadow_ranges
        ):
            continue
        if _declares_binding_in_scope(
            tokens,
            token.value,
            index,
            brace_reverse,
            (tracked_import_starts or {}).get(token.value, set()),
        ):
            continue
        lines.append(token.lineno)
    return lines


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
    source_layer = product_client_layer(product_client_relative(path))
    lib_area = (
        product_client_relative(path).split("/", 2)[1]
        if source_layer == "lib"
        else None
    )
    imported_store_bindings: set[str] = set()
    imported_store_binding_starts: dict[str, set[int]] = defaultdict(set)

    for statement in statements:
        identifiers = statement_identifiers(statement)
        identifiers.update(
            namespace_member_identifiers(
                text,
                namespace_bindings(statement),
                jsx=jsx,
            )
        )
        if is_product_client_forbidden_import(path, statement.source):
            violations.append(
                Violation(
                    "PRODUCT_CLIENT_FORBIDDEN_IMPORT",
                    path,
                    statement.lineno,
                    (
                        "product-client must use its typed host boundary instead of "
                        f"importing {statement.source!r}"
                    ),
                )
            )
            continue

        target = resolve_product_client_import(path, statement.source)
        target_layer = product_client_layer(target) if target is not None else None
        if target_layer is not None and (source_layer, target_layer) in PRODUCT_CLIENT_FORBIDDEN_LAYER_EDGES:
            edge_kind = "type-only" if statement.type_only else "runtime"
            violations.append(
                Violation(
                    "PRODUCT_CLIENT_LAYER_DIRECTION",
                    path,
                    statement.lineno,
                    (
                        f"{edge_kind} {source_layer} -> {target_layer} import is upward; "
                        "move the dependency or its owned type to the lower layer"
                    ),
                )
            )

        if target_layer == "stores":
            statement_bindings = imported_bindings(statement)
            imported_store_bindings.update(statement_bindings)
            if statement.local_bindings:
                for binding in statement_bindings:
                    imported_store_binding_starts[binding].add(statement.start)

        query_hook_has_specific_owner = source_layer == "stores" or (
            source_layer == "lib" and lib_area in {"domain", "workflows"}
        )
        if (
            not query_hook_has_specific_owner
            and statement.source == "@tanstack/react-query"
            and identifiers.intersection(QUERY_HOOK_NAMES)
            and not is_product_client_query_hook_owner(path)
        ):
            violations.append(
                Violation(
                    "QUERY_HOOK_OUTSIDE_ACCESS_OR_CACHE",
                    path,
                    statement.lineno,
                    (
                        "React Query query/mutation hooks belong under hooks/access/** "
                        "or a product hooks/**/cache/** owner"
                    ),
                )
            )

        internal_store_access = (
            source_layer == "stores"
            and target is not None
            and target.startswith("lib/access/")
        )

        if (
            "getAnyHarnessClient" in identifiers
            and not internal_store_access
            and not is_anyharness_client_path(relative(path))
        ):
            violations.append(
                Violation(
                    "ANYHARNESS_CLIENT_OUTSIDE_ACCESS",
                    path,
                    statement.lineno,
                    "getAnyHarnessClient must stay behind AnyHarness access boundaries",
                )
            )

        if source_layer == "components" and target is not None and target.startswith("lib/access/"):
            violations.append(
                Violation(
                    "COMPONENT_FORBIDDEN_ACCESS",
                    path,
                    statement.lineno,
                    "components must call hooks instead of importing lib/access directly",
                )
            )

        if internal_store_access:
            violations.append(
                Violation(
                    "STORE_FORBIDDEN_ACCESS",
                    path,
                    statement.lineno,
                    "stores must receive access-owned values instead of importing lib/access",
                )
            )

        runtime_access_import = (
            not statement.type_only
            and source_layer == "stores"
            and not internal_store_access
            and (
                statement.source == "@tanstack/react-query"
                or statement.source.startswith("@proliferate/cloud-sdk-react")
                or statement.source.startswith("@anyharness/sdk-react")
                or bool(identifiers.intersection(RAW_CLIENT_BINDINGS))
            )
        )
        if runtime_access_import:
            violations.append(
                Violation(
                    "STORE_RUNTIME_ACCESS",
                    path,
                    statement.lineno,
                    "stores must not import query/React SDK clients or raw client constructors",
                )
            )

        if source_layer == "lib":
            rule_id = (
                "DOMAIN_FORBIDDEN_IMPORT"
                if lib_area == "domain"
                else "WORKFLOW_FORBIDDEN_IMPORT"
                if lib_area == "workflows"
                else None
            )
            forbidden_lib_import = (
                statement.source in {"react", "react-dom", "@tanstack/react-query"}
                or (target is not None and target.startswith("lib/access/"))
            )
            if rule_id is not None and forbidden_lib_import:
                violations.append(
                    Violation(
                        rule_id,
                        path,
                        statement.lineno,
                        f"lib/{lib_area} must remain non-React and free of query/raw access imports",
                    )
                )

    for lineno in member_call_lines(
        text,
        imported_store_bindings,
        "setState",
        jsx=jsx,
        tracked_import_starts=imported_store_binding_starts,
    ):
        violations.append(
            Violation(
                "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER",
                path,
                lineno,
                "call an action owned by the store instead of mutating imported store state directly",
            )
        )

    if source_layer == "stores":
        for lineno in direct_call_lines(text, "fetch", jsx=jsx):
            violations.append(
                Violation(
                    "STORE_RUNTIME_ACCESS",
                    path,
                    lineno,
                    "stores must receive fetched values through actions instead of calling fetch directly",
                )
            )

    for token in tokenize_typescript(text, jsx=jsx):
        if token.kind == "identifier" and token.value.startswith("__TAURI"):
            violations.append(
                Violation(
                    "PRODUCT_CLIENT_FORBIDDEN_IMPORT",
                    path,
                    token.lineno,
                    "product-client must use its typed host boundary instead of raw __TAURI* globals",
                )
            )

    return violations


def find_radix_import_violations() -> list[Violation]:
    """Rule: `@radix-ui/*` imports are legal only under the ui component
    library's base tiers (`primitives/`, `patterns/`) per the component-library
    taxonomy in specs/codebase/platforms/product/design-system.md.
    """
    violations: list[Violation] = []
    for path in iter_files_in_roots(ALL_FRONTEND_SRC_ROOTS):
        rel = relative(path)
        if is_ui_component_library_path(rel):
            continue
        for lineno, raw_line in enumerate(path.read_text().splitlines(), start=1):
            if is_block_comment_line(raw_line):
                continue
            line = strip_line_comment(raw_line)
            if not line.strip():
                continue
            if "@radix-ui/" in line:
                violations.append(
                    Violation(
                        "RADIX_IMPORT_OUTSIDE_UI_COMPONENT_LIBRARY",
                        path,
                        lineno,
                        (
                            "@radix-ui/* imports must stay under "
                            "apps/packages/ui/src/primitives/** or "
                            "apps/packages/ui/src/patterns/**"
                        ),
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
    for path in iter_files_in_roots(
        [UI_SRC, PRODUCT_UI_SRC, PRODUCT_SURFACES_SRC, PRODUCT_CLIENT_SRC, DESKTOP_SRC, WEB_SRC]
    ):
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
                        "WARNING_TOKEN_AS_INK",
                        path,
                        lineno,
                        (
                            f"`{utility}` uses the warning FILL token where the "
                            f"purpose-built token belongs — use `{replacement}`. "
                            "`--color-warning` is rgba(...,0.15) in dark mode, so "
                            "this renders effectively invisible."
                        ),
                    )
                )
    return violations


def find_ui_src_top_level_violations() -> list[Violation]:
    """Rule: apps/packages/ui/src may only contain the top-level entries named
    in the component-library taxonomy (specs/codebase/platforms/product/design-system.md):
    primitives/, patterns/, icons/, lib/, utils/, overlays/.
    """
    violations: list[Violation] = []
    if not UI_SRC.exists():
        return violations
    for entry in sorted(UI_SRC.iterdir()):
        if entry.name in UI_SRC_ALLOWED_TOP_LEVEL_ENTRIES:
            continue
        if entry.name.startswith("."):
            # Dotfiles (.DS_Store and similar OS/editor artifacts) are not
            # library taxonomy entries at all — nothing to flag.
            continue
        violations.append(
            Violation(
                "UI_SRC_TOP_LEVEL_ENTRY",
                entry,
                1,
                (
                    f"apps/packages/ui/src/{entry.name} is not an allowed top-level "
                    "entry per the component-library taxonomy in "
                    "specs/codebase/platforms/product/design-system.md "
                    f"(allowed: {', '.join(sorted(UI_SRC_ALLOWED_TOP_LEVEL_ENTRIES))})"
                ),
            )
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
        violations.extend(find_product_client_violations(path))
    violations.extend(find_radix_import_violations())
    violations.extend(find_ui_src_top_level_violations())
    violations.extend(find_warning_ink_violations())
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
