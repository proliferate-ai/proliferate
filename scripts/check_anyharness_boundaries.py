#!/usr/bin/env python3

from __future__ import annotations

from collections import Counter, defaultdict
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import re
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
LIB_SRC_RELATIVE = ("anyharness", "crates", "anyharness-lib", "src")
LIB_SRC = REPO_ROOT.joinpath(*LIB_SRC_RELATIVE)
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "anyharness_boundaries_allowlist.txt"

# Tests point the scan at a fabricated tree via `scan_root(...)` (or by calling
# `check_file`/`collect_violations` with an explicit root). When no override is
# active the module constants win, so CLI behaviour is unchanged.
_ROOT_OVERRIDE: Path | None = None


def repo_root() -> Path:
    return _ROOT_OVERRIDE if _ROOT_OVERRIDE is not None else REPO_ROOT


def lib_src() -> Path:
    if _ROOT_OVERRIDE is not None:
        return _ROOT_OVERRIDE.joinpath(*LIB_SRC_RELATIVE)
    return LIB_SRC


@contextmanager
def scan_root(root: Path | None):
    """Temporarily treat `root` as the repository root for path classification."""
    global _ROOT_OVERRIDE
    if root is None:
        yield
        return
    previous = _ROOT_OVERRIDE
    _ROOT_OVERRIDE = Path(root).resolve()
    try:
        yield
    finally:
        _ROOT_OVERRIDE = previous

HTTP_TRANSPORT_ROOTS = {"axum", "headers", "http", "http_body", "tower", "utoipa"}
PRODUCT_DOMAIN_ROOTS = {"domains"}
LIVE_RUNTIME_ROOTS = {"acp", "live"}
PRODUCT_SURFACE_DOMAINS = {"cowork", "mobility", "plans", "plugins", "reviews"}
DOMAIN_PATH_PREFIXES = (
    "anyharness/crates/anyharness-lib/src/domains/",
)
CORE_DOMAIN_PATH_PREFIXES = (
    "anyharness/crates/anyharness-lib/src/domains/agents/",
    "anyharness/crates/anyharness-lib/src/domains/repo_roots/",
    "anyharness/crates/anyharness-lib/src/domains/sessions/",
    "anyharness/crates/anyharness-lib/src/domains/workspaces/",
)
LIVE_SESSIONS_PREFIX = "anyharness/crates/anyharness-lib/src/live/sessions/"
LIVE_SESSIONS_ACTOR_PREFIX = "anyharness/crates/anyharness-lib/src/live/sessions/actor/"
LIVE_SESSIONS_HANDLE = "anyharness/crates/anyharness-lib/src/live/sessions/handle.rs"
LIVE_SESSIONS_PRIVATE_MODULES = {
    "actor",
    "background_work",
    "driver",
    "event_sink",
    "interactions",
    "replay",
}
SESSION_EVENT_SINK_PREFIXES = (
    "anyharness/crates/anyharness-lib/src/live/sessions/event_sink/",
)
TOKEN_RE = re.compile(r"r#[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|::|[{}(),;*]")
USE_START_RE = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+")
SESSION_COMMAND_USE_RE = re.compile(
    r"(?:\bSessionCommand|crate::live::sessions::actor::command::SessionCommand)\s*::"
)
COMMAND_TX_ACCESS_RE = re.compile(r"\.command_tx\b")
CONTRACT_REQUEST_RESPONSE_RE = re.compile(
    r"\b(?:(?:anyharness_contract::)?v1(?:::[A-Za-z_][A-Za-z0-9_]*)*)::"
    r"([A-Z][A-Za-z0-9_]*(?:Request|Response))\b"
)

LIB_SRC_PREFIX = "anyharness/crates/anyharness-lib/src/"
API_PREFIX = f"{LIB_SRC_PREFIX}api/"
DOMAINS_PREFIX = f"{LIB_SRC_PREFIX}domains/"
LIVE_PREFIX = f"{LIB_SRC_PREFIX}live/"

