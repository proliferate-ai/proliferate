#!/usr/bin/env python3
"""Mechanical half of the component-library doctrine in specs/DESIGN_SYSTEM.md.

The design-system document states seven UI-conformance review checks and a
sanctioned index. Most of them are judgment, but four are decidable from the
tree plus the index, and this guard owns those four:

``hand-rolled-overlay-role``
    Review check 3. A ``role="dialog|menu|listbox|tooltip|button"`` written on a
    raw element is a re-implementation of an overlay or control the library
    already owns (``ModalShell``/``PopoverButton``/``Tooltip``/``DropdownMenu``/
    ``Button``). The survivors that predate the rule are named one by one in the
    allowlist with the reason each is still standing.

``dead-library-component``
    The at-least-one-call-site rule. Every row of the sanctioned index must have
    a consumer that is not itself and not a playground surface, or the row is
    dead vocabulary — the exact failure the rule exists to catch ("a sanctioned
    component with zero consumers while feature code hand-rolls its shape").
    An ``incubating:`` note in the row buys one release; by definition it names
    an in-flight PR, so a note that outlives its release is reported too.

``missing-library-jsdoc`` / ``registry-row-without-file``
    The index is the closed set, so each row must link a file that exists and
    name an export that exists, and each sanctioned component must carry a
    non-empty JSDoc block. Glyph modules are excluded: their index row documents
    the set, and per-glyph prose would be noise.

``kit-imports-feature-code`` / ``kit-directory-without-registry-rows``
    Doctrine D3, placement. A kit directory under ``primitives/patterns/`` is
    library code: it may not reach up into ``components/**``, and it may not
    exist without at least one index row that places its members in it.

Ratchet semantics
-----------------
Every allowlist entry carries a count AND a justification string, and the guard
fails in both directions: more hits than the entry allows is a new violation,
and fewer is a stale allowance that would silently absorb the next one. That
makes the allowlist shrink-only in the same sense as the appearance census —
a migration must delete the entry in the commit that fixes the site.
"""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCT_CLIENT_SRC = REPO_ROOT / "apps" / "packages" / "product-client" / "src"
DESKTOP_SRC = REPO_ROOT / "apps" / "desktop" / "src"
WEB_SRC = REPO_ROOT / "apps" / "web" / "src"
DESIGN_SYSTEM_DOC = REPO_ROOT / "specs" / "DESIGN_SYSTEM.md"
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "component_library_allowlist.json"

MOBILE_SRC = REPO_ROOT / "apps" / "mobile" / "src"

# Every frontend surface that can consume the library. Mobile is in the set for
# the call-site rule specifically: it imports `@proliferate/product-client`, so
# leaving it out would report a component whose only consumer is mobile as dead
# and pressure a live shape into retirement.
SCANNED_ROOTS = (PRODUCT_CLIENT_SRC, DESKTOP_SRC, WEB_SRC, MOBILE_SRC)
EXTENSIONS = {".ts", ".tsx"}

PRIMITIVES_DIR = PRODUCT_CLIENT_SRC / "primitives"
PATTERNS_DIR = PRIMITIVES_DIR / "patterns"
ICONS_DIR = PRIMITIVES_DIR / "icons"
PRODUCT_PATTERNS_DIR = PRODUCT_CLIENT_SRC / "components" / "patterns"
PLAYGROUND_DIR = PRODUCT_CLIENT_SRC / "components" / "playground"

# Non-component modules that live inside a tier directory on purpose. The design
# document names the first explicitly ("it is not a component: no index row
# below, no export subpath"); the rest are support layers the taxonomy already
# excludes from the index.
NON_COMPONENT_TIER_FILES = {
    "apps/packages/product-client/src/primitives/popover-surface.ts",
}
NON_COMPONENT_TIER_DIRECTORIES = ("utils/", "overlays/", "__tests__/")

