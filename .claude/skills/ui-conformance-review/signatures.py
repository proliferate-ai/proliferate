#!/usr/bin/env python3
"""Runnable signatures for the UI-conformance review checks that need real parsing.

Three subcommands, each mapping to one checklist item in
specs/DESIGN_SYSTEM.md section Component Library → UI-conformance review:

  dupes    check 2 - paint-fingerprint duplicate detection (diff mode and tree mode)
  lucide   check 5 - the lucide-react identifier ratchet (new identifiers only)
  states   check 7 - hand-assembled interaction-state stacks, carve-outs applied

Everything else in the checklist is a plain grep and lives in SKILL.md.
Read-only: no builds, no installs, no network. Cheap enough to run on any machine.

Usage:
  python3 signatures.py dupes  --diff <file.diff> [--root apps/packages/product-client/src]
  python3 signatures.py dupes  --tree [--root ...] [--min-files 2]
  python3 signatures.py lucide --base <sha> --head <sha>
  python3 signatures.py states --diff <file.diff>
"""

from __future__ import annotations

import argparse
import collections
import re
import subprocess
import sys

DEFAULT_ROOT = "apps/packages/product-client/src"

# Library tiers, generated demos and tests are not feature code. The library is
# allowed to own the shapes and the state stacks; that is the whole point of it.
SKIP_PATH = re.compile(r"(/primitives/|/playground/|\.test\.|__tests__|\.md$|\.css$)")


# --------------------------------------------------------------------------- diff


def added_lines(diff_path: str):
    """Yield (path, line_number_in_head, text) for every added line of a unified diff."""
    path = None
    lineno = 0
    with open(diff_path, errors="replace") as handle:
        for raw in handle:
            if raw.startswith("+++ "):
                target = raw[4:].strip()
                path = None if target == "/dev/null" else target[2:] if target.startswith("b/") else target
                continue
            if raw.startswith("@@"):
                match = re.search(r"\+(\d+)", raw)
                lineno = int(match.group(1)) if match else 0
                continue
            if raw.startswith("+") and not raw.startswith("+++"):
                yield path, lineno, raw[1:].rstrip("\n")
                lineno += 1
            elif not raw.startswith("-") and not raw.startswith("\\"):
                lineno += 1


# ------------------------------------------------------- check 2: shape duplicates

# A shape's identity is its paint, not its layout. Two rows that differ only in
# flex/gap/padding are the same shape; two rows that differ in border/bg/radius
# are not. So the fingerprint keeps paint classes and drops everything else.
PAINT = re.compile(
    r"^(rounded(-[a-z0-9]+)?"
    r"|border(-[a-z0-9/\[\]._-]+)?"
    r"|bg-[a-z0-9/\[\]._-]+"
    r"|shadow-[a-z0-9-]+"
    r"|ring-[a-z0-9/._-]+"
    r"|text-(ui|body|heading|caption|mono)[a-z0-9-]*"
    r"|text-(muted-foreground|destructive|warning[a-z-]*|success[a-z-]*|info[a-z-]*|primary)[a-z0-9/._-]*"
    r")$"
)

CLASS_LITERAL = re.compile(r'className=(?:"([^"]{20,})"|\{`([^`]{20,})`\})')

# Neutralizing a primitive's own paint ("render this Button with no chrome") is
# composition, not a shape. A fingerprint made only of these is dropped.
NEUTRALIZERS = {"bg-transparent", "border-0", "border-none", "shadow-none", "ring-0", "rounded-none"}


def fingerprint(class_string: str) -> tuple[str, ...]:
    tokens = {token for token in class_string.split() if PAINT.match(token)}
    if not tokens - NEUTRALIZERS:
        return ()
    return tuple(sorted(tokens))


