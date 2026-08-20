#!/usr/bin/env python3

"""Keep the em-dash out of user-facing product copy.

PRODUCT_SENSE.md line 11 states the standard: "No em-dashes in ANY product
text. No AI tells." The em dash is the classic AI tell, and in a product whose
copy is largely model-drafted it is the one that slips through most often. The
rule's neighbours in that doc (the type ramp, design attribution, toast copy)
are each mechanically enforced; this one was not, so it had drifted into ten
shipped strings by the time this guard was written.

This engine flags an em dash that lands in a *string or template literal* under
the product copy trees, and ignores one inside a `//` or `/* */` comment: a
comment is not product text. It is a small state machine rather than a regex so
it stays correct through the cases a regex gets wrong — a `//` sequence inside a
string is not a comment, and a nested template literal inside a `${...}`
interpolation does not end the outer template early. The rule itself is the
record under `lints/product/copy-style.toml`; diagnostics are rendered from it
via `scripts/lint_records.py`, the shared loader the sibling checks use.
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

# Lexer states. A stack models nesting: a template literal can hold a `${...}`
# expression (EXPR), and that expression can open another string or template.
CODE, EXPR, SQ, DQ, TMPL, LINE_COMMENT, BLOCK_COMMENT = range(7)
COPY_STATES = frozenset({SQ, DQ, TMPL})  # em dash here is product text


def em_dash_lines(text: str) -> list[int]:
    """Return the 1-based line of every em dash that lands in a string literal.

    Em dashes inside comments are ignored. The scanner tracks `${...}` depth so
    a nested template does not end its parent early.
    """
    stack = [CODE]
    brace_depth = [0]  # parallel to EXPR frames; index by position in stack
    hits: list[int] = []
    line = 1
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        top = stack[-1]

        if top in (CODE, EXPR):
            if c == "/" and nxt == "/":
                stack.append(LINE_COMMENT)
                i += 2
                continue
            if c == "/" and nxt == "*":
                stack.append(BLOCK_COMMENT)
                i += 2
                continue
            if c == "'":
                stack.append(SQ)
            elif c == '"':
                stack.append(DQ)
            elif c == "`":
                stack.append(TMPL)
            elif top == EXPR and c == "{":
                brace_depth[-1] += 1
            elif top == EXPR and c == "}":
                if brace_depth[-1] == 0:
                    stack.pop()
                    brace_depth.pop()
                else:
                    brace_depth[-1] -= 1
            elif c == "\n":
                line += 1
        elif top == LINE_COMMENT:
            if c == "\n":
                stack.pop()
                line += 1
        elif top == BLOCK_COMMENT:
            if c == "*" and nxt == "/":
                stack.pop()
                i += 2
                continue
            if c == "\n":
                line += 1
        elif top in (SQ, DQ):
            if c == "\\":
                i += 2
                continue
            if (top == SQ and c == "'") or (top == DQ and c == '"'):
                stack.pop()
            elif c == "\n":
                stack.pop()  # unterminated single-line string; recover
                line += 1
            elif c == EM_DASH:
                hits.append(line)
        elif top == TMPL:
            if c == "\\":
                i += 2
                continue
            if c == "`":
                stack.pop()
            elif c == "$" and nxt == "{":
                stack.append(EXPR)
                brace_depth.append(0)
                i += 2
                continue
            elif c == "\n":
                line += 1
            elif c == EM_DASH:
                hits.append(line)
        i += 1
    return hits


@dataclass(frozen=True)
class Finding:
    path: Path
    lineno: int

    @property
    def relative_path(self) -> str:
        return str(self.path.relative_to(REPO_ROOT))


def scan_text(path: Path, text: str) -> list[Finding]:
    return [Finding(path, ln) for ln in em_dash_lines(text)]


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
            if path.name.endswith((".test.ts", ".test.tsx")):
                continue
            yield path


def main() -> int:
    if RULE_ID not in OWNED_RULE_IDS:
        print(f"{CHECKER}: rule record {RULE_ID} missing from lints/product", file=sys.stderr)
        return 2
    rule = RULES.rules[RULE_ID]
    findings: list[Finding] = []
    for path in iter_files():
        findings.extend(scan_text(path, path.read_text(encoding="utf-8")))
    if not findings:
        return 0
    for f in findings:
        print(lint_records.render_diagnostic(rule, f"{f.relative_path}:{f.lineno}"))
    print(f"\n{len(findings)} em-dash violation(s) in product copy.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