# The index tiers, keyed by the `#### <heading> (`<dir>`)` subsections under
# "### The sanctioned index".
TIER_ROOTS = {
    "product-client/src/primitives/": PRIMITIVES_DIR,
    "product-client/src/primitives/patterns/": PATTERNS_DIR,
    "product-client/src/primitives/icons/": ICONS_DIR,
    "product-client/src/components/patterns/": PRODUCT_PATTERNS_DIR,
}
# Glyph modules document their whole set in the index row; a JSDoc per glyph
# would be prose noise, not documentation.
JSDOC_EXEMPT_TIERS = {"product-client/src/primitives/icons/"}

OVERLAY_ROLES = ("dialog", "menu", "listbox", "tooltip", "button")
# Matches the literal attribute and the conditional spelling that carries the
# same DOM contract: `role="button"` and `role={onSelect ? "button" : undefined}`
# are the same hand-rolled semantics, and a ratchet that only sees the literal
# form is a ratchet with a one-character bypass. Both quote styles count for the
# same reason — JSX accepts `role='dialog'`, so a double-quote-only pattern is
# that same one-character bypass in a different position.
#
# The leading `(?<!\[)` excludes the CSS attribute selector `[role='button']`,
# which reads a role rather than writing one: the focus-zone query strings that
# enumerate interactive elements are consumers of the convention, not
# re-implementations of an overlay.
OVERLAY_ROLE_RE = re.compile(
    r"(?<!\[)\brole\s*=\s*(?:\{[^}\n]*?)?(?P<quote>[\"'])(?P<role>"
    + "|".join(OVERLAY_ROLES)
    + r")(?P=quote)"
)

# Import statements wrap freely across lines in this tree, so the specifier is
# matched directly rather than by walking a statement: every `from "…"` tail (of
# an `import` or a re-`export`), plus the dynamic and CommonJS spellings. Over-
# matching a string that merely reads `from "x"` is harmless here — the resolver
# discards anything that is not a real file in the tree.
IMPORT_SPECIFIER_RE = re.compile(
    r"""\bfrom\s*["'](?P<spec>[^"']+)["']"""
    r"""|\bimport\s*\(\s*["'](?P<dyn>[^"']+)["']\s*\)"""
    r"""|\brequire\s*\(\s*["'](?P<req>[^"']+)["']\s*\)""",
)

REGISTRY_ROW_RE = re.compile(
    r"^\|\s*`(?P<name>[^`]+)`\s*\|\s*\[(?P<label>[^\]]+)\]\((?P<link>[^)]+)\)\s*\|"
    r"\s*(?P<purpose>.*?)\s*\|\s*$"
)
INCUBATING_RE = re.compile(r"\bincubating:", re.IGNORECASE)

# Each mechanical check is a `[[rule]]` record in lints/product/component-library.toml
# (PROD-COMPLIB-*); the slug stays the checker's internal key and the allowlist's,
# the record id is what a diagnostic cites.
RECORD_IDS = {
    "hand-rolled-overlay-role": "PROD-COMPLIB-1",
    "dead-library-component": "PROD-COMPLIB-2",
    "missing-library-jsdoc": "PROD-COMPLIB-3",
    "registry-row-without-file": "PROD-COMPLIB-4",
    "expired-incubating-note": "PROD-COMPLIB-5",
    "tier-file-without-registry-row": "PROD-COMPLIB-6",
    "kit-imports-feature-code": "PROD-COMPLIB-7",
    "kit-directory-without-registry-rows": "PROD-COMPLIB-8",
}
RECORD_PATH = "lints/product/component-library.toml"

ALLOWLIST_RULES = {
    "hand-rolled-overlay-role": "handRolledOverlayRoles",
    "dead-library-component": "deadLibraryComponents",
    "missing-library-jsdoc": "undocumentedLibraryComponents",
}


@dataclass(frozen=True)
class Violation:
    rule_id: str
    relative_path: str
    lineno: int
    message: str

    def format(self) -> str:
        record = RECORD_IDS.get(self.rule_id, "PROD-COMPLIB-?")
        return (
            f"{self.relative_path}:{self.lineno}: [{record} {self.rule_id}] {self.message} "
            f"({RECORD_PATH})"
        )


@dataclass(frozen=True)
class RegistryRow:
    tier: str
    name: str
    link: str
    purpose: str
    lineno: int

    @property
    def target(self) -> Path:
        return (DESIGN_SYSTEM_DOC.parent / self.link).resolve()


