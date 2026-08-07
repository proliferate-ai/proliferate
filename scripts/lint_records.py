"""Shared loader and diagnostic renderer for lints/ rule records.

The TOML record is canonical (see lints/README.md). Checkers load their rules
and exception ledgers through this module and emit failures through
``render_diagnostic`` so every CI message carries the rule, the legal
alternative, and the record path — never a bare "banned".
"""

from __future__ import annotations

import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LINTS_ROOT = REPO_ROOT / "lints"

OWNERS = ("anyharness", "server", "frontend", "product")
STATUSES = ("law", "holds", "leaks")
MODES = ("compiler", "lint", "test", "review")


@dataclass(frozen=True)
class Rule:
    id: str
    title: str
    owner: str
    status: str
    enforced_by: str
    mode: str
    rule: str
    alternative: str
    why: str
    scope: str = ""
    gap: str = ""
    example_bad: str = ""
    example_good: str = ""
    source: str = ""  # lints/<owner>/<file>.toml, for diagnostics


@dataclass(frozen=True)
class Exception_:
    rule: str
    path: str
    site: str
    reason: str


@dataclass
class RuleSet:
    rules: dict[str, Rule] = field(default_factory=dict)
    exceptions: list[Exception_] = field(default_factory=list)

    def rule(self, rule_id: str) -> Rule:
        try:
            return self.rules[rule_id]
        except KeyError:
            raise SystemExit(
                f"lint_records: unknown rule id {rule_id!r}; every checker rule "
                f"must have a record under lints/ (see lints/README.md)"
            ) from None

    def exception_sites(self, rule_id: str) -> set[tuple[str, str]]:
        return {
            (entry.path, entry.site)
            for entry in self.exceptions
            if entry.rule == rule_id
        }


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def _fail(path: Path, message: str) -> None:
    raise SystemExit(f"lint_records: {_display_path(path)}: {message}")


def _load_rules_file(path: Path) -> list[Rule]:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    rules: list[Rule] = []
    for raw in data.get("rule", []):
        missing = [
            key
            for key in ("id", "title", "owner", "status", "enforced_by", "mode", "rule", "alternative", "why")
            if key not in raw
        ]
        if missing:
            _fail(path, f"rule {raw.get('id', '<no id>')} missing fields: {', '.join(missing)}")
        if raw["owner"] not in OWNERS:
            _fail(path, f"rule {raw['id']}: owner {raw['owner']!r} not in {OWNERS}")
        if raw["status"] not in STATUSES:
            _fail(path, f"rule {raw['id']}: status {raw['status']!r} not in {STATUSES}")
        if raw["mode"] not in MODES:
            _fail(path, f"rule {raw['id']}: mode {raw['mode']!r} not in {MODES}")
        example = raw.get("example", {})
        rules.append(
            Rule(
                id=raw["id"],
                title=raw["title"],
                owner=raw["owner"],
                status=raw["status"],
                enforced_by=raw["enforced_by"],
                mode=raw["mode"],
                rule=raw["rule"].strip(),
                alternative=raw["alternative"].strip(),
                why=raw["why"].strip(),
                scope=raw.get("scope", ""),
                gap=raw.get("gap", ""),
                example_bad=example.get("bad", ""),
                example_good=example.get("good", ""),
                source=_display_path(path),
            )
        )
    return rules


def _load_exceptions_file(path: Path) -> list[Exception_]:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    entries: list[Exception_] = []
    for raw in data.get("exception", []):
        missing = [key for key in ("rule", "path", "site", "reason") if key not in raw]
        if missing:
            _fail(path, f"exception entry missing fields: {', '.join(missing)} ({raw})")
        entries.append(
            Exception_(
                rule=raw["rule"],
                path=raw["path"],
                site=raw["site"],
                reason=raw["reason"],
            )
        )
    return entries


def load(owner: str | None = None) -> RuleSet:
    """Load rule records and exception ledgers (all owners, or one)."""
    owners = (owner,) if owner else OWNERS
    ruleset = RuleSet()
    for name in owners:
        owner_dir = LINTS_ROOT / name
        if not owner_dir.is_dir():
            continue
        for path in sorted(owner_dir.glob("*.toml")):
            if path.name == "exceptions.toml":
                ruleset.exceptions.extend(_load_exceptions_file(path))
            elif path.name == "ratchets.toml":
                continue  # ratchets are loaded by their owning checker
            else:
                for rule in _load_rules_file(path):
                    if rule.id in ruleset.rules:
                        _fail(path, f"duplicate rule id {rule.id}")
                    ruleset.rules[rule.id] = rule
    dangling = {
        entry.rule for entry in ruleset.exceptions
    } - set(ruleset.rules) if owner is None else set()
    if dangling:
        raise SystemExit(
            f"lint_records: exception ledger cites unknown rule ids: {sorted(dangling)}"
        )
    return ruleset


def load_ratchets(owner: str) -> dict:
    """Load an owner's ratchets.toml (raw dict; shape is checker-owned)."""
    path = LINTS_ROOT / owner / "ratchets.toml"
    if not path.exists():
        return {}
    return tomllib.loads(path.read_text(encoding="utf-8"))


def render_diagnostic(rule: Rule, location: str, detail: str = "") -> str:
    """Render one violation as a remediation prompt, not a bare error."""
    lines = [f"{location}: {rule.id} — {rule.title}"]
    if detail:
        lines.append(f"  found: {detail}")
    lines.append(f"  rule: {rule.rule}")
    lines.append(f"  instead: {rule.alternative}")
    if rule.example_good:
        lines.append(f"  good: {rule.example_good}")
    lines.append(
        f"  record: {rule.source} — grandfathered sites live in the owner's "
        f"exceptions.toml; net-new exceptions require founder approval"
    )
    return "\n".join(lines)


def main() -> int:
    """Validate every record and ledger; print a one-line summary."""
    ruleset = load()
    by_owner: dict[str, int] = {}
    for rule in ruleset.rules.values():
        by_owner[rule.owner] = by_owner.get(rule.owner, 0) + 1
    summary = ", ".join(f"{owner}: {count}" for owner, count in sorted(by_owner.items()))
    print(
        f"lint records OK — {len(ruleset.rules)} rules ({summary}), "
        f"{len(ruleset.exceptions)} exception sites"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
