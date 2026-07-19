#!/usr/bin/env python3
"""Reject fixed production text and owned vector-glyph sizes.

Appearance sizing is owned by semantic text utilities, readable-code variables,
and the --icon-* optical tiers. Structural geometry (rows, hit targets, media,
avatars, borders) is intentionally outside this check because it is not glyph
geometry.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re


REPO_ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_ROOTS = (
    REPO_ROOT / "apps" / "packages" / "ui" / "src",
    REPO_ROOT / "apps" / "packages" / "product-ui" / "src",
    REPO_ROOT / "apps" / "packages" / "product-client" / "src",
)
DESIGN_CSS_FILES = (
    REPO_ROOT / "apps" / "packages" / "design" / "src" / "css" / "product.css",
)
EXTENSIONS = {".ts", ".tsx"}

# Canonical numeric definitions are the contract, not product call sites. This
# is the only source exception; CSS defaults are outside the scanned roots and
# are drift-locked against these tables by appearance-css-drift.test.ts.
SOURCE_EXCEPTIONS = {
    "apps/packages/product-client/src/lib/domain/preferences/appearance.ts":
        "canonical UI, readable-code, window-zoom, and glyph ladders",
}

ICON_IMPORT_SOURCES = re.compile(
    r"(?:lucide-react|@phosphor-icons/react|react-icons(?:/[^\"']+)?|@proliferate/ui/icons)$"
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
        re.compile(r"\btext-(?:2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b"),
        "use a semantic appearance-owned display text role",
    ),
    (
        "fixed-text-utility",
        re.compile(r"\b(?:text|leading)-\[[0-9.]+(?:px|rem|em)\]"),
        "use a semantic text/readable-code token instead of a fixed utility",
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


@dataclass(frozen=True)
class Violation:
    rule_id: str
    path: Path
    lineno: int
    message: str

    def format(self, repo_root: Path = REPO_ROOT) -> str:
        try:
            relative = self.path.relative_to(repo_root).as_posix()
        except ValueError:
            relative = self.path.as_posix()
        return f"{relative}:{self.lineno}: [{self.rule_id}] {self.message}"


def should_skip(path: Path) -> bool:
    name = path.name
    if path.suffix not in EXTENSIONS:
        return True
    if ".test." in name or ".spec." in name or ".stories." in name or name.endswith(".d.ts"):
        return True
    return any(part in {"__tests__", "__mocks__", "playground", "fixtures", "generated"} for part in path.parts)


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


def check_source(path: Path, source: str) -> list[Violation]:
    violations: list[Violation] = []
    source_without_comments = mask_comments(source)

    for rule_id, pattern, message in FIXED_TEXT_PATTERNS:
        for match in pattern.finditer(source_without_comments):
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
            leaf_name in {"span", "div"}
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
        if not is_owned_glyph_tag(name, icons):
            continue
        checks = (
            ("fixed-glyph-attribute", FIXED_GLYPH_ATTRIBUTE_RE),
            ("fixed-glyph-style", FIXED_GLYPH_STYLE_RE),
            ("fixed-glyph-utility", FIXED_GLYPH_UTILITY_RE),
        )
        for rule_id, pattern in checks:
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
    return [
        Violation(
            "fixed-glyph-css-variable",
            path,
            line_number(source, match.start()),
            "global glyph sizes must resolve through the canonical --icon-* ladder",
        )
        for match in FIXED_ICON_CSS_VARIABLE_RE.finditer(mask_comments(source))
    ]


def iter_production_files() -> list[Path]:
    files: list[Path] = []
    for root in PRODUCTION_ROOTS:
        files.extend(
            path for path in sorted(root.rglob("*"))
            if path.is_file() and not should_skip(path)
        )
    return files


def collect_violations() -> list[Violation]:
    violations: list[Violation] = []
    for path in iter_production_files():
        relative = path.relative_to(REPO_ROOT).as_posix()
        if relative in SOURCE_EXCEPTIONS:
            continue
        violations.extend(check_source(path, path.read_text()))
    for path in DESIGN_CSS_FILES:
        violations.extend(check_design_css_source(path, path.read_text()))
    return violations


def main() -> int:
    violations = collect_violations()
    if not violations:
        print("Appearance scaling source check passed.")
        return 0

    print("Appearance scaling source violations:")
    for violation in violations:
        print(f"  {violation.format()}")
    print(
        "\nUse semantic text/readable-code tokens and icon-* optical utilities. "
        "Do not add an allowlist entry."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