def relative(path: Path) -> str:
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def is_test_path(path: Path) -> bool:
    name = path.name
    return (
        ".test." in name
        or ".spec." in name
        or "__tests__" in path.parts
        or name.endswith(".stories.tsx")
    )


def iter_source_files(roots: Iterable[Path] = SCANNED_ROOTS) -> list[Path]:
    files: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        files.extend(
            path
            for path in sorted(root.rglob("*"))
            if path.is_file() and path.suffix in EXTENSIONS and not path.name.endswith(".d.ts")
        )
    return files


def mask_comments(source: str) -> str:
    def mask(match: re.Match[str]) -> str:
        return "".join("\n" if char == "\n" else " " for char in match.group(0))

    without_blocks = re.sub(r"/\*[\s\S]*?\*/", mask, source)
    return re.sub(r"//[^\n]*", mask, without_blocks)


def line_number(source: str, offset: int) -> int:
    return source.count("\n", 0, offset) + 1


# --------------------------------------------------------------------------
# Gate: hand-rolled overlay/control roles (review check 3)
# --------------------------------------------------------------------------


def find_hand_rolled_role_violations(sources: dict[Path, str]) -> list[Violation]:
    violations: list[Violation] = []
    for path, source in sources.items():
        if is_test_path(path):
            continue
        for match in OVERLAY_ROLE_RE.finditer(mask_comments(source)):
            role = match.group("role")
            violations.append(
                Violation(
                    "hand-rolled-overlay-role",
                    relative(path),
                    line_number(source, match.start()),
                    f'role="{role}" is hand-rolled overlay/control semantics; compose '
                    f"the library component that owns this shape "
                    f"(ModalShell / PopoverButton / DropdownMenu / Tooltip / Button)",
                )
            )
    return violations


# --------------------------------------------------------------------------
# Registry parsing
# --------------------------------------------------------------------------


def parse_registry(doc: Path = DESIGN_SYSTEM_DOC) -> list[RegistryRow]:
    """Rows of the sanctioned index, tagged with the tier heading above them."""
    rows: list[RegistryRow] = []
    in_index = False
    tier: str | None = None
    for lineno, line in enumerate(doc.read_text().splitlines(), start=1):
        if line.startswith("### "):
            in_index = line.strip() == "### The sanctioned index"
            tier = None
            continue
        if not in_index:
            continue
        if line.startswith("#### "):
            match = re.search(r"\(`([^`]+)`\)", line)
            tier = match.group(1) if match else None
            continue
        if tier is None:
            continue
        match = REGISTRY_ROW_RE.match(line)
        if not match:
            continue
        rows.append(
            RegistryRow(
                tier=tier,
                name=match.group("name"),
                link=match.group("link"),
                purpose=match.group("purpose"),
                lineno=lineno,
            )
        )
    return rows


def doc_relative_lineno(row: RegistryRow) -> tuple[str, int]:
    return relative(DESIGN_SYSTEM_DOC), row.lineno


# --------------------------------------------------------------------------
# Import graph
# --------------------------------------------------------------------------


def resolve_specifier(importer: Path, spec: str) -> Path | None:
    if spec.startswith("#product/"):
        base = PRODUCT_CLIENT_SRC / spec[len("#product/") :]
    elif spec.startswith("@proliferate/product-client/"):
        base = PRODUCT_CLIENT_SRC / spec[len("@proliferate/product-client/") :]
    elif spec.startswith("."):
        base = Path(posixpath.normpath(str(importer.parent / spec)))
    else:
        return None
    for candidate in (
        base,
        base.with_suffix(".tsx"),
        base.with_suffix(".ts"),
        base / "index.tsx",
        base / "index.ts",
    ):
        if candidate.is_file():
            return candidate.resolve()
    return None


