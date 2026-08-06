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
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Iterable, Mapping, Sequence


REPO_ROOT = Path(__file__).resolve().parents[1]
# Every shipped frontend source root, which is exactly the set Tailwind scans
# from `product.css` (`@source`). A root that ships utilities but is not listed here
# is a hole in the ban, not an omission of taste: the vocabulary would be closed
# everywhere except the one package nobody was looking at.
PRODUCTION_ROOTS = (
    REPO_ROOT / "apps" / "packages" / "product-client" / "src",
    REPO_ROOT / "apps" / "desktop" / "src",
)
DESIGN_CSS_FILES = (
    REPO_ROOT / "apps" / "packages" / "design" / "src" / "css" / "product.css",
)
DESIGN_TOKEN_FILE = REPO_ROOT / "apps" / "packages" / "design" / "src" / "tokens.ts"
BASELINE_FILE = REPO_ROOT / "scripts" / "appearance_scaling_baseline.json"
EXTENSIONS = {".ts", ".tsx"}

# Canonical numeric definitions are the contract, not product call sites. These
# are the only source exceptions; generated CSS defaults are outside the scanned
# roots and are drift-locked against these tables by appearance-css-drift.test.ts.
FIXED_TEXT_SOURCE_EXCEPTIONS = {
    "apps/packages/product-client/src/lib/domain/preferences/appearance.ts":
        "canonical UI, readable-code, window-zoom, and glyph ladders",
    "apps/packages/product-client/src/lib/domain/preferences/appearance.test.ts":
        "exact canonical appearance-ramp pins",
    "apps/packages/product-client/src/lib/domain/preferences/appearance-css-drift.test.ts":
        "exact generated-token drift pins",
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

FIXED_TEXT_PATTERNS = (
    (
        "fixed-stock-text-utility",
        re.compile(r"\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b"),
        "use a semantic appearance-owned text role",
    ),
    (
        "fixed-text-utility",
        re.compile(r"\btext-\[[^\]]+\]|\bleading-\[[^\]]+\]"),
        "use a semantic text/readable-code token instead of an arbitrary utility",
    ),
    (
        "fixed-font-size-property",
        re.compile(
            r"\bfontSize\s*:\s*(?:[0-9]+(?:\.[0-9]+)?|[\"'][0-9.]+(?:px|rem|em)[\"'])"
        ),
        "derive third-party fontSize values from the active appearance preference",
    ),
    (
        "fixed-font-size-css",
        re.compile(r"\bfont-size\s*:\s*[0-9.]+(?:px|rem|em)"),
        "use a semantic CSS variable instead of a fixed font-size",
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
BACKDROP_FILTER_RE = re.compile(
    r"(?<![\w-])(?:-webkit-)?backdrop-filter\s*:", re.IGNORECASE
)
RAW_HEX_RE = re.compile(r"#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1}|[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b")
NEGATIVE_HEX_ASSERTION_RE = re.compile(r"\.not\.toContain\(\s*[\"']#[0-9a-fA-F]{3,8}[\"']\s*\)")
LONG_LIST_RE = re.compile(
    r"\{\s*(?P<owner>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.map\s*\("
)
LONG_LIST_OWNER_RE = re.compile(r"(?:rows?|runs?|sessions?|workspaces?|files?|threads?)$", re.IGNORECASE)

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
STAGED_RULE_IDS = frozenset({
    "fixed-stock-text-utility",
    "fixed-text-utility",
    "fixed-font-size-property",
    "fixed-font-size-css",
    "fixed-glyph-attribute",
    "fixed-glyph-style",
    "fixed-glyph-utility",
    "fixed-glyph-prop-utility",
    "fixed-glyph-alias-utility",
    "fixed-glyph-component-default",
    "fixed-svg-descendant-utility",
    "fixed-status-glyph-utility",
    "arbitrary-radius",
    "arbitrary-z",
    "arbitrary-gap",
    "arbitrary-size",
    "retired-shadow",
    "retired-accent-state",
    "foreground-alpha-foundation",
    "numeric-duration",
    "inline-easing",
    "inline-motion-literal",
    "inline-js-motion-literal",
    "authored-backdrop-filter",
    "raw-hex",
})
STAGED_CENSUS_KEY = "stagedViolations"
# Reported when a censused (file, rule) allocates more than the file now uses.
# Deliberately NOT a staged rule: it is the guard on the census, so it can never
# be absorbed by the census it guards.
CENSUS_SLACK_RULE_ID = "stale-census-allowance"
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


@dataclass(frozen=True)
class Violation:
    rule_id: str
    path: Path
    lineno: int
    message: str

    def format(self, repo_root: Path = REPO_ROOT) -> str:
        return f"{relative_path(self.path, repo_root)}:{self.lineno}: [{self.rule_id}] {self.message}"


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
    if re.search(r"url\(\s*$", source[max(0, match.start() - 8):match.start()]):
        return True

    digits = value[1:]
    color_bearing = re.search(
        r"(?:fill|stroke|stopColor)\s*=|(?:color|background|border)\s*:|"
        r"(?:bg|text|border|shadow)-\[#",
        line,
        re.IGNORECASE,
    )
    if digits.isdigit() and len(digits) in {3, 4} and not color_bearing:
        # PR/issue identifiers such as #737 and #1042 are not CSS colors.
        return True
    return False


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


def check_foundation_source(path: Path, source: str) -> list[Violation]:
    violations: list[Violation] = []
    source_without_comments = mask_comments(source)

    checks = (
        (
            "arbitrary-radius",
            ARBITRARY_RADIUS_RE,
            "use the ruled semantic radius scale, including directional radius utilities",
        ),
        ("arbitrary-z", ARBITRARY_Z_RE, "use a semantic z-* layer utility"),
        ("arbitrary-gap", ARBITRARY_GAP_RE, "use the ruled standard gap utility"),
        ("arbitrary-size", ARBITRARY_SIZE_RE, "use standard container geometry and semantic icon tiers"),
        ("retired-shadow", OLD_SHADOW_RE, "use shadow-popover/shadow-modal or remove non-floating elevation"),
        ("numeric-duration", NUMERIC_DURATION_UTILITY_RE, "use the semantic duration-* utility"),
        ("inline-js-motion-literal", JS_MOTION_LITERAL_RE, "import the shared design motion authority"),
        ("authored-backdrop-filter", BACKDROP_FILTER_RE, "backdrop-filter is owned by the composer design CSS"),
    )
    for rule_id, pattern, message in checks:
        for match in pattern.finditer(source_without_comments):
            violations.append(
                Violation(rule_id, path, line_number(source, match.start()), message)
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
                "retired-accent-state",
                path,
                line_number(source, match.start()),
                "use bg-hover/bg-active/bg-selected or the ruled static surface",
            )
        )

    def is_marked_activity_declaration(offset: int) -> bool:
        marker = source.rfind("/* activity-motion */", 0, offset)
        declaration_end = source.rfind(";", 0, offset)
        return marker > declaration_end

    for rule_id, pattern, message in (
        ("inline-easing", INLINE_CUBIC_BEZIER_RE, "use a generated semantic easing token"),
        ("inline-motion-literal", CSS_MOTION_LITERAL_RE, "use generated semantic motion variables"),
    ):
        for match in pattern.finditer(source_without_comments):
            if is_marked_activity_declaration(match.start()):
                continue
            violations.append(
                Violation(rule_id, path, line_number(source, match.start()), message)
            )

    for match in FOREGROUND_ALPHA_RE.finditer(source_without_comments):
        if is_negative_assertion(match.start()):
            continue
        if foreground_alpha_percent(match.group("alpha")) <= 10:
            violations.append(
                Violation(
                    "foreground-alpha-foundation",
                    path,
                    line_number(source, match.start()),
                    "use a ruled semantic state or static surface instead of a <=10% foreground overlay",
                )
            )

    if not raw_hex_scope_excluded(path):
        for match in RAW_HEX_RE.finditer(source_without_comments):
            if not raw_hex_is_allowed(path, source_without_comments, match):
                violations.append(
                    Violation(
                        "raw-hex",
                        path,
                        line_number(source, match.start()),
                        "move rendered palette colors into the design token authority",
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
        for rule_id, pattern, message in FIXED_TEXT_PATTERNS:
            for match in pattern.finditer(source_without_comments):
                if is_negative_assertion(match.start()):
                    continue
                violations.append(Violation(rule_id, path, line_number(source, match.start()), message))

    for match in FIXED_SVG_DESCENDANT_UTILITY_RE.finditer(source_without_comments):
        violations.append(
            Violation(
                "fixed-svg-descendant-utility",
                path,
                line_number(source, match.start()),
                "SVG descendant sizing must use a semantic icon-* tier",
            )
        )

    for rule_id, pattern, message in (
        (
            "fixed-glyph-prop-utility",
            FIXED_GLYPH_PROP_UTILITY_RE,
            "iconClassName/glyphClassName must use a semantic icon-* tier",
        ),
        (
            "fixed-glyph-alias-utility",
            FIXED_GLYPH_ALIAS_UTILITY_RE,
            "icon/glyph class aliases must use a semantic icon-* tier",
        ),
        (
            "fixed-glyph-component-default",
            FIXED_GLYPH_COMPONENT_DEFAULT_RE,
            "local glyph component defaults must use a semantic icon-* tier",
        ),
    ):
        for match in pattern.finditer(source_without_comments):
            violations.append(Violation(rule_id, path, line_number(source, match.start()), message))

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
                    "fixed-status-glyph-utility",
                    path,
                    line_number(source, tag.start()),
                    "status dot must use the icon-status semantic utility",
                )
            )
        if relative in GLYPH_SOURCE_EXCEPTIONS or not is_owned_glyph_tag(name, icons):
            continue
        for rule_id, pattern in (
            ("fixed-glyph-attribute", FIXED_GLYPH_ATTRIBUTE_RE),
            ("fixed-glyph-style", FIXED_GLYPH_STYLE_RE),
            ("fixed-glyph-utility", FIXED_GLYPH_UTILITY_RE),
        ):
            for match in pattern.finditer(attrs):
                violations.append(
                    Violation(
                        rule_id,
                        path,
                        line_number(source, tag.start("attrs") + match.start()),
                        f"<{name}> must use a semantic --icon-* tier; hit-target geometry belongs on its wrapper",
                    )
                )

    return violations


def check_design_css_source(path: Path, source: str) -> list[Violation]:
    source_without_comments = mask_comments(source)
    violations = [
        Violation(
            "fixed-glyph-css-variable",
            path,
            line_number(source, match.start()),
            "global glyph sizes must resolve through the canonical --icon-* ladder",
        )
        for match in FIXED_ICON_CSS_VARIABLE_RE.finditer(source_without_comments)
    ]

    for match in re.finditer(r"@theme\b", source_without_comments):
        violations.append(
            Violation(
                "authored-theme-block",
                path,
                line_number(source, match.start()),
                "@theme is generated from tokens.ts and cannot be authored in component CSS",
            )
        )

    # Only genuinely global blocks: `:root {` and `:root[data-mode="light"] {`.
    # A scoped block such as `:root[data-mode="light"] .right-panel-tab-system`
    # declares component-local variables, which remain authored CSS.
    global_root_re = re.compile(
        r":root(?:\[[^\]]*\]|:[a-z-]+(?:\([^)]*\))?)*\s*\{(?P<body>[\s\S]*?)\}"
    )
    for root_match in global_root_re.finditer(source_without_comments):
        custom_property = re.search(r"^\s*--[a-z0-9-]+\s*:", root_match.group("body"), re.MULTILINE)
        if custom_property:
            violations.append(
                Violation(
                    "authored-root-token",
                    path,
                    line_number(source, root_match.start("body") + custom_property.start()),
                    "global tokens are generated from tokens.ts, not declared in product.css",
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
        is_marked_activity = (
            "animation" in match.group(0).lower()
            and is_marked_infinite_activity(match.start())
        )
        if not is_marked_activity:
            violations.append(
                Violation(
                    "design-finite-motion-literal",
                    path,
                    line_number(source, match.start()),
                    "finite design CSS motion must use generated duration/easing variables",
                )
            )

    for match in INLINE_CUBIC_BEZIER_RE.finditer(source_without_comments):
        if is_marked_infinite_activity(match.start()):
            continue
        if not any(
            violation.rule_id == "design-finite-motion-literal"
            and violation.lineno == line_number(source, match.start())
            for violation in violations
        ):
            violations.append(
                Violation(
                    "design-easing-literal",
                    path,
                    line_number(source, match.start()),
                    "design CSS easing must resolve through a generated easing variable",
                )
            )

    for match in BACKDROP_FILTER_RE.finditer(source_without_comments):
        block_start = source.rfind("{", 0, match.start())
        selector_start = max(source.rfind("}", 0, block_start), 0)
        selector = source[selector_start:block_start]
        if ".chat-composer-surface" not in selector:
            violations.append(
                Violation(
                    "unowned-backdrop-filter",
                    path,
                    line_number(source, match.start()),
                    "only the composer surface owns an authored backdrop-filter",
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

    for rule_id, current, baseline_name, message in (
        (
            "standard-z-addition",
            standard_z,
            "standardNumericZ",
            "new standard numeric z-index sites are closed; use a semantic z-* layer",
        ),
        (
            "unvirtualized-long-list-addition",
            long_lists,
            "unvirtualizedLongLists",
            "new long-list surfaces must use the repository virtualization path",
        ),
    ):
        baseline = baselines.get(baseline_name, {})
        for key, count in sorted(current.items()):
            if count <= baseline.get(key, 0):
                continue
            path, lineno = locations[key]
            violations.append(Violation(rule_id, path, lineno, message))

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
                f"stale census: [{rule_id}] is frozen at {frozen} here but the file "
                f"now has {hits}. Run `python3 scripts/check_appearance_scaling.py "
                f"--write-baseline` to ratchet the census down; leaving the freed "
                f"allowance in place would let it absorb a new violation.",
            )
        )
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
                f"{violation.message} (staged rule: this file's frozen census is "
                f"{baseline.get(key, 0)}; new sites are rejected)",
            )
        )
    return reported


def iter_production_files() -> list[Path]:
    files: list[Path] = []
    for root in PRODUCTION_ROOTS:
        files.extend(
            path for path in sorted(root.rglob("*"))
            if path.is_file() and not should_skip(path)
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
    baseline = load_baselines().get(STAGED_CENSUS_KEY, {})
    scope = None if paths is None else {relative_path(path) for path in paths}
    return [
        *apply_staged_baseline(raw, baseline),
        *census_slack(raw, baseline, scope=scope),
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
        explicit = [
            path
            for path in explicit
            if path in DESIGN_CSS_FILES or not should_skip(path)
        ]
        if not explicit:
            return 0
    violations = collect_violations(explicit)
    if not violations:
        print("Appearance scaling source check passed.")
        return 0

    print("Appearance scaling source violations:")
    for violation in violations:
        print(f"  {violation.format()}")
    print(
        "\nUse the semantic design vocabulary and update behavior, not the guard. "
        "Baseline manifests may only shrink unless the frozen specification changes."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