# The domain runtime valve: the only files in a domain allowed to hold live/
# handles, managers and services. Everything else takes facts, not machinery.
DOMAIN_RUNTIME_VALVE_FILES = {"runtime.rs", "live_ports.rs"}
DOMAIN_RUNTIME_VALVE_DIR = "runtime"
# Domains legally implement live-defined observer traits, which means importing
# the live model shapes those traits speak in (`crate::live::<area>::model::..`).
# That inversion is sanctioned; only "power" imports are valved.
LIVE_MODEL_SEGMENT = "model"
STORE_SEGMENTS = {"store"}
STORE_OR_SERVICE_SEGMENTS = {"store", "service"}
DOMAIN_STORE_FORBIDDEN_ROOTS = {"acp", "live"}
POLICY_FILE_SUFFIX = "_policy.rs"
CONTRACT_CRATE_ROOT = "anyharness_contract"

# Inline `crate::live::<area>::<second>` path uses (fn param types, turbofish,
# fully-qualified calls). `<second>` lets the model-shape exception apply to
# inline uses exactly as it does to use-statements.
LIVE_INLINE_PATH_RE = re.compile(
    r"\bcrate::live::(?P<area>[A-Za-z_][A-Za-z0-9_]*)"
    r"(?:::(?P<second>[A-Za-z_][A-Za-z0-9_]*))?"
)
STORE_METHOD_CALL_RE = re.compile(r"\.store\(\)")
STORE_CONSTRUCTOR_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9_]*Store::new\b")
POLICY_IMPURITY_RES = (
    re.compile(r"\bUtc::now\b"),
    re.compile(r"\bLocal::now\b"),
    re.compile(r"\bSystemTime::now\b"),
    re.compile(r"\bInstant::now\b"),
    re.compile(r"\bUuid::new_v4\b"),
    re.compile(r"\brand::"),
)
# Calibrated against domains/**: these seven patterns hit every embedded-SQL
# line found outside store code with zero false positives (no log strings, no
# identifiers that merely contain a keyword).
SQL_RES = (
    re.compile(r"\bINSERT INTO\b"),
    re.compile(r"\bSELECT\b.*\bFROM\b"),
    re.compile(r"\bON CONFLICT\b"),
    re.compile(r"\bCREATE TABLE\b"),
    re.compile(r"\bDELETE FROM\b"),
    re.compile(r"\bUPDATE\b.*\bSET\b"),
    re.compile(r"\bparams!|\brusqlite::params\b"),
)

DOMAIN_LIVE_VALVE_MESSAGE = (
    "domain code may reach live/ only through the domain's runtime valve "
    "(runtime.rs, runtime/**, live_ports.rs) — promote this use case to the "
    "runtime; see anyharness-structure.md"
)
LIVE_DOMAIN_STORE_MESSAGE = (
    "live/ never fetches — pass facts in the launch bundle or add a capability "
    "trait wired in app/"
)
API_STORE_ESCAPE_MESSAGE = (
    "handlers call domain facades, never stores — add a facade method; "
    "see anyharness-structure.md"
)
POLICY_PURITY_MESSAGE = (
    "policy files are pure: facts in, decisions out — no clock, no ids, no "
    "store; mint in execute"
)
DOMAIN_SQL_OUTSIDE_STORE_MESSAGE = (
    "SQL belongs in the domain's store — move this query into store.rs/store/**; "
    "see anyharness-structure.md"
)
DOMAIN_CONTRACT_IMPORT_MESSAGE = (
    "domain code must not import wire contract types below the API mapper "
    "boundary — use a domain twin; see anyharness-structure.md"
)


def path_relative_to_root(path: Path) -> str:
    """Repo-relative posix path; already-relative paths pass through unchanged."""
    try:
        return path.relative_to(repo_root()).as_posix()
    except ValueError:
        return path.as_posix()


@dataclass(frozen=True)
class Violation:
    rule_id: str
    path: Path
    lineno: int
    message: str

    def __post_init__(self) -> None:
        # Resolved at construction so a violation keeps its reported path after a
        # `scan_root(...)` override is unwound.
        object.__setattr__(self, "_relative_path", path_relative_to_root(self.path))

    @property
    def relative_path(self) -> str:
        return self._relative_path  # type: ignore[attr-defined]

    def format(self) -> str:
        return f"{self.relative_path}:{self.lineno}: [{self.rule_id}] {self.message}"


@dataclass(frozen=True)
class AllowlistEntry:
    rule_id: str
    relative_path: str
    count: int
    reason: str


@dataclass(frozen=True)
class Token:
    value: str
    lineno: int

    @property
    def is_ident(self) -> bool:
        return bool(re.match(r"^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$", self.value))