def build_importers(sources: dict[Path, str]) -> dict[Path, set[Path]]:
    """target file -> the files that import it.

    Comments are masked first. A commented-out import is not a call site, and
    this tree records refusals to adopt a component in prose right where the
    adoption would have gone — so a graph built over raw text would read
    ``// import { Widget } from "…/Widget"`` as a consumer and keep dead
    vocabulary alive on the strength of one comment line.
    """
    importers: dict[Path, set[Path]] = defaultdict(set)
    for path, source in sources.items():
        for match in IMPORT_SPECIFIER_RE.finditer(mask_comments(source)):
            spec = match.group("spec") or match.group("dyn") or match.group("req")
            if not spec:
                continue
            target = resolve_specifier(path, spec)
            if target is not None:
                importers[target].add(path)
    return importers


# --------------------------------------------------------------------------
# Gate: dead library vocabulary + registry integrity + JSDoc
# --------------------------------------------------------------------------


def is_playground(path: Path) -> bool:
    return PLAYGROUND_DIR in path.parents


def is_documentation_block(text: str) -> bool:
    """``text`` opens with a ``/** … */`` block that actually says something.

    Both halves matter. ``/* … */`` is an aside, not documentation, and
    ``/** */`` is a block with no contract in it — either one satisfies a
    "there is a comment here" test while leaving the index row as the only
    place the component's contract is written down.
    """
    match = re.match(r"/\*\*(?P<body>[\s\S]*?)\*/", text)
    if match is None:
        return False
    body = re.sub(r"^\s*\*+", "", match.group("body"), flags=re.MULTILINE)
    return bool(body.strip())


def jsdoc_precedes_export(source: str, name: str) -> bool:
    """A ``/** ... */`` block directly above the declaration of ``name``.

    A file-header block counts when it is the file's own documentation and the
    export is the module's single subject, which is why the search allows blank
    lines and import statements between the block and the declaration only when
    the block is the first thing in the file.
    """
    declaration = re.search(
        r"^export\s+(?:default\s+)?(?:const|function|class|type|interface)\s+"
        + re.escape(name)
        + r"\b",
        source,
        re.MULTILINE,
    )
    if declaration is None:
        # `export { X }` re-export forms and `const X = ...; export { X }`.
        declaration = re.search(
            r"^(?:const|function|class)\s+" + re.escape(name) + r"\b",
            source,
            re.MULTILINE,
        )
    if declaration is None:
        return False
    preamble = source[: declaration.start()]
    lines = preamble.splitlines()
    index = len(lines) - 1
    while index >= 0 and not lines[index].strip():
        index -= 1
    if index >= 0 and lines[index].strip().endswith("*/"):
        # A block ends here, but only a `/**` block is documentation: a plain
        # `/* … */` above a declaration is an aside, and accepting it would let
        # a gate whose whole subject is documentation pass on a non-doc comment.
        opener = preamble.rfind("/*", 0, preamble.rfind("*/"))
        if opener != -1 and is_documentation_block(preamble[opener:]):
            return True
    # File-header block: the module's documentation, before any import.
    return is_documentation_block(source.lstrip())


def registry_violations(
    rows: list[RegistryRow],
    sources: dict[Path, str],
    importers: dict[Path, set[Path]],
) -> list[Violation]:
    violations: list[Violation] = []
    doc_path = relative(DESIGN_SYSTEM_DOC)

    for row in rows:
        target = row.target
        if not target.is_file():
            violations.append(
                Violation(
                    "registry-row-without-file",
                    doc_path,
                    row.lineno,
                    f"index row `{row.name}` links {row.link}, which does not exist",
                )
            )
            continue

        if INCUBATING_RE.search(row.purpose):
            violations.append(
                Violation(
                    "expired-incubating-note",
                    relative(target),
                    1,
                    f"index row `{row.name}` ({doc_path}:{row.lineno}) still carries an "
                    f"incubating note; the note "
                    f"expires after one release — strike it once the named slice landed, "
                    f"or retire the component",
                )
            )
            continue

        consumers = {
            consumer
            for consumer in importers.get(target, set())
            if consumer != target and not is_test_path(consumer) and not is_playground(consumer)
        }
        if not consumers:
            violations.append(
                Violation(
                    "dead-library-component",
                    relative(target),
                    1,
                    f"`{row.name}` (index row {doc_path}:{row.lineno}) has no non-playground "
                    f"call site; "
                    f"a sanctioned component with zero consumers is dead vocabulary — "
                    f"retire it or add an incubating note naming the in-flight consumer",
                )
            )

        if row.tier in JSDOC_EXEMPT_TIERS:
            continue
        source = sources.get(target)
        if source is None:
            source = target.read_text()
        if not jsdoc_precedes_export(source, row.name.rsplit("/", 1)[-1]):
            violations.append(
                Violation(
                    "missing-library-jsdoc",
                    relative(target),
                    1,
                    f"sanctioned component `{row.name}` has no JSDoc block; the index row "
                    f"names the shape, the JSDoc states the contract at the definition",
                )
            )

    return violations


