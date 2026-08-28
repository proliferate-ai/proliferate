#!/usr/bin/env python3

"""Keep other products' names out of how we describe our own design.

Several of these names are also legitimate product vocabulary: `codex` is a
supported agent harness, so `"codex"` as a harness kind, `codex-mini` as a
model id, and `codex-acp` as a sidecar are all real wire contracts. `cursor`
is a CSS property and an editor we open files in. This guard therefore does
not ban the words — it bans *attributing our own visual design to another
product*, which is the form that leaks a competitor's name into shipped
comments, class names, and from there into PR text.

Rejected: "codex recipe", "Codex-style dot", "Conductor-style group anatomy",
`reference/codex/status/card.html`, a `codex-thread-find-match` class name.
Accepted: `harnessKind === "codex"`, `"codex-mini"`, `codex.openai-oauth`.

Describe the treatment instead of its source: "90%-alpha popover fill, 8px
blur" says more than "codex dropdown recipe" and stays true when the
reference changes.

The rules themselves are records under `lints/product/attribution.toml`; this
file is only the engine. Diagnostics are rendered from the record (rule sentence,
legal alternative, record path) via `scripts/lint_records.py`.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    # Run as `python3 scripts/check_design_attribution.py` from the repo root,
    # sys.path[0] is scripts/ — the shared loader lives one level up.
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CHECKER = "scripts/check_design_attribution.py"
RULES = lint_records.load("product")
OWNED_RULE_IDS = frozenset(rule.id for rule in RULES.rules.values() if rule.enforced_by == CHECKER)

SCANNED_ROOTS = [
    "apps/packages",
    "apps/web/src",
    "apps/desktop/src",
]

EXTENSIONS = {".ts", ".tsx", ".css", ".js", ".jsx"}

SKIPPED_DIR_NAMES = {"node_modules", "dist", "build", ".next", "generated", "__fixtures__"}

# Other products whose UI we look at. Not banned as words — banned as the
# stated source of our own design (see PATTERNS).
PRODUCTS = ["codex", "conductor", "cursor", "capy"]

_PRODUCT = "(?:" + "|".join(PRODUCTS) + ")"

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "PROD-ATTR-1",
        # "codex-style", "Codex style dot", "conductor-like". The separator is
        # required: `cursorStyle` is an xterm option, not an attribution.
        re.compile(rf"\b{_PRODUCT}(?:'s)?[-\s](?:style|styled|like|esque)\b", re.IGNORECASE),
    ),
    (
        "PROD-ATTR-2",
        # "codex recipe", "codex's tooltip recipe", "codex popover recipe",
        # "codex anatomy", "codex convention", "codex parity", "codex hierarchy"
        re.compile(
            rf"\b{_PRODUCT}(?:'s)?[-\s](?:\w+[-\s])?"
            r"(?:recipe|anatomy|convention|parity|hierarchy|format|ordered|dump)",
            re.IGNORECASE,
        ),
    ),
    (
        "PROD-ATTR-3",
        # reference/codex/status/card.html
        re.compile(rf"reference/{_PRODUCT}\b", re.IGNORECASE),
    ),
    (
        "PROD-ATTR-4",
        # A bare product name modifying one of our design nouns: "codex avatar
        # -group clusters", "conductor divider". Kept to design vocabulary so
        # real product phrases ("the codex harness", "codex session") pass.
        # `row` is deliberately absent: it is ordinary data vocabulary ("a
        # cursor api_key row" is an auth row for a harness kind), and the
        # hyphenated identifier form `cursor-row` is caught below anyway.
        re.compile(
            rf"\b{_PRODUCT}(?:'s)?\s+(?:\w+[-\s])?"
            r"(?:avatar|chip|pill|dot|glyph|sprite|icon|badge|tooltip|popover|"
            r"dropdown|modal|card|panel|header|footer|divider|rail|gutter|"
            r"placeholder|shell|spacing|leading|tint|hue|palette|ink)s?\b",
            re.IGNORECASE,
        ),
    ),
    (
        "PROD-ATTR-5",
        # a shipped class/identifier named after another product, e.g.
        # codex-thread-find-match. Allows real product vocabulary by requiring
        # the suffix to be design language rather than a harness/model token.
        re.compile(
            rf"\b{_PRODUCT}-(?:thread|row|card|panel|item|dot|chip|surface|frame|"
            r"review|diff|glyph|sprite)\b",
            re.IGNORECASE,
        ),
    ),
]


@dataclass(frozen=True)
class Finding:
    """One attribution violation, reported through its record."""

    rule_id: str
    path: Path
    lineno: int
    snippet: str

    @property
    def relative_path(self) -> str:
        try:
            return str(self.path.relative_to(REPO_ROOT))
        except ValueError:
            return str(self.path)

    def format(self) -> str:
        """The record-generated diagnostic: rule, alternative, record path."""
        return lint_records.render_diagnostic(
            RULES.rule(self.rule_id),
            f"{self.relative_path}:{self.lineno}",
            repr(self.snippet),
        )


def scan_file(path: Path) -> list[Finding]:
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return []

    findings: list[Finding] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        for rule_id, pattern in PATTERNS:
            match = pattern.search(line)
            if match:
                findings.append(Finding(rule_id, path, lineno, match.group(0).strip()))
    return findings


def iter_source_files() -> list[Path]:
    files: list[Path] = []
    for root in SCANNED_ROOTS:
        base = REPO_ROOT / root
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix not in EXTENSIONS or not path.is_file():
                continue
            if any(part in SKIPPED_DIR_NAMES for part in path.parts):
                continue
            files.append(path)
    return files


def main() -> int:
    violations: list[Finding] = []
    for path in sorted(iter_source_files()):
        violations.extend(scan_file(path))

    if not violations:
        print("Design attribution check passed.")
        return 0

    print("Our design must be described in our own vocabulary:")
    for violation in violations:
        print(violation.format())
        print()
    print(
        "\nThese names are fine as product vocabulary (a harness kind, a model id,"
        "\na CSS cursor). What is rejected is crediting another product for how our"
        "\nUI looks. Say what the treatment IS — sizes, colors, roles — which stays"
        "\ntrue when the reference changes and keeps the name out of shipped code."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
