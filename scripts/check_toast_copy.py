#!/usr/bin/env python3

"""Keep exception text out of toast headlines.

The failure this bans was written the same way dozens of times::

    showToast(`Failed to send queued message next: ${errorMessage(error)}`)

which is a human headline concatenated with a raw exception. The result has no
good width: narrow clips it mid-word with no ellipsis, wide clips it later, and
wrapping prints the exception to the user — while the message it was about sits
unsent. No layout fixes concatenation, so the concatenation is what is banned.

The replacement is structured: ``toastError({ headline, consequence, cause,
retry })``, where ``cause`` carries the exception and is reachable only through
Details. This guard makes the old shape unwritable in the two places it can
reappear:

``interpolated-headline``
    A ``headline:`` whose value is a template literal or a concatenation. The
    headline is the one line a person reads; it is a written sentence, always,
    so a literal is the only legal value.

``error-in-toast-message``
    A toast raised with a string that interpolates an error-ish binding. This is
    the pre-migration shape itself. Interpolation into a toast string is *not*
    banned in general — ``show(`Joined ${org.name}.`)`` is a fine status line —
    only interpolation of the thing that is an exception.

Both censuses are empty, so both are absolute bans rather than ratchets: the
sweep that introduced them fixed every existing site.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

SCANNED_ROOTS = [
    "apps/packages/ui/src",
    "apps/packages/product-ui/src",
    "apps/packages/product-surfaces/src",
    "apps/packages/product-client/src",
    "apps/desktop/src",
    # Web raises toasts through the same kit, so a ban that skipped it would be a
    # ban on one host — and the shape would simply reappear on the other.
    "apps/web/src",
]

EXTENSIONS = {".ts", ".tsx"}

SKIPPED_DIR_NAMES = {"node_modules", "dist", "build", ".next", "generated", "__fixtures__"}

# The functions that raise a toast, under every name they are reached by: the
# kit entry points, the product funnel, and the legacy store selector bound as
# `showToast` or `show` at ~190 call sites.
TOAST_CALL = r"(?:showToast|toastError|showProductToast|showProductErrorToast|showError)"

# A binding that holds an exception or its rendered text. Deliberately narrow:
# it is the difference between the banned shape and an ordinary interpolated
# status line, so it names error vocabulary rather than "anything dynamic".
ERROR_BINDING = (
    r"(?:"
    r"err(?:or)?(?:s)?"
    r"|[A-Za-z]*[Ee]rror(?:Message|Text|Detail|Reason)?"
    r"|message|msg|reason|detail|stderr|stack"
    r")"
)

PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    (
        "interpolated-headline",
        # headline: `…${x}…`  /  headline: "a" + b
        re.compile(
            # `[^,]` rather than `[^,\n]` for the concatenation arms: the value
            # may be wrapped across lines, and a comma is what ends a property,
            # so this still cannot wander into the next one.
            r"\bheadline\s*:\s*(?:`[^`]*\$\{|[^,]{0,200}?[\"'`]\s*\+|\w+\s*\+)",
        ),
        "a headline is a written line, not a built string — put the dynamic text in `consequence` or the exception in `cause`",
    ),
    (
        "error-in-toast-message",
        # showToast(`… ${errorMessage(error)}`) and its concatenated form
        re.compile(
            rf"{TOAST_CALL}\s*\(\s*(?:`[^`]*\$\{{\s*{ERROR_BINDING}\b"
            rf"|[\"'][^\"']*[\"']\s*\+\s*{ERROR_BINDING}\b)",
        ),
        "raise it with toastError({ headline, consequence, cause }) so the exception reaches Details, not the headline",
    ),
]


def scan_file(path: Path) -> list[tuple[int, str, str, str]]:
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return []

    # Matched against the whole file, not line by line. Prettier wraps a long
    # call, so the banned shape arrives split across lines as often as not::
    #
    #     showToast(
    #       `Couldn't save: ${errorMessage(error)}`,
    #     )
    #
    # and a per-line scan sees only fragments of it — neither line contains both
    # the call and the interpolation. The patterns' character classes are all
    # negated (`[^`]`, `[^,]`), which match newlines, so they span the wrap
    # without needing DOTALL and still cannot run past the delimiter that ends
    # the value they are reading.
    findings: list[tuple[int, str, str, str]] = []
    for rule, pattern, hint in PATTERNS:
        for match in pattern.finditer(text):
            lineno = text.count("\n", 0, match.start()) + 1
            snippet = " ".join(match.group(0).split())
            findings.append((lineno, rule, snippet, hint))
    return sorted(findings)


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
    violations: list[str] = []
    for path in sorted(iter_source_files()):
        for lineno, rule, snippet, hint in scan_file(path):
            rel = path.relative_to(REPO_ROOT)
            violations.append(f"  {rel}:{lineno} [{rule}] {snippet!r} — {hint}")

    if not violations:
        print("Toast copy check passed.")
        return 0

    print("A toast headline is written, not concatenated:")
    for violation in violations:
        print(violation)
    print(
        "\ntoastError({ headline, consequence, cause, retry }) exists so the human"
        "\noutcome and the raw exception occupy different fields. `headline` is one"
        "\nline a person reads; `consequence` says what did and did not happen;"
        "\n`cause` holds the exception and is reachable only through Details."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
