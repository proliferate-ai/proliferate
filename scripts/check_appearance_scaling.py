#!/usr/bin/env python3
"""Enforce the closed UI-foundation vocabulary in product source.

Appearance sizing is owned by semantic text utilities, readable-code variables,
and the --icon-* optical tiers. Structural geometry (rows, hit targets, media,
avatars, borders) is intentionally outside this check because it is not glyph
geometry. The same CI path also owns the finite foundation census: semantic
type, state, radius, layer, elevation, motion, raw-color, spacing, composer
backdrop, and long-list rules.

Staging (why this stays green before the consumer migration)
-----------------------------------------------------------
The token authority lands before its consumers are migrated, so several rule
families still have thousands of legitimate pre-existing hits. Every such rule
is declared in ``STAGED_RULE_IDS`` and censused per file in
``scripts/appearance_scaling_baseline.json``. The guard then fails on any hit
BEYOND the frozen per-file count: no new violation can be introduced anywhere,
while the migration burns the census down. A rule whose census reaches zero
entries is, from that moment, an absolute ban with no further bookkeeping.

The census must also stay TIGHT, not merely bounded. Absorption is anonymous —
it matches on ``(file, rule)``, never on the site that earned the slot — so a
census entry that allocates more than its file now uses is a live allowance
waiting to swallow the next new violation there. ``census_slack`` therefore
fails on any entry that has gone slack, which makes the ratchet self-tightening:
a migration must shrink the census in the same commit that fixes the sites.

Counts normally only shrink. ``--write-baseline`` refuses to grow any entry that
is not covered by ``censusGrowthSanctions`` in the baseline file (v2 §4.6: no
exception without a written sanction trail). A sanction names a rule family AND
the exact files and counts it covers, so the written trail and the enforced trail
are the same trail: growth at any other call site — or past a covered site's
recorded count — is refused even inside a sanctioned family. Growth is legitimate
in exactly one situation — a regex widens and newly SEES pre-existing sites — and
then the sanction explains which law widened it, which files it newly saw, and
who burns them down. It is never legitimate for a dead class from a removed
token: that gets deleted at the call site.

The rules themselves are records under `lints/product/appearance-scaling.toml`
(PROD-SCALE-1 .. PROD-SCALE-34); this file is only the engine. Every diagnostic
is rendered from the record — rule sentence, legal alternative, record path — via
`scripts/lint_records.py`, so a failure teaches the rule instead of reciting a
hardcoded remedy string.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    # Run as `python3 scripts/check_appearance_scaling.py` from the repo root,
    # sys.path[0] is scripts/ — the shared loader lives one level up.
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CHECKER = "scripts/check_appearance_scaling.py"
RULES = lint_records.load("product")
OWNED_RULE_IDS = frozenset(rule.id for rule in RULES.rules.values() if rule.enforced_by == CHECKER)

# Every shipped frontend source root, which is exactly the set Tailwind scans
# from `product.css` (`@source`). A root that ships utilities but is not listed here
# is a hole in the ban, not an omission of taste: the vocabulary would be closed
# everywhere except the one package nobody was looking at.
PRODUCTION_ROOTS = (
    REPO_ROOT / "apps" / "packages" / "product-client" / "src",
    REPO_ROOT / "apps" / "desktop" / "src",
)
DESIGN_CSS_FILES = (REPO_ROOT / "apps" / "packages" / "design" / "src" / "css" / "product.css",)
DESIGN_TOKEN_FILE = REPO_ROOT / "apps" / "packages" / "design" / "src" / "tokens.ts"
BASELINE_FILE = REPO_ROOT / "scripts" / "appearance_scaling_baseline.json"
EXTENSIONS = {".ts", ".tsx"}

# Canonical numeric definitions are the contract, not product call sites. These
# are the only source exceptions; generated CSS defaults are outside the scanned
# roots and are drift-locked against these tables by appearance-css-drift.test.ts.
FIXED_TEXT_SOURCE_EXCEPTIONS = {
    "apps/packages/product-client/src/lib/domain/preferences/appearance.ts": (
        "canonical UI, readable-code, window-zoom, and glyph ladders"
    ),
    "apps/packages/product-client/src/lib/domain/preferences/appearance.test.ts": (
        "exact canonical appearance-ramp pins"
    ),
    "apps/packages/product-client/src/lib/domain/preferences/appearance-css-drift.test.ts": (
        "exact generated-token drift pins"
    ),
}
GLYPH_SOURCE_EXCEPTIONS: dict[str, str] = {}
STATUS_DOT_SOURCE_EXCEPTIONS: dict[str, str] = {}

ICON_IMPORT_SOURCES = re.compile(
    r"(?:lucide-react|@phosphor-icons/react|react-icons(?:/[^\"']+)?|"
    r"#product/primitives/(?:icons/[^\"']+|Spinner))$"
)
NAMED_IMPORT_RE = re.compile(
    r"import\s*\{(?P<names>[\s\S]*?)\}\s*from\s*[\"'](?P<source>[^\"']+)[\"']",
)
JSX_TAG_RE = re.compile(
    # Deliberately stop at nested JSX instead of consuming a whole render-prop
    # expression as the outer component's attributes. Every nested icon tag
    # must be audited independently (for example, an icon inside trigger={...}).
    r"<(?P<name>[A-Za-z][A-Za-z0-9_.]*)\b(?P<attrs>[^<>]*?)/?>",
    re.MULTILINE,
)

# Rule ids, one per record in lints/product/appearance-scaling.toml. The old
# bespoke kebab names are gone: the record id is the only name a violation has,
# in diagnostics, in the census keys, and in the sanction trail.
STOCK_TEXT_RULE = "PROD-SCALE-1"
ARBITRARY_TEXT_RULE = "PROD-SCALE-2"
FONT_SIZE_PROPERTY_RULE = "PROD-SCALE-3"
FONT_SIZE_CSS_RULE = "PROD-SCALE-4"
GLYPH_ATTRIBUTE_RULE = "PROD-SCALE-5"
GLYPH_STYLE_RULE = "PROD-SCALE-6"
GLYPH_UTILITY_RULE = "PROD-SCALE-7"
GLYPH_PROP_RULE = "PROD-SCALE-8"
GLYPH_ALIAS_RULE = "PROD-SCALE-9"
GLYPH_COMPONENT_DEFAULT_RULE = "PROD-SCALE-10"
SVG_DESCENDANT_RULE = "PROD-SCALE-11"
STATUS_GLYPH_RULE = "PROD-SCALE-12"
GLYPH_CSS_VARIABLE_RULE = "PROD-SCALE-13"
ARBITRARY_RADIUS_RULE = "PROD-SCALE-14"
ARBITRARY_Z_RULE = "PROD-SCALE-15"
ARBITRARY_GAP_RULE = "PROD-SCALE-16"
ARBITRARY_SIZE_RULE = "PROD-SCALE-17"
RETIRED_SHADOW_RULE = "PROD-SCALE-18"
RETIRED_ACCENT_RULE = "PROD-SCALE-19"
FOREGROUND_ALPHA_RULE = "PROD-SCALE-20"
NUMERIC_DURATION_RULE = "PROD-SCALE-21"
INLINE_EASING_RULE = "PROD-SCALE-22"
INLINE_MOTION_RULE = "PROD-SCALE-23"
JS_MOTION_RULE = "PROD-SCALE-24"
DESIGN_MOTION_RULE = "PROD-SCALE-25"
DESIGN_EASING_RULE = "PROD-SCALE-26"
AUTHORED_BACKDROP_RULE = "PROD-SCALE-27"
UNOWNED_BACKDROP_RULE = "PROD-SCALE-28"
RAW_HEX_RULE = "PROD-SCALE-29"
AUTHORED_THEME_RULE = "PROD-SCALE-30"
AUTHORED_ROOT_TOKEN_RULE = "PROD-SCALE-31"
STANDARD_Z_RULE = "PROD-SCALE-32"
LONG_LIST_RULE = "PROD-SCALE-33"
ARBITRARY_BRACKET_GEOMETRY_RULE = "PROD-SCALE-35"

FIXED_TEXT_PATTERNS = (
    (
        STOCK_TEXT_RULE,
        re.compile(r"\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b"),
    ),
    (
        ARBITRARY_TEXT_RULE,
        re.compile(r"\btext-\[[^\]]+\]|\bleading-\[[^\]]+\]"),
    ),
    (
        FONT_SIZE_PROPERTY_RULE,
        re.compile(r"\bfontSize\s*:\s*(?:[0-9]+(?:\.[0-9]+)?|[\"'][0-9.]+(?:px|rem|em)[\"'])"),
    ),
    (
        FONT_SIZE_CSS_RULE,
        re.compile(r"\bfont-size\s*:\s*[0-9.]+(?:px|rem|em)"),
    ),
)

FIXED_GLYPH_ATTRIBUTE_RE = re.compile(
    r"\b(?:size|width|height)\s*=\s*"
    r"(?:\{\s*[0-9]+(?:\.[0-9]+)?\s*\}|[\"'][0-9]+(?:\.[0-9]+)?(?:px)?[\"'])"
)
FIXED_GLYPH_STYLE_RE = re.compile(
    r"\b(?:width|height|fontSize)\s*:\s*"
    r"(?:[0-9]+(?:\.[0-9]+)?|[\"'][0-9.]+(?:px|rem|em)[\"'])"
)
FIXED_GLYPH_UTILITY_RE = re.compile(
    r"(?<![A-Za-z0-9_-])(?:size|h|w)-"
    r"(?:[0-9]+(?:\.[0-9]+)?|\[[0-9.]+(?:px|rem|em)\])"
    r"(?![A-Za-z0-9_-])"
)
FIXED_SVG_DESCENDANT_UTILITY_RE = re.compile(
    r"\[&[^\]]*svg[^\]]*\]:(?:size|h|w)-"
    r"(?:[0-9]+(?:\.[0-9]+)?|\[[0-9.]+(?:px|rem|em)\])"
)
FIXED_GLYPH_PROP_UTILITY_RE = re.compile(
    r"\b(?:icon|glyph)ClassName\s*=\s*[\"'`]"
    r"[^\"'`]*(?:size|h|w)-(?:[0-9]+(?:\.[0-9]+)?|\[[0-9.]+(?:px|rem|em)\])"
)
FIXED_GLYPH_ALIAS_UTILITY_RE = re.compile(
    r"\b(?![A-Z0-9_]*BUTTON)[A-Z0-9_]*(?:ICON|GLYPH)[A-Z0-9_]*"
    r"(?:\s*:[^=;]+)?\s*=\s*[^;]*?"
    r"(?:size|h|w)-(?:[0-9]+(?:\.[0-9]+)?|\[[0-9.]+(?:px|rem|em)\])",
    re.MULTILINE,
)
FIXED_GLYPH_COMPONENT_DEFAULT_RE = re.compile(
    r"function\s+[A-Za-z0-9_]*(?:Icon|Glyph|Logo|Mark)\s*\([^)]*?"
    r"\b(?:size|className)\s*=\s*[\"'`]"
    r"[^\"'`]*(?:size|h|w)-(?:[0-9]+(?:\.[0-9]+)?|\[[0-9.]+(?:px|rem|em)\])",
    re.MULTILINE,
)
FIXED_STATUS_DOT_UTILITY_RE = re.compile(
    r"(?<![A-Za-z0-9_-])size-"
    r"(?:[0-9]+(?:\.[0-9]+)?|\[[0-9.]+(?:px|rem|em)\])"
    r"(?![A-Za-z0-9_-])"
)
FIXED_ICON_CSS_VARIABLE_RE = re.compile(
    r"--[a-z0-9-]*(?:icon|glyph)[a-z0-9-]*-size\s*:\s*[0-9.]+(?:px|rem|em)\s*;"
)
LOCAL_GLYPH_NAME_RE = re.compile(r"(?:Icon|Glyph|Logo|Mark)$")

ARBITRARY_RADIUS_RE = re.compile(
    r"(?<![A-Za-z0-9_-])rounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?-\[[^\]]+\]"
)
ARBITRARY_Z_RE = re.compile(r"(?<![A-Za-z0-9_-])z-\[[^\]]+\]")
STANDARD_Z_RE = re.compile(r"(?<![A-Za-z0-9_-])z-(?:0|10|20|30|40|50)(?![A-Za-z0-9_-])")
ARBITRARY_GAP_RE = re.compile(r"(?<![A-Za-z0-9_-])gap-\[[^\]]+\]")
ARBITRARY_SIZE_RE = re.compile(r"(?<![A-Za-z0-9_-])size-\[[^\]]+\]")
# The width/height/padding/margin/inset bracket families, which the arbitrary-
# value rules above deliberately stopped short of. They are censused rather than
# banned outright: virtualization math, measured overlays and grid positioning
# produce legitimate ones, so the law is "no more than today, anywhere", and the
# per-file census burns down as surfaces migrate onto the spacing scale.
ARBITRARY_BRACKET_GEOMETRY_RE = re.compile(r"(?<![A-Za-z0-9_-])(?:w|h|p|m|inset)-\[[^\]]+\]")
# `shadow-keystone` (and its historical `-sm`/`-lg` spellings) is banned from
# commit one even though no consumer has been migrated yet: the token is removed
# by the authority, so any surviving use is a dead class, not a pending
# migration. Stock Tailwind elevation (`shadow-sm/md/lg/xl/2xl/inner`) is equally
# illegal: it emits a non-token shadow, and the only sanctioned elevations are
# the three generated roles (subtle/popover/modal).
OLD_SHADOW_RE = re.compile(
    r"(?<![A-Za-z0-9_-])shadow-(?:"
    r"floating(?:-dark)?"
    r"|keystone(?:-(?:sm|md|lg|xl|2xl))?"
    r"|(?:sm|md|lg|xl|2xl|inner)"
    r"|\[[^\]]+\]"
    r")(?![A-Za-z0-9_-])"
)
OLD_ACCENT_RE = re.compile(
    r"(?<![A-Za-z0-9_-])(?:[^\s\"'`:]+:)*bg-(?:sidebar-)?accent"
    r"(?:/[^\s\"'`]+)?(?![A-Za-z0-9_-])"
)
# Catches every low-alpha foreground fill from commit one (LAW 4.2), in any
# variant position and any Tailwind alpha spelling: `bg-foreground/5`,
# `bg-foreground/[0.04]`, `bg-foreground/[8%]`, `hover:bg-foreground/10`,
# `group-hover/item:bg-foreground/[0.045]`. Tailwind compiles the plain-numeric,
# decimal-bracket, and percent-bracket forms to the same `color-mix()` output, so
# restricting the ban to one spelling (or to interaction prefixes only) just
# moves the defect — an ad-hoc overlay where a ruled state token belongs.
FOREGROUND_ALPHA_RE = re.compile(
    r"(?<![A-Za-z0-9_-])(?:[^\s\"'`:]+:)*bg-foreground/"
    r"(?P<alpha>\[[0-9]*\.?[0-9]+%?\]|[0-9]*\.?[0-9]+)"
    r"(?![A-Za-z0-9_.%-])"
)
NUMERIC_DURATION_UTILITY_RE = re.compile(
    r"(?<![A-Za-z0-9_-])duration-(?:\[[^\]]+\]|[0-9]+)(?![A-Za-z0-9_-])"
)
INLINE_CUBIC_BEZIER_RE = re.compile(r"cubic-bezier\s*\(", re.IGNORECASE)
CSS_MOTION_LITERAL_RE = re.compile(
    r"\b(?:animation(?:-duration|-delay|-timing-function)?|"
    r"transition(?:-duration|-delay|-timing-function)?)\s*:\s*"
    r"[^;\n]*(?:\b[0-9]*\.?[0-9]+m?s\b|cubic-bezier\s*\()",
    re.IGNORECASE,
)
JS_MOTION_LITERAL_RE = re.compile(
    r"\b(?:export\s+)?const\s+"
    r"(?:THINKING_TEXT_DURATION_MS|SWAP_DURATION_MS|"
    r"STREAM_REVEAL_FADE_MS|STREAM_REVEAL_HANDOFF_DELAY_MS|"
    r"CARD_EXIT_DURATION_MS|HIDE_DELAY_MS|CLICKABLE_CARD_HIDE_DELAY_MS)"
    r"\s*=\s*[0-9]+(?:\.[0-9]+)?\b"
)
# Both spellings are in scope. The design package's own composer rule authors the
# pair (`-webkit-backdrop-filter` then `backdrop-filter`), so the prefixed form is
# house style and the likely spelling of the next unowned blur — and WebKit is the
# desktop shell's engine, so a prefixed-only declaration is the one that actually
# renders. Matching either spelling means two paired declarations report two hits
# on two different lines, which is the honest count; nothing is deduped away.
BACKDROP_FILTER_RE = re.compile(r"(?<![\w-])(?:-webkit-)?backdrop-filter\s*:", re.IGNORECASE)
RAW_HEX_RE = re.compile(r"#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1}|[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b")
NEGATIVE_HEX_ASSERTION_RE = re.compile(r"\.not\.toContain\(\s*[\"']#[0-9a-fA-F]{3,8}[\"']\s*\)")
LONG_LIST_RE = re.compile(r"\{\s*(?P<owner>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.map\s*\(")
LONG_LIST_OWNER_RE = re.compile(
    r"(?:rows?|runs?|sessions?|workspaces?|files?|threads?)$", re.IGNORECASE
)

# Brand and provider marks are exact-file allowlisted: their hexes are the
# third-party brand contract, not app palette.
RAW_HEX_FILE_ALLOWLIST = {
    "apps/packages/product-client/src/components/auth/ProviderBrandIcon.tsx",
    "apps/packages/product-client/src/components/workspace/open-target/app-icons.tsx",
    "apps/desktop/src/lib/infra/measurement/boot-stall-diagnostics-overlay.ts",
}

# Rule families whose pre-existing sites are censused per file and may only
# shrink. A rule stays here after reaching zero entries: an empty census is an
# absolute ban, so no edit to this set is needed when a category is finished.
STAGED_RULE_IDS = frozenset(
    {
        STOCK_TEXT_RULE,
        ARBITRARY_TEXT_RULE,
        FONT_SIZE_PROPERTY_RULE,
        FONT_SIZE_CSS_RULE,
        GLYPH_ATTRIBUTE_RULE,
        GLYPH_STYLE_RULE,
        GLYPH_UTILITY_RULE,
        GLYPH_PROP_RULE,
        GLYPH_ALIAS_RULE,
        GLYPH_COMPONENT_DEFAULT_RULE,
        SVG_DESCENDANT_RULE,
        STATUS_GLYPH_RULE,
        ARBITRARY_RADIUS_RULE,
        ARBITRARY_Z_RULE,
        ARBITRARY_GAP_RULE,
        ARBITRARY_SIZE_RULE,
        ARBITRARY_BRACKET_GEOMETRY_RULE,
        RETIRED_SHADOW_RULE,
        RETIRED_ACCENT_RULE,
        FOREGROUND_ALPHA_RULE,
        NUMERIC_DURATION_RULE,
        INLINE_EASING_RULE,
        INLINE_MOTION_RULE,
        JS_MOTION_RULE,
        AUTHORED_BACKDROP_RULE,
        RAW_HEX_RULE,
    }
)
STAGED_CENSUS_KEY = "stagedViolations"
# Reported when a censused (file, rule) allocates more than the file now uses.
# Deliberately NOT a staged rule: it is the guard on the census, so it can never
# be absorbed by the census it guards.
CENSUS_SLACK_RULE_ID = "PROD-SCALE-34"
# v2 §4.6: no exception without a sanction trail. Keyed by rule id, each value is
# ``{"files": {<path>: <count>}, "justification": "..."}``: the written reason the
# census is allowed to move in the one direction it is not free to move, plus the
# exact call sites and counts that reason covers. Read by --write-baseline; growth
# is refused for an unlisted family, for an unlisted file inside a listed family,
# and beyond a listed file's count, so the written trail cannot be broader than
# the enforced one.
SANCTION_KEY = "censusGrowthSanctions"
SANCTION_FILES_KEY = "files"
SANCTION_JUSTIFICATION_KEY = "justification"
# Directories a migration slice finished. Their census is pinned at zero, so a
# regression there fails as a violation instead of quietly re-entering the
# census: `--write-baseline` refuses to record an entry under a sealed prefix,
# which removes the one move that could turn a finished directory back into a
# staged one. Each seal names the slice that cleaned it, so the pin is a record
# of work done rather than an opinion about a directory.
SEALED_KEY = "sealedDirectories"
SEALED_PATH_KEY = "path"
SEALED_JUSTIFICATION_KEY = "justification"
SEALED_RULE_ID = "PROD-SCALE-36"


@dataclass(frozen=True)
class Violation:
    """One violation, reported through its record.

    ``detail`` is evidence, never advice: the matched text, or the census
    arithmetic that made this hit reportable. The rule sentence and the legal
    alternative come from the record, so no remedy string is written twice.
    """

    rule_id: str
    path: Path
    lineno: int
    detail: str = ""

    def format(self, repo_root: Path = REPO_ROOT) -> str:
        return lint_records.render_diagnostic(
            RULES.rule(self.rule_id),
            f"{relative_path(self.path, repo_root)}:{self.lineno}",
            self.detail,
        )


def relative_path(path: Path, repo_root: Path = REPO_ROOT) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return path.as_posix()


def should_skip(path: Path) -> bool:
    if path.suffix not in EXTENSIONS:
        return True
    return path.name.endswith(".d.ts")


def imported_icon_names(source: str) -> set[str]:
    names: set[str] = set()
    for match in NAMED_IMPORT_RE.finditer(source):
        if not ICON_IMPORT_SOURCES.fullmatch(match.group("source")):
            continue
        for raw_name in match.group("names").split(","):
            cleaned = raw_name.strip().removeprefix("type ").strip()
            if not cleaned:
                continue
            parts = re.split(r"\s+as\s+", cleaned)
            names.add(parts[-1].strip())
    return names


def is_owned_glyph_tag(tag_name: str, imported_icons: set[str]) -> bool:
    leaf_name = tag_name.rsplit(".", 1)[-1]
    return (
        leaf_name == "svg"
        or leaf_name in imported_icons
        or LOCAL_GLYPH_NAME_RE.search(leaf_name) is not None
    )


def line_number(source: str, offset: int) -> int:
    return source.count("\n", 0, offset) + 1


def mask_comments(source: str) -> str:
    def mask(match: re.Match[str]) -> str:
        return "".join("\n" if char == "\n" else " " for char in match.group(0))

    without_blocks = re.sub(r"/\*[\s\S]*?\*/", mask, source)
    return re.sub(r"//[^\n]*", mask, without_blocks)


def raw_hex_scope_excluded(path: Path) -> bool:
    """Playground and fixture surfaces are outside the palette authority."""
    normalized_parts = {part.strip("_").lower() for part in path.parts}
    stem = path.name.split(".", 1)[0]
    return (
        "playground" in normalized_parts
        or "fixtures" in normalized_parts
        or stem.endswith("Fixture")
        or stem.endswith("Fixtures")
    )


def raw_hex_is_allowed(path: Path, source: str, match: re.Match[str]) -> bool:
    relative = relative_path(path)
    if raw_hex_scope_excluded(path) or relative in RAW_HEX_FILE_ALLOWLIST:
        return True

    line_start = source.rfind("\n", 0, match.start()) + 1
    line_end = source.find("\n", match.end())
    if line_end == -1:
        line_end = len(source)
    line = source[line_start:line_end]
    value = match.group(0)

    if NEGATIVE_HEX_ASSERTION_RE.search(line):
        return True
    if re.search(r"(?:https?|proliferate)://[^\s\"']*#[^\s\"']*", line):
        return True
    if re.search(r"url\(\s*$", source[max(0, match.start() - 8) : match.start()]):
        return True

    digits = value[1:]
    color_bearing = re.search(
        r"(?:fill|stroke|stopColor)\s*=|(?:color|background|border)\s*:|"
        r"(?:bg|text|border|shadow)-\[#",
        line,
        re.IGNORECASE,
    )
    # PR/issue identifiers such as #737 and #1042 are not CSS colors.
    return bool(digits.isdigit() and len(digits) in {3, 4} and not color_bearing)


def foreground_alpha_percent(raw_alpha: str) -> float:
    """Percent alpha for any Tailwind spelling: `/5`, `/[0.05]`, `/[8%]`.

    A bare number is already a percentage (`/5` = 5%), a bracketed decimal is a
    0..1 fraction (`/[0.05]` = 5%), and a bracketed percentage is taken as-is.
    All three compile to the same `color-mix()` output, so they must score the
    same here or the ban leaks through whichever spelling scores differently.
    """
    value = raw_alpha.strip("[]")
    if value.endswith("%"):
        return float(value[:-1])
    if "." in value:
        return float(value) * 100
    return float(value)


def matched_text(match: re.Match[str]) -> str:
    """The evidence a diagnostic quotes: the hit, collapsed to one line."""
    return " ".join(match.group(0).split())


def check_foundation_source(path: Path, source: str) -> list[Violation]:
    violations: list[Violation] = []
    source_without_comments = mask_comments(source)

    checks = (
        (ARBITRARY_RADIUS_RULE, ARBITRARY_RADIUS_RE),
        (ARBITRARY_Z_RULE, ARBITRARY_Z_RE),
        (ARBITRARY_GAP_RULE, ARBITRARY_GAP_RE),
        (ARBITRARY_SIZE_RULE, ARBITRARY_SIZE_RE),
        (ARBITRARY_BRACKET_GEOMETRY_RULE, ARBITRARY_BRACKET_GEOMETRY_RE),
        (RETIRED_SHADOW_RULE, OLD_SHADOW_RE),
        (NUMERIC_DURATION_RULE, NUMERIC_DURATION_UTILITY_RE),
        (JS_MOTION_RULE, JS_MOTION_LITERAL_RE),
        (AUTHORED_BACKDROP_RULE, BACKDROP_FILTER_RE),
    )
    for rule_id, pattern in checks:
        for match in pattern.finditer(source_without_comments):
            violations.append(
                Violation(rule_id, path, line_number(source, match.start()), matched_text(match))
            )

    def is_negative_assertion(offset: int) -> bool:
        line_start = source_without_comments.rfind("\n", 0, offset) + 1
        line_end = source_without_comments.find("\n", offset)
        if line_end == -1:
            line_end = len(source_without_comments)
        return ".not.toContain(" in source_without_comments[line_start:line_end]

    for match in OLD_ACCENT_RE.finditer(source_without_comments):
        if is_negative_assertion(match.start()):
            continue
        violations.append(
            Violation(
                RETIRED_ACCENT_RULE,
                path,
                line_number(source, match.start()),
                matched_text(match),
            )
        )

    def is_marked_activity_declaration(offset: int) -> bool:
        marker = source.rfind("/* activity-motion */", 0, offset)
        declaration_end = source.rfind(";", 0, offset)
        return marker > declaration_end

    for rule_id, pattern in (
        (INLINE_EASING_RULE, INLINE_CUBIC_BEZIER_RE),
        (INLINE_MOTION_RULE, CSS_MOTION_LITERAL_RE),
    ):
        for match in pattern.finditer(source_without_comments):
            if is_marked_activity_declaration(match.start()):
                continue
            violations.append(
                Violation(rule_id, path, line_number(source, match.start()), matched_text(match))
            )

    for match in FOREGROUND_ALPHA_RE.finditer(source_without_comments):
        if is_negative_assertion(match.start()):
            continue
        alpha = foreground_alpha_percent(match.group("alpha"))
        if alpha <= 10:
            violations.append(
                Violation(
                    FOREGROUND_ALPHA_RULE,
                    path,
                    line_number(source, match.start()),
                    f"{matched_text(match)} (resolves to {alpha:g}% foreground)",
                )
            )

    if not raw_hex_scope_excluded(path):
        for match in RAW_HEX_RE.finditer(source_without_comments):
            if not raw_hex_is_allowed(path, source_without_comments, match):
                violations.append(
                    Violation(
                        RAW_HEX_RULE,
                        path,
                        line_number(source, match.start()),
                        matched_text(match),
                    )
                )

    return violations


def check_source(path: Path, source: str) -> list[Violation]:
    violations = check_foundation_source(path, source)
    source_without_comments = mask_comments(source)
    relative = relative_path(path)

    def is_negative_assertion(offset: int) -> bool:
        line_start = source_without_comments.rfind("\n", 0, offset) + 1
        line_end = source_without_comments.find("\n", offset)
        if line_end == -1:
            line_end = len(source_without_comments)
        return ".not.toContain(" in source_without_comments[line_start:line_end]

    if relative not in FIXED_TEXT_SOURCE_EXCEPTIONS:
        for rule_id, pattern in FIXED_TEXT_PATTERNS:
            for match in pattern.finditer(source_without_comments):
                if is_negative_assertion(match.start()):
                    continue
                violations.append(
                    Violation(
                        rule_id, path, line_number(source, match.start()), matched_text(match)
                    )
                )

    for match in FIXED_SVG_DESCENDANT_UTILITY_RE.finditer(source_without_comments):
        violations.append(
            Violation(
                SVG_DESCENDANT_RULE,
                path,
                line_number(source, match.start()),
                matched_text(match),
            )
        )

    for rule_id, pattern in (
        (GLYPH_PROP_RULE, FIXED_GLYPH_PROP_UTILITY_RE),
        (GLYPH_ALIAS_RULE, FIXED_GLYPH_ALIAS_UTILITY_RE),
        (GLYPH_COMPONENT_DEFAULT_RULE, FIXED_GLYPH_COMPONENT_DEFAULT_RE),
    ):
        for match in pattern.finditer(source_without_comments):
            violations.append(
                Violation(rule_id, path, line_number(source, match.start()), matched_text(match))
            )

    icons = imported_icon_names(source)
    for tag in JSX_TAG_RE.finditer(source):
        name = tag.group("name")
        attrs = tag.group("attrs")
        leaf_name = name.rsplit(".", 1)[-1]
        if (
            relative not in STATUS_DOT_SOURCE_EXCEPTIONS
            and leaf_name in {"span", "div"}
            and tag.group(0).rstrip().endswith("/>")
            and "rounded-full" in attrs
            and "bg-" in attrs
            # Toggle thumbs are control geometry whose translation assumes a
            # fixed track/thumb size; they are not status glyphs.
            and "transition-transform" not in attrs
            and FIXED_STATUS_DOT_UTILITY_RE.search(attrs)
        ):
            violations.append(
                Violation(
                    STATUS_GLYPH_RULE,
                    path,
                    line_number(source, tag.start()),
                    matched_text(FIXED_STATUS_DOT_UTILITY_RE.search(attrs)),
                )
            )
        if relative in GLYPH_SOURCE_EXCEPTIONS or not is_owned_glyph_tag(name, icons):
            continue
        for rule_id, pattern in (
            (GLYPH_ATTRIBUTE_RULE, FIXED_GLYPH_ATTRIBUTE_RE),
            (GLYPH_STYLE_RULE, FIXED_GLYPH_STYLE_RE),
            (GLYPH_UTILITY_RULE, FIXED_GLYPH_UTILITY_RE),
        ):
            for match in pattern.finditer(attrs):
                violations.append(
                    Violation(
                        rule_id,
                        path,
                        line_number(source, tag.start("attrs") + match.start()),
                        f"<{name}> carries {matched_text(match)}",
                    )
                )

    return violations


def check_design_css_source(path: Path, source: str) -> list[Violation]:
    source_without_comments = mask_comments(source)
    violations = [
        Violation(
            GLYPH_CSS_VARIABLE_RULE,
            path,
            line_number(source, match.start()),
            matched_text(match),
        )
        for match in FIXED_ICON_CSS_VARIABLE_RE.finditer(source_without_comments)
    ]

    for match in re.finditer(r"@theme\b", source_without_comments):
        violations.append(
            Violation(
                AUTHORED_THEME_RULE,
                path,
                line_number(source, match.start()),
                matched_text(match),
            )
        )

    # Only genuinely global blocks: `:root {` and `:root[data-mode="light"] {`.
    # A scoped block such as `:root[data-mode="light"] .right-panel-tab-system`
    # declares component-local variables, which remain authored CSS.
    global_root_re = re.compile(
        r":root(?:\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*\s*\{(?P<body>[\s\S]*?)\}"
    )
    for root_match in global_root_re.finditer(source_without_comments):
        custom_property = re.search(
            r"^\s*--[a-z0-9-]+\s*:", root_match.group("body"), re.MULTILINE
        )
        if custom_property:
            violations.append(
                Violation(
                    AUTHORED_ROOT_TOKEN_RULE,
                    path,
                    line_number(source, root_match.start("body") + custom_property.start()),
                    matched_text(custom_property),
                )
            )

    def is_marked_infinite_activity(offset: int) -> bool:
        block_start = source.rfind("{", 0, offset)
        block_end = source.find("}", offset)
        if block_end == -1:
            block_end = len(source)
        selector_start = max(source.rfind("}", 0, block_start), 0)
        marker_scope = source[selector_start:block_start]
        rule_body = source[block_start:block_end]
        return "/* activity-motion */" in marker_scope and "infinite" in rule_body.lower()

    for match in CSS_MOTION_LITERAL_RE.finditer(source_without_comments):
        is_marked_activity = "animation" in match.group(0).lower() and is_marked_infinite_activity(
            match.start()
        )
        if not is_marked_activity:
            violations.append(
                Violation(
                    DESIGN_MOTION_RULE,
                    path,
                    line_number(source, match.start()),
                    matched_text(match),
                )
            )

    for match in INLINE_CUBIC_BEZIER_RE.finditer(source_without_comments):
        if is_marked_infinite_activity(match.start()):
            continue
        if not any(
            violation.rule_id == DESIGN_MOTION_RULE
            and violation.lineno == line_number(source, match.start())
            for violation in violations
        ):
            violations.append(
                Violation(
                    DESIGN_EASING_RULE,
                    path,
                    line_number(source, match.start()),
                    matched_text(match),
                )
            )

    for match in BACKDROP_FILTER_RE.finditer(source_without_comments):
        block_start = source.rfind("{", 0, match.start())
        selector_start = max(source.rfind("}", 0, block_start), 0)
        selector = source[selector_start:block_start]
        if ".chat-composer-surface" not in selector:
            violations.append(
                Violation(
                    UNOWNED_BACKDROP_RULE,
                    path,
                    line_number(source, match.start()),
                    f"{matched_text(match)} declared by "
                    f"`{' '.join(selector.split()).lstrip('} ')}`",
                )
            )

    return violations


def load_baselines(path: Path = BASELINE_FILE) -> dict[str, dict[str, int]]:
    return json.loads(path.read_text())


def source_counters(
    sources: Iterable[tuple[Path, str]],
    repo_root: Path = REPO_ROOT,
) -> tuple[Counter[str], Counter[str], dict[str, tuple[Path, int]]]:
    standard_z: Counter[str] = Counter()
    long_lists: Counter[str] = Counter()
    locations: dict[str, tuple[Path, int]] = {}

    for path, source in sources:
        relative = relative_path(path, repo_root)
        source_without_comments = mask_comments(source)
        # The frozen census intentionally includes explanatory z-10 comments;
        # compare the same literal-source surface.
        for match in STANDARD_Z_RE.finditer(source):
            key = f"{relative}|{match.group(0)}"
            standard_z[key] += 1
            locations.setdefault(key, (path, line_number(source, match.start())))

        if "virtual" in path.name.lower() or re.search(r"useVirtual|virtualizer", source):
            continue
        for match in LONG_LIST_RE.finditer(source_without_comments):
            owner = match.group("owner")
            if not LONG_LIST_OWNER_RE.search(owner):
                continue
            key = f"{relative}|{owner}"
            long_lists[key] += 1
            locations.setdefault(key, (path, line_number(source, match.start())))

    return standard_z, long_lists, locations


def check_census_additions(
    sources: Iterable[tuple[Path, str]],
    baselines: Mapping[str, Mapping[str, int]],
    repo_root: Path = REPO_ROOT,
) -> list[Violation]:
    standard_z, long_lists, locations = source_counters(sources, repo_root)
    violations: list[Violation] = []

    for rule_id, current, baseline_name in (
        (STANDARD_Z_RULE, standard_z, "standardNumericZ"),
        (LONG_LIST_RULE, long_lists, "unvirtualizedLongLists"),
    ):
        baseline = baselines.get(baseline_name, {})
        for key, count in sorted(current.items()):
            frozen = baseline.get(key, 0)
            if count <= frozen:
                continue
            path, lineno = locations[key]
            _relative, _, site = key.rpartition("|")
            violations.append(
                Violation(
                    rule_id,
                    path,
                    lineno,
                    f"`{site}` appears {count}× here; the {baseline_name} census "
                    f"freezes it at {frozen}",
                )
            )

    return violations


def staged_census(violations: Iterable[Violation], repo_root: Path = REPO_ROOT) -> dict[str, int]:
    """Per-file counts for every staged rule family, as stored in the baseline."""
    counts: Counter[str] = Counter()
    for violation in violations:
        if violation.rule_id not in STAGED_RULE_IDS:
            continue
        counts[f"{relative_path(violation.path, repo_root)}|{violation.rule_id}"] += 1
    return dict(sorted(counts.items()))


def census_slack(
    violations: Sequence[Violation],
    baseline: Mapping[str, int],
    repo_root: Path = REPO_ROOT,
    scope: set[str] | None = None,
) -> list[Violation]:
    """Census entries that now allocate more than the tree uses.

    An absorbed allowance is anonymous: ``apply_staged_baseline`` matches on
    ``(file, rule)``, never on the specific site that earned the slot. So the
    moment a migration fixes a site without regenerating the census, the freed
    slot silently becomes headroom for the NEXT new violation of that rule in
    that file — the ban leaking, dressed as a pre-existing hit. The ratchet is
    only self-tightening if the census shrinks in lockstep with the migration,
    which is why slack fails here instead of passing quietly. The remedy is the
    one command that can only shrink: ``--write-baseline`` refuses growth
    (v2 §4.6), so it cannot be used to paper over a real regression.

    ``scope`` limits the check to census keys whose file was actually scanned;
    the pre-commit hook passes an explicit file list, and an unscanned file's
    count is unknown, not zero.
    """
    actual = staged_census(violations, repo_root)
    reported: list[Violation] = []
    for key, frozen in sorted(baseline.items()):
        relative, _, rule_id = key.rpartition("|")
        if scope is not None and relative not in scope:
            continue
        hits = actual.get(key, 0)
        if hits >= frozen:
            continue
        reported.append(
            Violation(
                CENSUS_SLACK_RULE_ID,
                repo_root / relative,
                1,
                f"{rule_id} is frozen at {frozen} here but the file now has {hits}",
            )
        )
    return reported


def sealed_prefixes(baseline: Mapping[str, object]) -> list[tuple[str, str]]:
    """``(prefix, justification)`` for every sealed directory, validated.

    A seal without a written reason is an opinion, not a record, so it is
    rejected at load time rather than enforced silently.
    """
    sealed: list[tuple[str, str]] = []
    for entry in baseline.get(SEALED_KEY, []) or []:
        prefix = str(entry.get(SEALED_PATH_KEY, "")).strip()
        justification = str(entry.get(SEALED_JUSTIFICATION_KEY, "")).strip()
        if not prefix:
            raise ValueError(f"{SEALED_KEY} entry is missing {SEALED_PATH_KEY!r}")
        if not justification:
            raise ValueError(
                f"{SEALED_KEY} entry {prefix!r} needs a {SEALED_JUSTIFICATION_KEY!r} "
                "naming the slice that cleaned it"
            )
        sealed.append((prefix if prefix.endswith("/") else prefix + "/", justification))
    return sealed


def sealed_directory_violations(
    violations: Sequence[Violation],
    baseline: Mapping[str, object],
    repo_root: Path = REPO_ROOT,
) -> list[Violation]:
    """Any staged-rule hit inside a directory a slice already finished.

    Reported before the census is applied, so a sealed directory cannot absorb a
    hit even if a stale census entry survived for one of its files. This is the
    difference between "burning down" and "finished": the rest of the tree
    ratchets, a sealed directory is an absolute ban.
    """
    sealed = sealed_prefixes(baseline)
    if not sealed:
        return []
    reported: list[Violation] = []
    for violation in violations:
        if violation.rule_id not in STAGED_RULE_IDS:
            continue
        relative = relative_path(violation.path, repo_root)
        for prefix, justification in sealed:
            if relative.startswith(prefix):
                reported.append(
                    Violation(
                        SEALED_RULE_ID,
                        violation.path,
                        violation.lineno,
                        f"[{violation.rule_id}] {violation.detail} — {prefix} is "
                        f"sealed at zero ({justification}); a finished directory "
                        f"re-baselines to nothing, so fix the site",
                    )
                )
                break
    return reported


def apply_staged_baseline(
    violations: Sequence[Violation],
    baseline: Mapping[str, int],
    repo_root: Path = REPO_ROOT,
) -> list[Violation]:
    """Drop the frozen number of pre-existing hits per (file, rule); keep the rest.

    Unstaged rules pass through untouched, so they fail on the first hit. This
    bounds the census from above only; ``census_slack`` bounds it from below, and
    both run in ``collect_violations`` because either alone leaks.
    """
    remaining = dict(baseline)
    reported: list[Violation] = []
    ordered = sorted(
        violations,
        key=lambda violation: (
            relative_path(violation.path, repo_root),
            violation.rule_id,
            violation.lineno,
        ),
    )
    for violation in ordered:
        if violation.rule_id not in STAGED_RULE_IDS:
            reported.append(violation)
            continue
        key = f"{relative_path(violation.path, repo_root)}|{violation.rule_id}"
        allowance = remaining.get(key, 0)
        if allowance > 0:
            remaining[key] = allowance - 1
            continue
        reported.append(
            Violation(
                violation.rule_id,
                violation.path,
                violation.lineno,
                f"{violation.detail} (staged rule: this file's frozen census is "
                f"{baseline.get(key, 0)}; new sites are rejected)",
            )
        )
    return reported


def iter_production_files() -> list[Path]:
    files: list[Path] = []
    for root in PRODUCTION_ROOTS:
        files.extend(
            path for path in sorted(root.rglob("*")) if path.is_file() and not should_skip(path)
        )
    return files


def collect_raw_violations(paths: Sequence[Path] | None = None) -> list[Violation]:
    """Every violation before staging is applied."""
    violations: list[Violation] = []
    # The design authority files have their own rule sets; never run the product
    # source rules over them (they own generated CSS and the token table).
    authority_files = {*DESIGN_CSS_FILES, DESIGN_TOKEN_FILE}
    requested = set(paths) if paths is not None else None
    files = [
        path
        for path in (list(paths) if paths is not None else iter_production_files())
        if path not in authority_files
    ]
    sources = [(path, path.read_text()) for path in files if path.is_file()]
    for path, source in sources:
        violations.extend(check_source(path, source))
    if paths is None:
        violations.extend(check_census_additions(sources, load_baselines()))
    design_css = [path for path in DESIGN_CSS_FILES if requested is None or path in requested]
    for path in design_css:
        violations.extend(check_design_css_source(path, path.read_text()))
    return violations


def collect_violations(paths: Sequence[Path] | None = None) -> list[Violation]:
    raw = collect_raw_violations(paths)
    baselines = load_baselines()
    baseline = baselines.get(STAGED_CENSUS_KEY, {})
    scope = None if paths is None else {relative_path(path) for path in paths}
    return [
        *apply_staged_baseline(raw, baseline),
        *census_slack(raw, baseline, scope=scope),
        *sealed_directory_violations(raw, baselines),
    ]


def sanctioned_growth_ceilings(
    sanctions: Mapping[str, Mapping[str, object]],
) -> dict[str, int]:
    """Per ``file|rule`` census key, the highest count a sanction authorizes.

    A sanction is scoped twice over, because naming a family is not enough: the
    reason a family may grow is always a specific set of newly seen call sites,
    and a specific number of them. ``files`` maps each covered path to the count
    the widening exposed there, so the enforced scope is exactly the scope the
    prose claims — a brand-new violation in an unrelated file cannot be absorbed
    by another file's sanction, and a second new violation in a covered file
    cannot ride in behind the first.
    """
    ceilings: dict[str, int] = {}
    for rule_id, sanction in sanctions.items():
        for relative, ceiling in sanction.get(SANCTION_FILES_KEY, {}).items():
            ceilings[f"{relative}|{rule_id}"] = ceiling
    return ceilings


def unsanctioned_growth(
    previous: Mapping[str, int],
    current: Mapping[str, int],
    sanctions: Mapping[str, Mapping[str, object]],
) -> list[str]:
    """Census keys whose count rose past everything the law allows.

    This is the whole shrink-only decision, kept pure so it is provable without
    touching the tree: a key may sit at its frozen count or below, or at the count
    a scoped sanction records for that exact file — anything higher is reported.
    """
    ceilings = sanctioned_growth_ceilings(sanctions)
    return sorted(
        f"{key}: {previous.get(key, 0)} -> {count}"
        for key, count in current.items()
        if count > max(previous.get(key, 0), ceilings.get(key, 0))
    )


def write_baseline(path: Path = BASELINE_FILE) -> int:
    """Rewrite the staged census. Growth needs a written sanction (v2 §4.6).

    Shrinking is always free. A count may only grow at a ``file|rule`` census key
    that a sanction in ``SANCTION_KEY`` names explicitly, and only up to the count
    that sanction records — the justification is the written trail the law demands
    and the ``files`` map is that same trail made enforceable, both living next to
    the numbers they authorize. Growth in an unsanctioned family, in an
    unsanctioned file of a sanctioned family, or beyond a sanctioned file's
    recorded count is refused outright, which is what makes an absorbed violation
    (a dead class or a fresh overlay quietly censused instead of migrated)
    impossible to land.
    """
    existing = load_baselines()
    current = staged_census(collect_raw_violations())
    previous: Mapping[str, int] = existing.get(STAGED_CENSUS_KEY, {})

    sealed = sealed_prefixes(existing)
    resealed = sorted(
        key for key in current if any(key.startswith(prefix) for prefix, _ in sealed)
    )
    if resealed:
        print("Refusing to census a sealed directory; these are finished, not staged:")
        for key in resealed:
            print(f"  {key}")
        return 1

    unsanctioned = unsanctioned_growth(previous, current, existing.get(SANCTION_KEY, {}))
    if unsanctioned and previous:
        print("Refusing to grow the staged census without a sanction; migrate these sites")
        print(
            f"or record each file and its count in {relative_path(path)} -> "
            f"{SANCTION_KEY}[<rule>].{SANCTION_FILES_KEY}:"
        )
        for line in unsanctioned:
            print(f"  {line}")
        return 1
    existing[STAGED_CENSUS_KEY] = current
    path.write_text(json.dumps(existing, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {len(current)} staged census entries to {relative_path(path)}.")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write-baseline",
        action="store_true",
        help="regenerate the staged census (only ever shrinking it)",
    )
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        help="optional explicit files (pre-commit hook); default is every production root",
    )
    args = parser.parse_args(argv)

    if args.write_baseline:
        return write_baseline()

    explicit = [path.resolve() for path in args.paths] if args.paths else None
    if explicit is not None:
        explicit = [path for path in explicit if path in DESIGN_CSS_FILES or not should_skip(path)]
        if not explicit:
            return 0
    violations = collect_violations(explicit)
    if not violations:
        print("Appearance scaling source check passed.")
        return 0

    print("Appearance scaling source violations:")
    for violation in violations:
        print(violation.format())
        print()
    print(
        "Use the semantic design vocabulary and update behavior, not the guard. The"
        "\nstaged census may only shrink: `--write-baseline` refuses growth that no"
        "\ncensusGrowthSanctions entry authorizes for that exact file and count."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