def build_index(root: str, min_paint: int) -> dict[tuple[str, ...], set[str]]:
    grep = subprocess.run(
        ["grep", "-rn", "--include=*.tsx", "-E", "className", root],
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    index: dict[tuple[str, ...], set[str]] = collections.defaultdict(set)
    for line in grep:
        parts = line.split(":", 2)
        if len(parts) != 3:
            continue
        path, _, text = parts
        if SKIP_PATH.search(path):
            continue
        for match in CLASS_LITERAL.finditer(text):
            fp = fingerprint(match.group(1) or match.group(2))
            if len(fp) >= min_paint:
                index[fp].add(path)
    return index


def cmd_dupes(args) -> int:
    index = build_index(args.root, args.min_paint)

    if args.tree:
        rows = sorted(((len(v), k, v) for k, v in index.items() if len(v) >= args.min_files), reverse=True)
        for count, fp, files in rows:
            print(f"{count} files :: {' '.join(fp)}")
            for path in sorted(files):
                print(f"    {path}")
        print(f"--- {len(rows)} fingerprints in >={args.min_files} files", file=sys.stderr)
        return 0

    found = 0
    reported: set[tuple[str, ...]] = set()
    for path, lineno, text in added_lines(args.diff):
        if not path or SKIP_PATH.search(path):
            continue
        for match in CLASS_LITERAL.finditer(text):
            fp = fingerprint(match.group(1) or match.group(2))
            if len(fp) < args.min_paint or fp in reported:
                continue
            others = index[fp] - {path}
            if others:
                reported.add(fp)
                found += 1
                print(f"CHECK2 {path}:{lineno}")
                print(f"  fingerprint : {' '.join(fp)}")
                print(f"  also at     : {', '.join(sorted(others))}")
    print(f"--- {found} candidate second instances", file=sys.stderr)
    return 0


# ----------------------------------------------------------- check 5: lucide ratchet

LUCIDE_IMPORT = re.compile(
    r"import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['\"]lucide-react['\"]", re.S
)


def lucide_ids(ref: str, path: str) -> set[str]:
    try:
        src = subprocess.run(
            ["git", "show", f"{ref}:{path}"], capture_output=True, text=True, check=True
        ).stdout
    except subprocess.CalledProcessError:
        return set()  # file did not exist at this ref
    names = set()
    for block in LUCIDE_IMPORT.findall(src):
        for part in block.split(","):
            name = part.strip().split(" as ")[0].strip()
            if name:
                names.add(name)
    return names


def cmd_lucide(args) -> int:
    files = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=d", f"{args.base}...{args.head}", "--", "*.ts", "*.tsx"],
        capture_output=True,
        text=True,
    ).stdout.split()
    found = 0
    for path in files:
        if "/primitives/icons/" in path:
            continue  # icons/ is the only legal home for lucide
        new = lucide_ids(args.head, path) - lucide_ids(args.base, path)
        if new:
            found += len(new)
            print(f"CHECK5 {path}: new lucide identifiers {sorted(new)}")
    print(f"--- {found} new lucide identifiers", file=sys.stderr)
    return 0


# ------------------------------------------------------ check 7: state-stack audit

STATE_UTIL = re.compile(r"(?:^|[\s\"'`])((?:group-)?(?:hover|active|focus|focus-visible|focus-within):[a-z0-9:/\[\].%_-]+)")

# The sanctioned state vocabulary:
#   - the three shared interaction fills (bg-hover / bg-selected / bg-active)
#   - neutralizing a primitive's own fill (bg-transparent / bg-inherit)
#   - the colour-promotion idiom from specs/frontend/styling.md: a *bare* semantic
#     foreground token, no /alpha and no palette scale. `hover:text-destructive` is
#     promotion; `hover:bg-destructive/10` is an ad-hoc overlay and stays a finding.
#   - the 0 -> 100 hover-reveal idiom and the focus ring
SANCTIONED = re.compile(
    r"^(?:group-)?(?:hover|active|focus|focus-visible|focus-within):(?:"
    r"bg-hover|bg-selected|bg-active|bg-transparent|bg-inherit"
    r"|text-(?:foreground|muted-foreground|current|sidebar-foreground|sidebar-muted-foreground"
    r"|popover-foreground|destructive|warning|warning-foreground|success|info|primary)"
    r"|text-(?:foreground|current|muted-foreground)/\d+"
    r"|opacity-100|opacity-0|pointer-events-auto|pointer-events-none"
    r"|underline|no-underline|decoration-[a-z-]+"
    r"|ring(-[a-z0-9/._-]+)?|outline(-[a-z0-9/._\[\]-]+)?"
    r"|cursor-[a-z-]+"
    r")$"
)


def cmd_states(args) -> int:
    unsanctioned = 0
    sanctioned_sites = 0
    for path, lineno, text in added_lines(args.diff):
        if not path or SKIP_PATH.search(path) or not path.endswith((".tsx", ".ts")):
            continue
        utils = [m.group(1) for m in STATE_UTIL.finditer(text)]
        if not utils:
            continue
        bad = [u for u in utils if not SANCTIONED.match(u)]
        if bad:
            unsanctioned += 1
            print(f"CHECK7-HARD {path}:{lineno}")
            print(f"  off-vocabulary state utilities : {' '.join(sorted(set(bad)))}")
            print(f"  line : {text.strip()[:150]}")
        else:
            sanctioned_sites += 1
            print(f"CHECK7-SOFT {path}:{lineno}  (shared state tokens: {' '.join(sorted(set(utils)))})")
    print(
        f"--- {unsanctioned} off-vocabulary stacks, {sanctioned_sites} in-vocabulary sites to eyeball",
        file=sys.stderr,
    )
    return 0


# ----------------------------------------------------------------------------- cli


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("dupes", help="check 2 - paint-fingerprint duplicate detection")
    p.add_argument("--diff")
    p.add_argument("--tree", action="store_true")
    p.add_argument("--root", default=DEFAULT_ROOT)
    p.add_argument("--min-files", type=int, default=2)
    p.add_argument("--min-paint", type=int, default=3)
    p.set_defaults(fn=cmd_dupes)

    p = sub.add_parser("lucide", help="check 5 - new lucide-react identifiers vs base")
    p.add_argument("--base", required=True)
    p.add_argument("--head", required=True)
    p.set_defaults(fn=cmd_lucide)

    p = sub.add_parser("states", help="check 7 - hand-assembled interaction-state stacks")
    p.add_argument("--diff", required=True)
    p.set_defaults(fn=cmd_states)

    args = parser.parse_args()
    if args.cmd == "dupes" and not args.tree and not args.diff:
        parser.error("dupes needs either --diff <file> or --tree")
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