def tier_file_violations(
    rows: list[RegistryRow], importers: dict[Path, set[Path]]
) -> list[Violation]:
    """Every module inside a library tier is either indexed or named as support.

    The index is the closed set, and `registry-row-without-file` only closes it
    from one side: it catches a row whose file is gone, not a file that never
    got a row. Without this rule a new component can be dropped into
    `primitives/` with no index row, and because the JSDoc rule iterates rows,
    it inherits no documentation requirement either — the two gates that look
    like they cover the tier both look straight past it.

    Support modules are not components and are named as such:
    ``NON_COMPONENT_TIER_DIRECTORIES`` for the whole support layers and
    ``NON_COMPONENT_TIER_FILES`` for the individual modules the design document
    calls out by name. Glyph modules are excluded on the same grounds as the
    JSDoc rule: one index row documents the set.

    One structural exemption: inside a component's own folder below a tier root
    (``components/patterns/secrets/`` and the like), a module that is imported
    only from within that folder is a private part of the indexed component, not
    separate vocabulary. It has to be imported by something — a module with no
    importer at all is exactly the unindexed orphan this rule is for — and the
    exemption never applies at a tier root itself, where every module is either
    an index row or a named support file.
    """
    indexed = {row.target for row in rows}
    violations: list[Violation] = []
    for root in (PRIMITIVES_DIR, PRODUCT_PATTERNS_DIR):
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix not in EXTENSIONS:
                continue
            if path.name.endswith(".d.ts") or is_test_path(path):
                continue
            if ICONS_DIR in path.parents or path.parent == ICONS_DIR:
                continue
            relative_path = relative(path)
            if relative_path in NON_COMPONENT_TIER_FILES:
                continue
            within = path.relative_to(root).as_posix()
            if any(within.startswith(directory) for directory in NON_COMPONENT_TIER_DIRECTORIES):
                continue
            if path.resolve() in indexed:
                continue
            if path.parent not in TIER_ROOTS.values():
                consumers = {
                    consumer
                    for consumer in importers.get(path.resolve(), set())
                    if consumer != path.resolve() and not is_test_path(consumer)
                }
                if consumers and all(consumer.parent == path.parent for consumer in consumers):
                    continue
            violations.append(
                Violation(
                    "tier-file-without-registry-row",
                    relative_path,
                    1,
                    "lives in a library tier with no row in the sanctioned index; the "
                    "index is the closed set, so add the row (and its JSDoc), move the "
                    "module to a support directory, or name it in "
                    "NON_COMPONENT_TIER_FILES with the reason it is not a component",
                )
            )
    return violations


# --------------------------------------------------------------------------
# Gate: kit placement (doctrine D3)
# --------------------------------------------------------------------------


