#!/usr/bin/env python3
"""AnyHarness layer-boundary checker.

The rules themselves are records under `lints/anyharness/boundaries.toml`; this
file is only the engine. Diagnostics are rendered from the record (rule
sentence, legal alternative, record path) via `scripts/lint_records.py`, and
grandfathered violation sites live in `lints/anyharness/exceptions.toml` as
fine-grained `(path, site)` fingerprints — never counts.
"""

from __future__ import annotations

import re
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    # Run as `python3 scripts/check_anyharness_boundaries.py` from the repo root,
    # sys.path[0] is scripts/ — the shared loader lives one level up.
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

LIB_SRC_RELATIVE = ("anyharness", "crates", "anyharness-lib", "src")
LIB_SRC = REPO_ROOT.joinpath(*LIB_SRC_RELATIVE)
CHECKER = "scripts/check_anyharness_boundaries.py"

RULES = lint_records.load("anyharness")
OWNED_RULE_IDS = frozenset(rule.id for rule in RULES.rules.values() if rule.enforced_by == CHECKER)

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
# `acp` used to be its own crate root (`crate::acp::..`) and lived in this set.
# Grid PR 2 moved it to `crate::integrations::acp::..`, which is not a crate root
# at all -- it is two segments below `integrations`. Keeping a dead "acp" string
# here would never match anything again (no crate root is spelled "acp"; the
# old-paths check bans resurrecting `src/acp` outright) and would misdescribe
# what the set actually catches. The acp protection now lives in
# `is_acp_runtime_import`, OR'd into every rule below that used to key off this
# set including "acp".
LIVE_RUNTIME_ROOTS = {"live"}
PRODUCT_SURFACE_DOMAINS = {"cowork", "mobility", "plans", "plugins", "reviews"}
DOMAIN_PATH_PREFIXES = ("anyharness/crates/anyharness-lib/src/domains/",)
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
SESSION_EVENT_SINK_PREFIXES = ("anyharness/crates/anyharness-lib/src/live/sessions/event_sink/",)
TOKEN_RE = re.compile(r"r#[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|::|[{}(),;*]")
# `\b` rather than `\s+` after `use`: a statement whose path is pushed to the next
# line leaves `use` (or `pub use`) alone on the head line, and demanding trailing
# whitespace made such a statement invisible to the whole import pass.
USE_START_RE = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?use\b")
# A re-export specifically, not a private import: `pub use ..`, `pub(crate) use ..`.
PUB_USE_START_RE = re.compile(r"^\s*pub(?:\([^)]*\))?\s+use\b")
SESSION_COMMAND_QUALIFIED_PATH_RE = re.compile(
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
# See the comment on LIVE_RUNTIME_ROOTS: "acp" stopped being a crate root when
# grid PR 2 moved it under `integrations/`. `is_acp_runtime_import` covers it now.
DOMAIN_STORE_FORBIDDEN_ROOTS = {"live"}
POLICY_FILE_SUFFIX = "_policy.rs"
POLICY_FILE_NAME = "policy.rs"
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
# A handler can also reach a domain store without naming a store type at all, by
# reading a store field off AppState (`state.agent_seed_store.health()`). Neither
# the import pass nor the two patterns above see that, because no store type is
# mentioned on the line. AppState carries exactly one `*_store` field today,
# `agent_seed_store`, and it is NOT a DB store -- it is an in-memory
# `Arc<RwLock<AgentSeedHealth>>` snapshot that merely follows the naming law. So
# today's single match is a benign false positive, carried as an exception site
# rather than special-cased: the field-name shape is the durable signal we want to
# hold, and a real `*_store` field added later would be caught for the right
# reason. The pattern is bound to the identifier `state`, which every one of
# api/**'s handler params is spelled as today (`State(state)`); an
# `app_state.foo_store` or a rebound clone evades it. That is judgment territory,
# like the rest of the AppState-field surface noted in the known scope limits at
# the head of lints/anyharness/exceptions.toml.
APP_STATE_STORE_FIELD_RE = re.compile(r"\bstate\.[a-z_]*_store\b")
# Inline `anyharness_contract::` path uses (fn signatures, struct literals,
# turbofish) that no use-statement declares. Mirrors AH-LIVE-5's import-pass +
# line-pass pairing.
CONTRACT_INLINE_PATH_RE = re.compile(r"\banyharness_contract::")
POLICY_IMPURITY_RES = (
    re.compile(r"\bUtc::now\b"),
    re.compile(r"\bLocal::now\b"),
    re.compile(r"\bSystemTime::now\b"),
    re.compile(r"\bInstant::now\b"),
    re.compile(r"\bUuid::new_v4\b"),
    re.compile(r"\brand::"),
)
# Calibrated against domains/**: these patterns hit every embedded-SQL line found
# outside store code, with no false positives in the current tree.
#
# The first six are whole-statement shapes that fit on one line. The next three
# are keyword-anchored heads for the far more common case of SQL that rustfmt (or
# the author) split across lines: `"UPDATE sessions` / `SET col = ?1` /
# `WHERE id = ?1` each land on their own line, so a rule that demanded two
# keywords together saw none of them. Keeping the clause heads uppercase-only and
# anchored to a line start or an opening quote is what keeps most prose out: a
# lowercase "select the agent" comment or log string cannot match, and `UPDATE`
# additionally requires a lowercase table identifier after it, so `DO UPDATE SET`
# fragments do not count twice.
#
# Known limits, accepted rather than chased (pinned by unit tests so they stay
# visible):
#   * An uppercase SQL verb heading a non-SQL string still matches --
#     `bail!("UPDATE failed for {id}")` is lexically indistinguishable from
#     `"UPDATE sessions SET .."`. No regex can separate them; a match here is a
#     seedable false positive, not a defect.
#   * `SELECT` excludes only the exact literal `"SELECT"` (a keyword constant or
#     a serde rename), via `(?!")`. A built fragment `"SELECT " + cols` must keep
#     matching, so the exclusion cannot extend to a quote after whitespace.
#   * Block comments are scanned as code: strip_line_comment only understands
#     `//`, so SQL quoted inside `/* .. */` counts.
SQL_RES = (
    re.compile(r"\bINSERT INTO\b"),
    re.compile(r"\bSELECT\b.*\bFROM\b"),
    re.compile(r"\bON CONFLICT\b"),
    re.compile(r"\bCREATE TABLE\b"),
    re.compile(r"\bDELETE FROM\b"),
    re.compile(r"\bUPDATE\b.*\bSET\b"),
    re.compile(r"\bparams!|\brusqlite::params\b"),
    # Split-statement heads: the write verb and its table on one line, the clauses
    # on the next.
    re.compile(r'(?:^|")\s*SELECT\b(?!")'),
    re.compile(r'(?:^|")\s*UPDATE\s+[a-z_]'),
    re.compile(r"^\s*SET\b"),
    # Conflict-resolving inserts and drops, which the two bare-verb patterns above
    # miss because the verb and `INTO`/the table are separated by a modifier.
    re.compile(r"\bINSERT\s+OR\s+[A-Z]+\s+INTO\b"),
    re.compile(r"\bDROP TABLE\b"),
)

# A violation's fingerprint is `<enclosing symbol>::<content anchor>` — never a
# line number, so a site survives reformatting and moves within its file. The
# symbol is the nearest declaration above the hit; the anchor is the import path
# or the matched token itself.
SYMBOL_RES = (
    (re.compile(r"\bfn\s+([A-Za-z_][A-Za-z0-9_]*)"), "fn"),
    (re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)"), "mod"),
    (re.compile(r"^\s*impl\b[^{]*?\bfor\s+([A-Za-z_][A-Za-z0-9_]*)"), "impl"),
    (re.compile(r"^\s*impl\b[^{]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\{"), "impl"),
    (
        re.compile(
            r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+"
            r"([A-Za-z_][A-Za-z0-9_]*)"
        ),
        "type",
    ),
)

_LINES_CACHE: dict[tuple[str, int, int], list[str]] = {}


def file_lines(path: Path) -> list[str]:
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    cached = _LINES_CACHE.get(key)
    if cached is None:
        cached = path.read_text().splitlines()
        _LINES_CACHE[key] = cached
    return cached


def enclosing_symbol(path: Path, lineno: int) -> str:
    """Nearest declaration above `lineno`, e.g. `fn append` or `mod tests`."""
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
    site: str
    detail: str

    def __post_init__(self) -> None:
        # Resolved at construction so a violation keeps its reported path after a
        # `scan_root(...)` override is unwound.
        object.__setattr__(self, "_relative_path", path_relative_to_root(self.path))

    @property
    def relative_path(self) -> str:
        return self._relative_path  # type: ignore[attr-defined]

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


def is_acp_runtime_import(import_path: ImportPath) -> bool:
    """`crate::integrations::acp::..` — acp moved here from its own crate root
    in grid PR 2 (`crate::acp::..` -> `crate::integrations::acp::..`). It is
    still live-runtime machinery (an ACP session actor's permission/error
    surface), so every rule that used to catch it via LIVE_RUNTIME_ROOTS /
    DOMAIN_STORE_FORBIDDEN_ROOTS containing "acp" ORs this in instead — the
    crate-root sets can no longer name it directly since "acp" is not a crate
    root anymore.
    """
    return (
        len(import_path.parts) >= 3
        and import_path.parts[0] == "crate"
        and import_path.parts[1] == "integrations"
        and import_path.parts[2] == "acp"
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
    return is_under(relative_path, "anyharness/crates/anyharness-lib/src/api/") or is_under(
        relative_path, "anyharness/crates/anyharness-lib/src/app/"
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
    """`*_policy.rs` and a file named exactly `policy.rs`, anywhere under domains/**.

    The suffix test alone missed `domains/<d>/**/policy.rs`, which is the same
    thing by role and by name — a module whose whole job is deciding.
    """
    parts = domain_relative_parts(relative_path)
    if not parts:
        return False
    return parts[-1] == POLICY_FILE_NAME or relative_path.endswith(POLICY_FILE_SUFFIX)


def has_segment(import_path: ImportPath, segments: set[str]) -> bool:
    return any(part in segments for part in import_path.parts)


def is_domain_store_or_service_import(import_path: ImportPath) -> bool:
    return import_path.starts_with_crate("domains") and has_segment(
        import_path, STORE_OR_SERVICE_SEGMENTS
    )


def is_domain_store_import(import_path: ImportPath) -> bool:
    return import_path.starts_with_crate("domains") and has_segment(import_path, STORE_SEGMENTS)


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


def use_statement_linenos(path: Path) -> set[int]:
    """Every line number a use statement occupies, head and continuations alike.

    The line pass must not re-flag text the import pass already parsed. Testing
    each line for a `use` prefix is not enough: in a root-brace group
    (`use {\\n    anyharness_contract::v1::Foo,\\n};`) the interesting leaf sits on
    a continuation line that carries no prefix, so the prefix test let the line
    pass fire there while the import pass fired at the head — one import counted
    twice. Skipping the statement's whole line span fixes that by construction.
    """
    covered: set[int] = set()
    for start_line, lines in iter_use_statements(path):
        covered.update(range(start_line, start_line + len(lines)))
    return covered


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


def import_anchor(import_path: ImportPath) -> str:
    return "::".join(import_path.parts)


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


def add_import_if(
    violations: list[Violation],
    condition: bool,
    rule_id: str,
    path: Path,
    lineno: int,
    import_path: ImportPath,
) -> None:
    anchor = import_anchor(import_path)
    add_if(violations, condition, rule_id, path, lineno, anchor, f"use {anchor}")


def first_match(patterns, line: str) -> str:
    """The first pattern's matched text, whitespace-collapsed — the line anchor."""
    for pattern in patterns:
        match = pattern.search(line)
        if match:
            return re.sub(r"\s+", " ", match.group(0)).strip()
    return ""


def check_api_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_import_if(
        violations,
        import_path.crate_root in LIVE_RUNTIME_ROOTS or is_acp_runtime_import(import_path),
        "AH-API-1",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_domains_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_import_if(
        violations,
        import_path.starts_with_crate("api"),
        "AH-DOMAIN-1",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_core_domain_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_import_if(
        violations,
        is_product_surface_domain_import(import_path),
        "AH-DOMAIN-2",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_adapters_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    crate_root = import_path.crate_root
    add_import_if(
        violations,
        crate_root in PRODUCT_DOMAIN_ROOTS,
        "AH-ADAPTER-1",
        path,
        import_path.crate_root_line,
        import_path,
    )
    add_import_if(
        violations,
        crate_root in LIVE_RUNTIME_ROOTS or is_acp_runtime_import(import_path),
        "AH-ADAPTER-2",
        path,
        import_path.crate_root_line,
        import_path,
    )
    add_import_if(
        violations,
        import_path.starts_with_crate("api") or import_path.root in HTTP_TRANSPORT_ROOTS,
        "AH-ADAPTER-3",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_integrations_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    crate_root = import_path.crate_root
    add_import_if(
        violations,
        crate_root in PRODUCT_DOMAIN_ROOTS,
        "AH-INTEG-1",
        path,
        import_path.crate_root_line,
        import_path,
    )
    add_import_if(
        violations,
        import_path.starts_with_crate("api") or import_path.root in HTTP_TRANSPORT_ROOTS,
        "AH-INTEG-2",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_domain_store_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    """Generalized from the sessions-only rule: every domain store is a leaf."""
    add_import_if(
        violations,
        import_path.starts_with_crate("api"),
        "AH-STORE-1",
        path,
        import_path.crate_root_line,
        import_path,
    )
    add_import_if(
        violations,
        import_path.crate_root in DOMAIN_STORE_FORBIDDEN_ROOTS
        or is_acp_runtime_import(import_path),
        "AH-STORE-2",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_event_sink_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_import_if(
        violations,
        import_path.starts_with_crate("api"),
        "AH-SINK-1",
        path,
        import_path.crate_root_line,
        import_path,
    )
    add_import_if(
        violations,
        import_path.root in HTTP_TRANSPORT_ROOTS,
        "AH-SINK-2",
        path,
        import_path.lines[0] if import_path.lines else 1,
        import_path,
    )


def check_persistence_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    crate_root = import_path.crate_root
    add_import_if(
        violations,
        crate_root in PRODUCT_DOMAIN_ROOTS,
        "AH-PERSIST-1",
        path,
        import_path.crate_root_line,
        import_path,
    )
    add_import_if(
        violations,
        crate_root in LIVE_RUNTIME_ROOTS or is_acp_runtime_import(import_path),
        "AH-PERSIST-2",
        path,
        import_path.crate_root_line,
        import_path,
    )
    add_import_if(
        violations,
        import_path.starts_with_crate("api") or import_path.root in HTTP_TRANSPORT_ROOTS,
        "AH-PERSIST-3",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_live_session_private_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    rel = relative(path)
    add_import_if(
        violations,
        not in_live_sessions(rel) and is_live_session_private_import(import_path),
        "AH-LIVE-1",
        path,
        import_path.crate_root_line,
        import_path,
    )
    add_import_if(
        violations,
        not in_live_sessions(rel) and is_session_command_import(import_path),
        "AH-LIVE-2",
        path,
        import_path.lines[-1] if import_path.lines else import_path.crate_root_line,
        import_path,
    )


def check_app_state_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    rel = relative(path)
    add_import_if(
        violations,
        not in_api_or_app(rel)
        and import_path.starts_with_crate("app")
        and import_path.leaf == "AppState",
        "AH-STATE-1",
        path,
        import_path.lines[-1] if import_path.lines else import_path.crate_root_line,
        import_path,
    )


def check_domain_contract_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    rel = relative(path)
    add_import_if(
        violations,
        is_domain_path(rel) and is_contract_request_response_import(import_path),
        "AH-CONTRACT-2",
        path,
        import_path.lines[-1] if import_path.lines else 1,
        import_path,
    )


def check_domain_live_valve_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_import_if(
        violations,
        import_path.crate_root == "live" and not is_live_model_import(import_path),
        "AH-LIVE-5",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_live_domain_store_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_import_if(
        violations,
        is_domain_store_or_service_import(import_path),
        "AH-STORE-4",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_api_store_escape_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_import_if(
        violations,
        is_domain_store_import(import_path),
        "AH-API-2",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_policy_purity_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_import_if(
        violations,
        has_segment(import_path, STORE_SEGMENTS) or import_path.crate_root == "adapters",
        "AH-POLICY-1",
        path,
        import_path.crate_root_line,
        import_path,
    )


def check_domain_contract_crate_import(
    violations: list[Violation],
    path: Path,
    start_line: int,
    import_paths: list[ImportPath],
) -> None:
    """One violation per use-statement, matching the engine's import granularity.

    The statement's fingerprint is its first contract leaf, so a group import
    keeps one stable site even when later leaves are added or removed.
    """
    contract_paths = [
        import_path for import_path in import_paths if import_path.root == CONTRACT_CRATE_ROOT
    ]
    if not contract_paths:
        return
    anchor = import_anchor(contract_paths[0])
    add_if(
        violations,
        True,
        "AH-CONTRACT-1",
        path,
        start_line,
        anchor,
        f"use {anchor}",
    )


def non_model_live_use_anchor(line: str) -> str:
    """The first inline `crate::live::..` path use that is not a model shape."""
    for match in LIVE_INLINE_PATH_RE.finditer(line):
        if match.group("second") != LIVE_MODEL_SEGMENT:
            return match.group(0)
    return ""


def has_non_model_live_use(line: str) -> bool:
    return bool(non_model_live_use_anchor(line))


def is_non_model_live_reexport(import_path: ImportPath) -> bool:
    """A re-exported live power: `crate::live::<area>::<not-model>`."""
    return import_path.crate_root == "live" and not is_live_model_import(import_path)


def check_domain_valve_live_reexport(
    violations: list[Violation],
    path: Path,
    start_line: int,
    lines: list[str],
    import_paths: list[ImportPath],
) -> None:
    """Valve files may hold live powers; re-exporting them launders the valve away.

    One violation per re-exporting statement, not per leaf: the statement is the
    laundering act, and a group `pub use crate::live::sessions::{A, B}` is one act.

    The `pub use` prefix is matched against the statement's joined text, not just
    its first line: `pub use\\n    crate::live::sessions::Handle;` is the same
    re-export, and testing only line one let that spelling launder silently.
    """
    if not PUB_USE_START_RE.search(" ".join(line.strip() for line in lines)):
        return
    reexports = [
        import_path for import_path in import_paths if is_non_model_live_reexport(import_path)
    ]
    if not reexports:
        return
    anchor = import_anchor(reexports[0])
    add_if(
        violations,
        True,
        "AH-LIVE-6",
        path,
        start_line,
        anchor,
        f"pub use {anchor}",
    )


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
    # live/** can construct or call a domain store inline without importing one,
    # which the import-only rule could not see. Same rule id, same message: it is
    # the same law, just the other half of the surface.
    check_live_store_line = is_under(rel, LIVE_PREFIX)
    check_contract_inline = in_domains
    # Lines the import pass already owns. Computed once per file, for the whole
    # span of each statement rather than just its head line -- see
    # use_statement_linenos.
    import_pass_linenos = use_statement_linenos(path)

    for lineno, raw_line in enumerate(path.read_text().splitlines(), start=1):
        line = strip_line_comment(raw_line)
        is_use_line = line.lstrip().startswith("use ")
        # The rules that share the use-statement pass must not re-count any line
        # of a use statement, head or continuation.
        inside_use_statement = lineno in import_pass_linenos
        if check_live_valve and not inside_use_statement:
            anchor = non_model_live_use_anchor(line)
            add_if(
                violations,
                bool(anchor),
                "AH-LIVE-5",
                path,
                lineno,
                anchor,
                anchor,
            )
        if check_api_store_escape and not inside_use_statement:
            anchor = first_match(
                (STORE_METHOD_CALL_RE, STORE_CONSTRUCTOR_RE, APP_STATE_STORE_FIELD_RE),
                line,
            )
            add_if(violations, bool(anchor), "AH-API-2", path, lineno, anchor, anchor)
        if check_live_store_line and not inside_use_statement:
            anchor = first_match((STORE_METHOD_CALL_RE, STORE_CONSTRUCTOR_RE), line)
            add_if(violations, bool(anchor), "AH-STORE-4", path, lineno, anchor, anchor)
        if check_contract_inline and not inside_use_statement:
            match = CONTRACT_INLINE_PATH_RE.search(line)
            # The anchor carries the named type, not the bare crate prefix, so two
            # different inline contract types in one function stay distinct sites.
            anchor = (
                re.match(
                    r"anyharness_contract(?:::[A-Za-z_][A-Za-z0-9_]*)*", line[match.start() :]
                ).group(0)
                if match
                else ""
            )
            add_if(violations, bool(anchor), "AH-CONTRACT-1", path, lineno, anchor, anchor)
        if check_policy_purity and not inside_use_statement:
            anchor = first_match(POLICY_IMPURITY_RES, line)
            add_if(violations, bool(anchor), "AH-POLICY-1", path, lineno, anchor, anchor)
        if check_domain_sql:
            anchor = first_match(SQL_RES, line)
            add_if(violations, bool(anchor), "AH-STORE-3", path, lineno, anchor, anchor)
        anchor = (
            ""
            if allow_session_private
            else first_match((SESSION_COMMAND_QUALIFIED_PATH_RE,), line)
        )
        add_if(violations, bool(anchor), "AH-LIVE-3", path, lineno, anchor, anchor)
        anchor = "" if allow_command_tx else first_match((COMMAND_TX_ACCESS_RE,), line)
        add_if(violations, bool(anchor), "AH-LIVE-4", path, lineno, anchor, anchor)
        add_if(
            violations,
            not allow_app_state and not is_use_line and "crate::app::AppState" in line,
            "AH-STATE-1",
            path,
            lineno,
            "crate::app::AppState",
            "crate::app::AppState",
        )
        if check_contract_types and not is_use_line:
            match = CONTRACT_REQUEST_RESPONSE_RE.search(line)
            anchor = match.group(1) if match else ""
            add_if(violations, bool(anchor), "AH-CONTRACT-2", path, lineno, anchor, anchor)


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
        if in_live_valve:
            check_domain_valve_live_reexport(violations, path, start_line, lines, import_paths)

    check_line_patterns(violations, path)
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
    return sorted(out, key=lambda item: (item.relative_path, item.lineno, item.rule_id))


def collect_violations(root: Path | None = None) -> list[Violation]:
    with scan_root(root):
        violations: list[Violation] = []
        for path in iter_anyharness_files():
            violations.extend(disambiguate(_check_file(path)))
        return violations


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
                f"delete this entry from lints/anyharness/exceptions.toml"
            )
    return failures, stale


def main() -> int:
    violations = collect_violations()
    failures, stale = apply_exceptions(violations)

    if not failures and not stale:
        print("AnyHarness boundary check passed.")
        return 0

    if failures:
        print("AnyHarness boundary violations without a grandfathered exception:")
        for violation in sorted(
            failures, key=lambda item: (item.relative_path, item.lineno, item.rule_id)
        ):
            print(violation.format())
            print()

    if stale:
        print("Stale AnyHarness exception entries:")
        for entry in stale:
            print(f"  {entry}")

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