@dataclass(frozen=True)
class ImportPath:
    parts: tuple[str, ...]
    lines: tuple[int, ...]

    @property
    def root(self) -> str | None:
        return self.parts[0] if self.parts else None

    @property
    def crate_root(self) -> str | None:
        if len(self.parts) >= 2 and self.parts[0] == "crate":
            return self.parts[1]
        return None

    @property
    def crate_root_line(self) -> int:
        if len(self.lines) >= 2 and self.parts and self.parts[0] == "crate":
            return self.lines[1]
        if self.lines:
            return self.lines[0]
        return 1

    def starts_with_crate(self, *prefix: str) -> bool:
        return self.parts[: len(prefix) + 1] == ("crate", *prefix)

    def starts_with(self, *prefix: str) -> bool:
        return self.parts[: len(prefix)] == prefix

    @property
    def leaf(self) -> str | None:
        if not self.parts:
            return None
        return self.parts[-1]


def strip_line_comment(line: str) -> str:
    return line.split("//", 1)[0]


def relative(path: Path) -> str:
    return path_relative_to_root(path)


def is_under(relative_path: str, prefix: str) -> bool:
    return relative_path.startswith(prefix)


def is_domain_path(relative_path: str) -> bool:
    return any(is_under(relative_path, prefix) for prefix in DOMAIN_PATH_PREFIXES)


def is_core_domain_path(relative_path: str) -> bool:
    return any(is_under(relative_path, prefix) for prefix in CORE_DOMAIN_PATH_PREFIXES)


def is_product_surface_domain_import(import_path: ImportPath) -> bool:
    return (
        len(import_path.parts) >= 3
        and import_path.parts[0] == "crate"
        and import_path.parts[1] == "domains"
        and import_path.parts[2] in PRODUCT_SURFACE_DOMAINS
    )


def is_live_session_private_import(import_path: ImportPath) -> bool:
    return (
        len(import_path.parts) >= 4
        and import_path.parts[0] == "crate"
        and import_path.parts[1] == "live"
        and import_path.parts[2] == "sessions"
        and import_path.parts[3] in LIVE_SESSIONS_PRIVATE_MODULES
    )


def is_session_command_import(import_path: ImportPath) -> bool:
    return (
        import_path.starts_with_crate("live", "sessions", "actor", "command")
        and import_path.leaf == "SessionCommand"
    )


def is_contract_request_response_import(import_path: ImportPath) -> bool:
    return (
        import_path.starts_with("anyharness_contract", "v1")
        and import_path.leaf is not None
        and (import_path.leaf.endswith("Request") or import_path.leaf.endswith("Response"))
    )


def in_api_or_app(relative_path: str) -> bool:
    return (
        is_under(relative_path, "anyharness/crates/anyharness-lib/src/api/")
        or is_under(relative_path, "anyharness/crates/anyharness-lib/src/app/")
    )


def in_live_sessions(relative_path: str) -> bool:
    return is_under(relative_path, LIVE_SESSIONS_PREFIX)


def in_command_tx_allowed_path(relative_path: str) -> bool:
    return relative_path == LIVE_SESSIONS_HANDLE or is_under(
        relative_path, LIVE_SESSIONS_ACTOR_PREFIX
    )


def in_session_event_sink(relative_path: str) -> bool:
    return any(is_under(relative_path, prefix) for prefix in SESSION_EVENT_SINK_PREFIXES)


def domain_relative_parts(relative_path: str) -> tuple[str, ...]:
    """The path parts below `domains/`, e.g. ('sessions', 'runtime', 'fork.rs')."""
    if not is_under(relative_path, DOMAINS_PREFIX):
        return ()
    return tuple(relative_path[len(DOMAINS_PREFIX) :].split("/"))


def in_domain_runtime_valve(relative_path: str) -> bool:
    """Files allowed to hold live/ machinery: runtime.rs, runtime/**, live_ports.rs."""
    parts = domain_relative_parts(relative_path)
    if not parts:
        return False
    if parts[-1] in DOMAIN_RUNTIME_VALVE_FILES:
        return True
    return DOMAIN_RUNTIME_VALVE_DIR in parts[:-1]


