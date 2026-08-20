#!/usr/bin/env python3

"""Keep the em-dash out of user-facing product copy.

PRODUCT_SENSE.md line 11 states the standard: "No em-dashes in ANY product
text. No AI tells." The em dash is the classic AI tell, and in a product whose
copy is largely model-drafted it is the one that slips through most often. The
rule's neighbours in that doc (the type ramp, design attribution, toast copy)
are each mechanically enforced; this one was not, so it had drifted into ten
shipped strings by the time this guard was written.

This engine scans only *string literals* under the product copy trees. An em
dash inside a `//` or `/* */` comment, or in prose describing a rule, is left
alone: a comment is not product text. The rule itself is the record under
`lints/product/copy-style.toml`; diagnostics are rendered from it via
`scripts/lint_records.py`, the same shared loader the sibling checks use.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402

CHECKER = "scripts/check_copy_style.py"
RULES = lint_records.load("product")
OWNED_RULE_IDS = frozenset(
    rule.id for rule in RULES.rules.values() if rule.enforced_by == CHECKER
)

EM_DASH = "—"
RULE_ID = "PROD-COPY-STYLE-001"

SCANNED_ROOTS = ["apps/packages/product-client/src/copy"]
EXTENSIONS = {".ts", ".tsx"}
SKIPPED_DIR_NAMES = {"node_modules", "dist", "build", ".next", "generated", "__fixtures__"}


def string_literal_spans(text: str):
    """Yield (start, end) of every string-literal body, skipping comments.

    A hand-rolled scanner rather than a regex: it has to track escapes and skip
    `//` and `/* */` comments so an em dash in a comment is never seen. Template
    literals are included (they hold copy too); `${...}` insides are copy-bearing
    and left in the span, which is fine — we only look for the em-dash char.
    """
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "/" and i + 1 < n:
            if text[i + 1] == "/":
                j = text.find("\n", i)
                i = n if j < 0 else j
                continue
            if text[i + 1] == "*":
                j = text.find("*/", i + 2)
                i = n if j < 0 else j + 2
                continue
        if c in "\"'`":
            quote = c
            start = i + 1
            k = start
            while k < n:
                if text[k] == "\\":
                    k += 2
                    continue
                if text[k] == quote:
                    break
                if quote != "`" and text[k] == "\n":
                    break
                k += 1
            yield start, min(k, n)
            i = k + 1
            continue
        i += 1


@dataclass(frozen=True)
class Finding:
    path: Path
    lineno: int
    snippet: str

    @property
    def relative_path(self) -> str:
        return str(self.path.relative_to(REPO_ROOT))


def iter_files():
    for root in SCANNED_ROOTS:
        base = REPO_ROOT / root
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix not in EXTENSIONS:
                continue
            if any(part in SKIPPED_DIR_NAMES for part in path.parts):
                continue
            if path.name.endswith(".test.ts") or path.name.endswith(".test.tsx"):
                continue
            yield path


def scan_text(path: Path, text: str) -> list[Finding]:
    findings: list[Finding] = []
    for start, end in string_literal_spans(text):
        body = text[start:end]
        if EM_DASH in body:
            lineno = text.count("\n", 0, start) + 1
            findings.append(Finding(path, lineno, body.strip()[:100]))
    return findings


def main() -> int:
    if RULE_ID not in OWNED_RULE_IDS:
        print(f"{CHECKER}: rule record {RULE_ID} missing from lints/product", file=sys.stderr)
        return 2
    findings: list[Finding] = []
    for path in iter_files():
        findings.extend(scan_text(path, path.read_text(encoding="utf-8")))
    if not findings:
        return 0
    rule = RULES.rules[RULE_ID]
    for f in findings:
        location = f"{f.relative_path}:{f.lineno}"
        print(lint_records.render_diagnostic(rule, location, f.snippet))
    print(f"\n{len(findings)} em-dash violation(s) in product copy.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