def kit_violations(rows: list[RegistryRow], sources: dict[Path, str]) -> list[Violation]:
    violations: list[Violation] = []
    kit_dirs = sorted(
        path for path in PATTERNS_DIR.iterdir() if path.is_dir() and path.name != "__tests__"
    )

    registered_kit_segments = {
        row.link.split("primitives/patterns/", 1)[1].split("/", 1)[0]
        for row in rows
        if "primitives/patterns/" in row.link
        and "/" in row.link.split("primitives/patterns/", 1)[1]
    }
    for kit_dir in kit_dirs:
        if kit_dir.name not in registered_kit_segments:
            violations.append(
                Violation(
                    "kit-directory-without-registry-rows",
                    relative(kit_dir),
                    1,
                    f"`primitives/patterns/{kit_dir.name}/` has no row in the sanctioned "
                    f"index; a kit directory without index rows is unsanctioned vocabulary",
                )
            )

    for path, source in sources.items():
        if PATTERNS_DIR not in path.parents and path.parent != PATTERNS_DIR:
            continue
        if is_test_path(path):
            continue
        # Masked, not raw: a kit member may name a feature module in prose while
        # explaining why it does NOT reach for it. `mask_comments` keeps every
        # newline, so reported line numbers still point at the real import.
        for match in IMPORT_SPECIFIER_RE.finditer(mask_comments(source)):
            spec = match.group("spec") or match.group("dyn") or match.group("req")
            if not spec:
                continue
            target = resolve_specifier(path, spec)
            if target is None:
                continue
            target_relative = relative(target)
            if "/product-client/src/components/" not in f"/{target_relative}":
                continue
            violations.append(
                Violation(
                    "kit-imports-feature-code",
                    relative(path),
                    line_number(source, match.start()),
                    f"library pattern imports feature code ({target_relative}); "
                    f"patterns take ReactNode slots, they do not reach into components/**",
                )
            )

    return violations


# --------------------------------------------------------------------------
# Allowlist
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class AllowlistEntry:
    count: int
    justification: str


def load_allowlist(path: Path = ALLOWLIST_PATH) -> dict[tuple[str, str], AllowlistEntry]:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    entries: dict[tuple[str, str], AllowlistEntry] = {}
    for rule_id, key in ALLOWLIST_RULES.items():
        for relative_path, entry in raw.get(key, {}).items():
            count = entry.get("count")
            justification = (entry.get("justification") or "").strip()
            if not isinstance(count, int) or count < 1:
                raise ValueError(
                    f"{relative(path)}: {key}[{relative_path}].count must be a positive int"
                )
            if not justification:
                raise ValueError(
                    f"{relative(path)}: {key}[{relative_path}] needs a justification string; "
                    f"an allowance without a written reason is an exemption, not a ratchet"
                )
            entries[(rule_id, relative_path)] = AllowlistEntry(count, justification)
    return entries


def collect_violations() -> list[Violation]:
    files = [path for path in iter_source_files()]
    sources = {path: path.read_text() for path in files}
    importers = build_importers(sources)
    rows = parse_registry()
    if not rows:
        raise SystemExit(
            f"{relative(DESIGN_SYSTEM_DOC)}: parsed zero sanctioned-index rows; "
            "the registry parser and the document have drifted apart"
        )
    return [
        *find_hand_rolled_role_violations(sources),
        *registry_violations(rows, sources, importers),
        *tier_file_violations(rows, importers),
        *kit_violations(rows, sources),
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)

    allowlist = load_allowlist()
    violations = collect_violations()

    grouped: dict[tuple[str, str], list[Violation]] = defaultdict(list)
    for violation in violations:
        grouped[(violation.rule_id, violation.relative_path)].append(violation)

    failures: list[str] = []
    for key, items in sorted(grouped.items()):
        allowed = allowlist[key].count if key in allowlist else 0
        for violation in items[allowed:]:
            failures.append(f"{violation.format()} (observed {len(items)}, allowed {allowed})")

    observed = Counter((v.rule_id, v.relative_path) for v in violations)
    stale: list[str] = []
    for (rule_id, relative_path), entry in sorted(allowlist.items()):
        seen = observed.get((rule_id, relative_path), 0)
        if seen < entry.count:
            stale.append(
                f"{relative_path}:1: [{RECORD_IDS.get(rule_id, 'PROD-COMPLIB-?')} {rule_id}] "
                f"stale allowance (observed {seen}, "
                f"allowed {entry.count}); the allowlist only shrinks — delete the entry "
                f"in the commit that fixed the site"
            )

    if not failures and not stale:
        print("Component library conformance check passed.")
        return 0

    if failures:
        print("Component library conformance violations:")
        for failure in failures:
            print(f"  {failure}")
    if stale:
        if failures:
            print()
        print("Stale component library allowlist entries:")
        for entry in stale:
            print(f"  {entry}")
    print(
        "\nCompose the library component that owns the shape, or retire the dead row. "
        "Allowlist entries are shrink-only and each needs a written justification."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