def is_live_model_import(import_path: ImportPath) -> bool:
    """crate::live::<area>::model::.. — the sanctioned observer-trait inversion."""
    return (
        len(import_path.parts) >= 4
        and import_path.parts[0] == "crate"
        and import_path.parts[1] == "live"
        and import_path.parts[3] == LIVE_MODEL_SEGMENT
    )


def in_domain_store(relative_path: str) -> bool:
    """domains/<d>/**/store/** or a store.rs sitting inside a domain."""
    parts = domain_relative_parts(relative_path)
    if len(parts) < 2:
        return False
    if parts[-1] == "store.rs":
        return True
    return "store" in parts[:-1]


def is_policy_file(relative_path: str) -> bool:
    return bool(domain_relative_parts(relative_path)) and relative_path.endswith(
        POLICY_FILE_SUFFIX
    )


def has_segment(import_path: ImportPath, segments: set[str]) -> bool:
    return any(part in segments for part in import_path.parts)


def is_domain_store_or_service_import(import_path: ImportPath) -> bool:
    return import_path.starts_with_crate("domains") and has_segment(
        import_path, STORE_OR_SERVICE_SEGMENTS
    )


def is_domain_store_import(import_path: ImportPath) -> bool:
    return import_path.starts_with_crate("domains") and has_segment(
        import_path, STORE_SEGMENTS
    )


def should_skip(path: Path) -> bool:
    if path.name.endswith("_tests.rs") or path.name == "tests.rs":
        return True
    return any(part == "tests" for part in path.relative_to(lib_src()).parts)


def iter_anyharness_files() -> list[Path]:
    return [
        path
        for path in sorted(lib_src().rglob("*.rs"))
        if path.is_file() and not should_skip(path)
    ]


def iter_use_statements(path: Path) -> list[tuple[int, list[str]]]:
    statements: list[tuple[int, list[str]]] = []
    current: list[str] = []
    start_line = 0

    for lineno, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = strip_line_comment(raw_line)
        if not current:
            if not USE_START_RE.search(line):
                continue
            start_line = lineno
        current.append(line)
        if ";" in line:
            statements.append((start_line, current))
            current = []
            start_line = 0

    return statements


def tokenize_use_statement(start_line: int, lines: list[str]) -> list[Token]:
    tokens: list[Token] = []
    for offset, line in enumerate(lines):
        lineno = start_line + offset
        for match in TOKEN_RE.finditer(line):
            tokens.append(Token(match.group(0), lineno))
    return tokens


def parse_use_paths(start_line: int, lines: list[str]) -> list[ImportPath]:
    tokens = tokenize_use_statement(start_line, lines)
    try:
        use_index = next(index for index, token in enumerate(tokens) if token.value == "use")
    except StopIteration:
        return []
    parser = UseTreeParser(tokens[use_index + 1 :])
    return parser.parse()


class UseTreeParser:
    def __init__(self, tokens: list[Token]) -> None:
        self.tokens = tokens
        self.index = 0

    def current(self) -> Token | None:
        if self.index >= len(self.tokens):
            return None
        return self.tokens[self.index]

    def advance(self) -> Token | None:
        token = self.current()
        if token is not None:
            self.index += 1
        return token

    def consume(self, value: str) -> bool:
        token = self.current()
        if token is None or token.value != value:
            return False
        self.index += 1
        return True

    def parse(self) -> list[ImportPath]:
        return self.parse_tree((), ())

    def parse_tree(
        self,
        prefix_parts: tuple[str, ...],
        prefix_lines: tuple[int, ...],
    ) -> list[ImportPath]:
        parts = list(prefix_parts)
        lines = list(prefix_lines)

        while True:
            token = self.current()
            if token is None or token.value in {",", "}", ";"}:
                return [ImportPath(tuple(parts), tuple(lines))] if parts else []

            if token.value == "{":
                self.advance()
                return self.parse_group(tuple(parts), tuple(lines))

            if token.value == "*":
                self.advance()
                return [ImportPath(tuple(parts + ["*"]), tuple(lines + [token.lineno]))]

            if not token.is_ident:
                self.advance()
                continue

            ident = self.advance()
            assert ident is not None
            if ident.value == "as":
                self.skip_alias()
                return [ImportPath(tuple(parts), tuple(lines))] if parts else []

            parts.append(ident.value)
            lines.append(ident.lineno)

            if self.consume("::"):
                if self.current() is not None and self.current().value == "{":
                    self.advance()
                    return self.parse_group(tuple(parts), tuple(lines))
                continue

            if self.current() is not None and self.current().value == "as":
                self.skip_alias()
            return [ImportPath(tuple(parts), tuple(lines))]

    def parse_group(
        self,
        prefix_parts: tuple[str, ...],
        prefix_lines: tuple[int, ...],
    ) -> list[ImportPath]:
        paths: list[ImportPath] = []

        while True:
            token = self.current()
            if token is None:
                break
            if token.value == "}":
                self.advance()
                break
            if token.value == ",":
                self.advance()
                continue
            paths.extend(self.parse_tree(prefix_parts, prefix_lines))

        return paths

    def skip_alias(self) -> None:
        self.consume("as")
        token = self.current()
        if token is not None and token.is_ident:
            self.advance()


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


