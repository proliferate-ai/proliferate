#!/usr/bin/env python3

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
import re
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
LIB_SRC = REPO_ROOT / "anyharness" / "crates" / "anyharness-lib" / "src"
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "anyharness_boundaries_allowlist.txt"

HTTP_TRANSPORT_ROOTS = {"axum", "headers", "http", "http_body", "tower", "utoipa"}
PRODUCT_DOMAIN_ROOTS = {"domains", "repo_roots", "sessions", "workspaces"}
LIVE_RUNTIME_ROOTS = {"acp", "live", "terminals"}
TOKEN_RE = re.compile(r"r#[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*|::|[{}(),;*]")
USE_START_RE = re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+")


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


def strip_line_comment(line: str) -> str:
    return line.split("//", 1)[0]


def relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def is_under(relative_path: str, prefix: str) -> bool:
    return relative_path.startswith(prefix)


def should_skip(path: Path) -> bool:
    if path.name.endswith("_tests.rs") or path.name == "tests.rs":
        return True
    return any(part == "tests" for part in path.relative_to(LIB_SRC).parts)


def iter_anyharness_files() -> list[Path]:
    return [
        path
        for path in sorted(LIB_SRC.rglob("*.rs"))
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
        import_path.starts_with_crate("acp") or import_path.starts_with_crate("live"),
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


def check_session_store_import(
    violations: list[Violation],
    path: Path,
    import_path: ImportPath,
) -> None:
    add_if(
        violations,
        import_path.starts_with_crate("api"),
        "SESSION_STORE_API_IMPORT",
        path,
        import_path.crate_root_line,
        "sessions/store/** must not import api/**",
    )
    add_if(
        violations,
        import_path.crate_root in LIVE_RUNTIME_ROOTS,
        "SESSION_STORE_LIVE_IMPORT",
        path,
        import_path.crate_root_line,
        "sessions/store/** must not import live runtime modules",
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
        "acp/event_sink/** must not import api/**",
    )
    add_if(
        violations,
        import_path.root in HTTP_TRANSPORT_ROOTS,
        "EVENT_SINK_HTTP_TRANSPORT_IMPORT",
        path,
        import_path.lines[0] if import_path.lines else 1,
        "acp/event_sink/** must not import HTTP transport crates",
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


def check_file(path: Path) -> list[Violation]:
    rel = relative(path)
    violations: list[Violation] = []
    in_api = is_under(rel, "anyharness/crates/anyharness-lib/src/api/")
    in_domains = is_under(rel, "anyharness/crates/anyharness-lib/src/domains/")
    in_adapters = is_under(rel, "anyharness/crates/anyharness-lib/src/adapters/")
    in_integrations = is_under(rel, "anyharness/crates/anyharness-lib/src/integrations/")
    in_session_store = is_under(rel, "anyharness/crates/anyharness-lib/src/sessions/store/")
    in_event_sink = is_under(rel, "anyharness/crates/anyharness-lib/src/acp/event_sink/")
    in_persistence = is_under(rel, "anyharness/crates/anyharness-lib/src/persistence/")

    for start_line, lines in iter_use_statements(path):
        for import_path in parse_use_paths(start_line, lines):
            if not import_path.parts:
                continue
            if in_api:
                check_api_import(violations, path, import_path)
            if in_domains:
                check_domains_import(violations, path, import_path)
            if in_adapters:
                check_adapters_import(violations, path, import_path)
            if in_integrations:
                check_integrations_import(violations, path, import_path)
            if in_session_store:
                check_session_store_import(violations, path, import_path)
            if in_event_sink:
                check_event_sink_import(violations, path, import_path)
            if in_persistence:
                check_persistence_import(violations, path, import_path)

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
        if len(parts) != 4:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{lineno}: "
                "expected RULE_ID path count reason"
            )
        rule_id, relative_path, count_raw, reason = parts
        try:
            count = int(count_raw)
        except ValueError as error:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{lineno}: count must be an integer"
            ) from error
        if count < 1:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{lineno}: count must be positive"
            )
        key = (rule_id, relative_path)
        if key in entries:
            raise ValueError(
                f"{ALLOWLIST_PATH.relative_to(REPO_ROOT)}:{lineno}: duplicate allowlist entry"
            )
        entries[key] = AllowlistEntry(rule_id, relative_path, count, reason)
    return entries


def collect_violations() -> list[Violation]:
    violations: list[Violation] = []
    for path in iter_anyharness_files():
        violations.extend(check_file(path))
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