def check_api_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_if(
        violations,
        import_path.crate_root in LIVE_RUNTIME_ROOTS,
        "API_LIVE_RUNTIME_IMPORT",
        path,
        import_path.crate_root_line,
        "api/** must not import live runtime internals directly",
    )


def check_domains_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_if(
        violations,
        import_path.starts_with_crate("api"),
        "DOMAINS_API_IMPORT",
        path,
        import_path.crate_root_line,
        "domains/** must not import api/**",
    )


def check_core_domain_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_if(
        violations,
        is_product_surface_domain_import(import_path),
        "CORE_DOMAIN_PRODUCT_IMPORT",
        path,
        import_path.crate_root_line,
        "core domains must not directly import product surface domains",
    )


def check_adapters_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    crate_root = import_path.crate_root
    add_if(
        violations,
        crate_root in PRODUCT_DOMAIN_ROOTS,
        "ADAPTERS_PRODUCT_DOMAIN_IMPORT",
        path,
        import_path.crate_root_line,
        "adapters/** must not import product/domain layers",
    )
    add_if(
        violations,
        crate_root in LIVE_RUNTIME_ROOTS,
        "ADAPTERS_LIVE_RUNTIME_IMPORT",
        path,
        import_path.crate_root_line,
        "adapters/** must not import live runtime internals",
    )
    add_if(
        violations,
        import_path.starts_with_crate("api") or import_path.root in HTTP_TRANSPORT_ROOTS,
        "ADAPTERS_API_IMPORT",
        path,
        import_path.crate_root_line,
        "adapters/** must not import API or HTTP transport layers",
    )


def check_integrations_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    crate_root = import_path.crate_root
    add_if(
        violations,
        crate_root in PRODUCT_DOMAIN_ROOTS,
        "INTEGRATIONS_PRODUCT_IMPORT",
        path,
        import_path.crate_root_line,
        "integrations/** must not import product/domain layers",
    )
    add_if(
        violations,
        import_path.starts_with_crate("api") or import_path.root in HTTP_TRANSPORT_ROOTS,
        "INTEGRATIONS_API_IMPORT",
        path,
        import_path.crate_root_line,
        "integrations/** must not import API or HTTP transport layers",
    )


def check_domain_store_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    """Generalized from the sessions-only rule: every domain store is a leaf."""
    add_if(
        violations,
        import_path.starts_with_crate("api"),
        "DOMAIN_STORE_API_IMPORT",
        path,
        import_path.crate_root_line,
        "domain store code must not import api/** — stores are persistence leaves",
    )
    add_if(
        violations,
        import_path.crate_root in DOMAIN_STORE_FORBIDDEN_ROOTS,
        "DOMAIN_STORE_LIVE_IMPORT",
        path,
        import_path.crate_root_line,
        "domain store code must not import live/acp runtime modules — stores are "
        "persistence leaves",
    )


def check_event_sink_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_if(
        violations,
        import_path.starts_with_crate("api"),
        "EVENT_SINK_API_IMPORT",
        path,
        import_path.crate_root_line,
        "session event sink code must not import api/**",
    )
    add_if(
        violations,
        import_path.root in HTTP_TRANSPORT_ROOTS,
        "EVENT_SINK_HTTP_TRANSPORT_IMPORT",
        path,
        import_path.lines[0] if import_path.lines else 1,
        "session event sink code must not import HTTP transport crates",
    )


def check_persistence_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    crate_root = import_path.crate_root
    add_if(
        violations,
        crate_root in PRODUCT_DOMAIN_ROOTS,
        "PERSISTENCE_PRODUCT_IMPORT",
        path,
        import_path.crate_root_line,
        "persistence/** must not import product/domain layers",
    )
    add_if(
        violations,
        crate_root in LIVE_RUNTIME_ROOTS,
        "PERSISTENCE_RUNTIME_IMPORT",
        path,
        import_path.crate_root_line,
        "persistence/** must not import live runtime layers",
    )
    add_if(
        violations,
        import_path.starts_with_crate("api") or import_path.root in HTTP_TRANSPORT_ROOTS,
        "PERSISTENCE_API_IMPORT",
        path,
        import_path.crate_root_line,
        "persistence/** must not import API or HTTP transport layers",
    )


def check_live_session_private_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    rel = relative(path)
    add_if(
        violations,
        not in_live_sessions(rel) and is_live_session_private_import(import_path),
        "LIVE_SESSION_PRIVATE_IMPORT",
        path,
        import_path.crate_root_line,
        "live session actor/driver internals must stay inside live/sessions/**",
    )
    add_if(
        violations,
        not in_live_sessions(rel) and is_session_command_import(import_path),
        "SESSION_COMMAND_IMPORT",
        path,
        import_path.lines[-1] if import_path.lines else import_path.crate_root_line,
        "SessionCommand is a private actor command and must not be imported outside live/sessions/**",
    )


def check_app_state_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    rel = relative(path)
    add_if(
        violations,
        not in_api_or_app(rel)
        and import_path.starts_with_crate("app")
        and import_path.leaf == "AppState",
        "APP_STATE_IMPORT",
        path,
        import_path.lines[-1] if import_path.lines else import_path.crate_root_line,
        "AppState must stay at the API/app/test-support boundary",
    )


def check_domain_contract_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    rel = relative(path)
    add_if(
        violations,
        is_domain_path(rel) and is_contract_request_response_import(import_path),
        "DOMAIN_CONTRACT_REQUEST_RESPONSE",
        path,
        import_path.lines[-1] if import_path.lines else 1,
        "domain code must not use contract request/response types below the API mapper boundary",
    )


def check_domain_live_valve_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_if(
        violations,
        import_path.crate_root == "live" and not is_live_model_import(import_path),
        "DOMAIN_LIVE_VALVE",
        path,
        import_path.crate_root_line,
        DOMAIN_LIVE_VALVE_MESSAGE,
    )


def check_live_domain_store_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_if(
        violations,
        is_domain_store_or_service_import(import_path),
        "LIVE_DOMAIN_STORE_IMPORT",
        path,
        import_path.crate_root_line,
        LIVE_DOMAIN_STORE_MESSAGE,
    )


def check_api_store_escape_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_if(
        violations,
        is_domain_store_import(import_path),
        "API_STORE_ESCAPE",
        path,
        import_path.crate_root_line,
        API_STORE_ESCAPE_MESSAGE,
    )


def check_policy_purity_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_if(
        violations,
        has_segment(import_path, STORE_SEGMENTS) or import_path.crate_root == "adapters",
        "POLICY_PURITY",
        path,
        import_path.crate_root_line,
        POLICY_PURITY_MESSAGE,
    )


def check_domain_contract_crate_import(
    violations: list[Violation],
    path: Path,
    start_line: int,
    import_paths: list[ImportPath],
) -> None:
    """One violation per use-statement, matching the engine's import granularity."""
    add_if(
        violations,
        any(import_path.root == CONTRACT_CRATE_ROOT for import_path in import_paths),
        "DOMAIN_CONTRACT_IMPORT",
        path,
        start_line,
        DOMAIN_CONTRACT_IMPORT_MESSAGE,
    )


def has_non_model_live_use(line: str) -> bool:
    """An inline `crate::live::..` path use that is not a live model shape."""
    for match in LIVE_INLINE_PATH_RE.finditer(line):
        if match.group("second") != LIVE_MODEL_SEGMENT:
            return True
    return False


def check_line_patterns(violations: list[Violation], path: Path) -> None:
    rel = relative(path)
    allow_session_private = in_live_sessions(rel)
    allow_command_tx = in_command_tx_allowed_path(rel)
    allow_app_state = in_api_or_app(rel)
    check_contract_types = is_domain_path(rel)
    in_domains = is_under(rel, DOMAINS_PREFIX)
    check_live_valve = in_domains and not in_domain_runtime_valve(rel)
    check_api_store_escape = is_under(rel, API_PREFIX)
    check_policy_purity = is_policy_file(rel)
    check_domain_sql = in_domains and not in_domain_store(rel)

    for lineno, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = strip_line_comment(raw_line)
        is_use_line = line.lstrip().startswith("use ")
        # The new rules also share the use-statement pass, so they must not
        # re-count `pub use` lines that `is_use_line` misses.
        starts_use_statement = USE_START_RE.search(line) is not None
        if check_live_valve and not starts_use_statement:
            add_if(
                violations,
                has_non_model_live_use(line),
                "DOMAIN_LIVE_VALVE",
                path,
                lineno,
                DOMAIN_LIVE_VALVE_MESSAGE,
            )
        if check_api_store_escape and not starts_use_statement:
            add_if(
                violations,
                STORE_METHOD_CALL_RE.search(line) is not None
                or STORE_CONSTRUCTOR_RE.search(line) is not None,
                "API_STORE_ESCAPE",
                path,
                lineno,
                API_STORE_ESCAPE_MESSAGE,
            )
        if check_policy_purity and not starts_use_statement:
            add_if(
                violations,
                any(pattern.search(line) is not None for pattern in POLICY_IMPURITY_RES),
                "POLICY_PURITY",
                path,
                lineno,
                POLICY_PURITY_MESSAGE,
            )
        if check_domain_sql:
            add_if(
                violations,
                any(pattern.search(line) is not None for pattern in SQL_RES),
                "DOMAIN_SQL_OUTSIDE_STORE",
                path,
                lineno,
                DOMAIN_SQL_OUTSIDE_STORE_MESSAGE,
            )
        add_if(
            violations,
            not allow_session_private and SESSION_COMMAND_USE_RE.search(line) is not None,
            "SESSION_COMMAND_USE",
            path,
            lineno,
            "SessionCommand construction/use must stay behind the live session handle",
        )
        add_if(
            violations,
            not allow_command_tx and COMMAND_TX_ACCESS_RE.search(line) is not None,
            "LIVE_SESSION_COMMAND_TX_ACCESS",
            path,
            lineno,
            "LiveSessionHandle.command_tx must not be accessed outside the live session boundary",
        )
        add_if(
            violations,
            not allow_app_state and not is_use_line and "crate::app::AppState" in line,
            "APP_STATE_IMPORT",
            path,
            lineno,
            "AppState must stay at the API/app/test-support boundary",
        )
        if check_contract_types and not is_use_line:
            add_if(
                violations,
                CONTRACT_REQUEST_RESPONSE_RE.search(line) is not None,
                "DOMAIN_CONTRACT_REQUEST_RESPONSE",
                path,
                lineno,
                "domain code must not use contract request/response types below the API mapper boundary",
            )


def check_file(path: Path, root: Path | None = None) -> list[Violation]:
    with scan_root(root):
        return _check_file(path)


def _check_file(path: Path) -> list[Violation]:
    rel = relative(path)
    violations: list[Violation] = []
    in_api = is_under(rel, API_PREFIX)
    in_domains = is_under(rel, DOMAINS_PREFIX)
    in_live = is_under(rel, LIVE_PREFIX)
    in_core_domain = is_core_domain_path(rel)
    in_adapters = is_under(rel, f"{LIB_SRC_PREFIX}adapters/")
    in_integrations = is_under(rel, f"{LIB_SRC_PREFIX}integrations/")
    in_domain_store_leaf = in_domain_store(rel)
    in_event_sink = in_session_event_sink(rel)
    in_persistence = is_under(rel, f"{LIB_SRC_PREFIX}persistence/")
    in_live_valve = in_domains and in_domain_runtime_valve(rel)
    in_policy = is_policy_file(rel)

    for start_line, lines in iter_use_statements(path):
        import_paths = parse_use_paths(start_line, lines)
        for import_path in import_paths:
            if not import_path.parts:
                continue
            if in_api:
                check_api_import(violations, path, import_path)
                check_api_store_escape_import(violations, path, import_path)
            if in_domains:
                check_domains_import(violations, path, import_path)
                if not in_live_valve:
                    check_domain_live_valve_import(violations, path, import_path)
            if in_live:
                check_live_domain_store_import(violations, path, import_path)
            if in_policy:
                check_policy_purity_import(violations, path, import_path)
            if in_core_domain:
                check_core_domain_import(violations, path, import_path)
            if in_adapters:
                check_adapters_import(violations, path, import_path)
            if in_integrations:
                check_integrations_import(violations, path, import_path)
            if in_domain_store_leaf:
                check_domain_store_import(violations, path, import_path)
            if in_event_sink:
                check_event_sink_import(violations, path, import_path)
            if in_persistence:
                check_persistence_import(violations, path, import_path)
            check_live_session_private_import(violations, path, import_path)
            check_app_state_import(violations, path, import_path)
            check_domain_contract_import(violations, path, import_path)
        if in_domains:
            check_domain_contract_crate_import(violations, path, start_line, import_paths)

    check_line_patterns(violations, path)
    return violations


def load_allowlist(allowlist_path: Path | None = None) -> dict[tuple[str, str], AllowlistEntry]:
    path = ALLOWLIST_PATH if allowlist_path is None else Path(allowlist_path)
    if not path.exists():
        return {}
    try:
        label = path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        label = path.as_posix()
    entries: dict[tuple[str, str], AllowlistEntry] = {}
    for lineno, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(maxsplit=3)
        if len(parts) != 4:
            raise ValueError(f"{label}:{lineno}: expected RULE_ID path count reason")
        rule_id, relative_path, count_raw, reason = parts
        try:
            count = int(count_raw)
        except ValueError as error:
            raise ValueError(f"{label}:{lineno}: count must be an integer") from error
        if count < 1:
            raise ValueError(f"{label}:{lineno}: count must be positive")
        key = (rule_id, relative_path)
        if key in entries:
            raise ValueError(f"{label}:{lineno}: duplicate allowlist entry")
        entries[key] = AllowlistEntry(rule_id, relative_path, count, reason)
    return entries


def collect_violations(root: Path | None = None) -> list[Violation]:
    with scan_root(root):
        violations: list[Violation] = []
        for path in iter_anyharness_files():
            violations.extend(_check_file(path))
        return violations


def apply_allowlist(
    violations: list[Violation],
    allowlist: dict[tuple[str, str], AllowlistEntry],
) -> tuple[list[Violation], list[str]]:
    grouped: dict[tuple[str, str], list[Violation]] = defaultdict(list)
    for violation in violations:
        grouped[(violation.rule_id, violation.relative_path)].append(violation)

    failures: list[Violation] = []
    stale: list[str] = []

    for key, group in sorted(grouped.items()):
        entry = allowlist.get(key)
        allowed_count = entry.count if entry else 0
        if len(group) > allowed_count:
            failures.extend(group[allowed_count:])

    observed_counts = Counter((violation.rule_id, violation.relative_path) for violation in violations)
    for key, entry in sorted(allowlist.items()):
        observed = observed_counts.get(key, 0)
        if observed < entry.count:
            stale.append(
                f"{entry.relative_path}:1: [{entry.rule_id}] stale allowlist count "
                f"(observed {observed}, allowed {entry.count})"
            )

    return failures, stale


def print_summary(
    violations: list[Violation],
    allowlist: dict[tuple[str, str], AllowlistEntry],
) -> None:
    observed = Counter((violation.rule_id, violation.relative_path) for violation in violations)
    if not observed:
        return
    print("Observed AnyHarness boundary debt:")
    for (rule_id, path), count in sorted(observed.items()):
        entry = allowlist.get((rule_id, path))
        suffix = f" allowlisted={entry.count}" if entry else " unallowlisted"
        print(f"  {rule_id} {path}: {count}{suffix}")
    print()


def main() -> int:
    allowlist = load_allowlist()
    violations = collect_violations()
    failures, stale = apply_allowlist(violations, allowlist)

    if not failures and not stale:
        print("AnyHarness boundary check passed.")
        return 0

    print_summary(violations, allowlist)

    if failures:
        print("AnyHarness boundary violations not covered by allowlist:")
        for violation in sorted(failures, key=lambda item: item.format()):
            print(violation.format())

    if stale:
        if failures:
            print()
        print("Stale AnyHarness boundary allowlist entries:")
        for entry in sorted(stale):
            print(f"  {entry}")

    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as error:
        print(error, file=sys.stderr)
        raise SystemExit(2)
