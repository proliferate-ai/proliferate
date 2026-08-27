#!/usr/bin/env python3

"""Enforce WCAG contrast floors on the BUILT stylesheet, in both modes.

Why the built stylesheet and not `tokens.ts`: the authority is a TypeScript
record of `{dark, light}` halves, and what a browser actually paints is the
projection of that record through `scripts/generate-theme.mjs` — including
`var()` indirection between roles and any surviving `color-mix()`. Reading the
record would prove the literals were typed correctly; reading
`apps/packages/design/dist/theme.css` proves the RESOLVED role reads legibly,
which is the property a person perceives.

The floors below exist because light mode was originally derived from dark by
flipping the ink while keeping dark's alpha percentages. `color-mix(foreground
X%, transparent)` is only meaningful when you know the backdrop, and with five
elevation roles you do not: every neutral collapsed toward the page, faint text
landed at 3.28:1 at 11px, and the persistent `selected` state read weaker than
the transient `hover`. Those are all mechanically detectable, so they are
detected here rather than re-discovered by eye.

Text is measured against EVERY plane the product paints it on, not just the
page: in light mode the editor, rail, and translucent control fills all differ
from white, so measuring only `surface` and `background` left them unchecked.
That blind spot is exactly where the faint tier was failing while this check
reported green, so the plane list is the contract too — a new elevation role
belongs in `TEXT_PLANES`.

Floors (both modes, no per-mode exemptions):
  * body text        >= 7.0:1   against every measured plane
  * secondary text   >= 4.5:1   against every measured plane
  * faint text       >= 4.5:1   against every measured plane
  * borders          >= 1.25:1  against the surface they divide
  * hover/selected/active mutually distinguishable, AND selected carries more
    ink than hover — a persistent state may never read fainter than a
    transient one.

Five measured dark-mode pairs do not meet those floors and are NOT silently
exempted: each is a grandfathered site in `lints/product/exceptions.toml`,
carrying its reasoning, and the exact ratio measured when it was accepted is
pinned in `DECLARED_DEVIATION_RATIOS` under the same `(path, site)` key — because
an `[[exception]]` entry carries prose, not numbers. A pinned pair may improve
freely and can never regress.

The rules themselves are records under `lints/product/theme.toml`; this file is
only the engine. Diagnostics are rendered from the record (rule sentence, legal
alternative, record path) via `scripts/lint_records.py`.

Exit codes: 0 = all floors met (or met as pinned), 1 = at least one violation.

Run:  python3.12 scripts/check_theme_contrast.py [--table]
`--table` prints every measured pair for both modes even when green, which is
how the numbers in a design review get produced.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    # Run as `python3 scripts/check_theme_contrast.py` from the repo root,
    # sys.path[0] is scripts/ — the shared loader lives one level up.
    sys.path.insert(0, str(REPO_ROOT))

from scripts import lint_records  # noqa: E402  (path shim must precede the import)

CHECKER = "scripts/check_theme_contrast.py"
RULES = lint_records.load("product")
OWNED_RULE_IDS = frozenset(rule.id for rule in RULES.rules.values() if rule.enforced_by == CHECKER)

THEME_CSS = REPO_ROOT / "apps" / "packages" / "design" / "dist" / "theme.css"
# The `path` every PROD-THEME exception entry is filed under: this checker
# measures one artifact, so the ledger's fine-grained axis is the `site`.
THEME_CSS_RECORD_PATH = "apps/packages/design/dist/theme.css"

TEXT_RULE = "PROD-THEME-1"
SIDEBAR_RULE = "PROD-THEME-2"
BORDER_RULE = "PROD-THEME-3"
STATE_RULE = "PROD-THEME-4"
ORPHAN_PIN_RULE = "PROD-THEME-5"
STALE_PIN_RULE = "PROD-THEME-6"

DARK_SELECTOR = ":root"
LIGHT_SELECTOR = ':root[data-mode="light"]'

BODY_FLOOR = 7.0
SECONDARY_FLOOR = 4.5
FAINT_FLOOR = 4.5
BORDER_FLOOR = 1.25
# Two state fills are "distinguishable" once their own contrast ratio clears
# this. It is deliberately a hair above 1.0: state fills are meant to be a step,
# not a jump, so the floor asks for a perceptible difference rather than a
# legible one.
STATE_STEP_FLOOR = 1.02

# Text roles measured against both neutral planes. `--color-foreground` is the
# body role; the two dimmer roles carry every timestamp, byte count, and muted
# sidebar row in the product, which is why they get the same treatment as body
# rather than being written off as decoration.
TEXT_ROLES: tuple[tuple[str, float], ...] = (
    ("--color-foreground", BODY_FLOOR),
    ("--color-foreground-secondary", SECONDARY_FLOOR),
    ("--color-muted-foreground", SECONDARY_FLOOR),
    ("--color-foreground-tertiary", FAINT_FLOOR),
    ("--color-faint", FAINT_FLOOR),
    # A link sits at prose weight, not decoration, so it is held to the same
    # floor as the other secondary-weight roles rather than left unmeasured —
    # this is the exact token a "link legibility" change should have been
    # gating against and previously was not.
    ("--color-link-foreground", SECONDARY_FLOOR),
)
# Every plane the product actually paints text on, not just the two the
# page starts from. In light mode `surface`, `background`, `card`, `popover`,
# `surface-elevated` and `surface-control` are all near-white, so measuring only
# the first two left the three darkest light planes — the sidebar, the
# under-surface, and the one-step-off-white fills — entirely unmeasured. That is
# where the faint tier was failing while this check reported green. Transient
# state fills (hover/selected/active) are deliberately NOT here: they are
# overlays with their own step floors below, and holding the faint tier to 4.5:1
# on top of `active` would collapse faint into secondary and flatten the ramp.
TEXT_PLANES: tuple[str, ...] = (
    "--color-surface",
    "--color-background",
    "--color-card",
    "--color-popover",
    "--color-surface-elevated",
    "--color-surface-elevated-secondary",
    "--color-surface-control",
    "--color-surface-editor",
    "--color-surface-under",
    "--color-muted",
    "--color-sidebar",
    # The composer is a fully opaque plane the product paints text on, so it is
    # measured like every other elevation role rather than assumed to inherit
    # the page's numbers.
    "--color-composer-background",
)

# Each border role is measured against the plane it actually divides. The
# lightest edge is additionally proven on the rail, recessed plane, and
# translucent control fill because the light system promises one border rung
# that composes on every parent rather than per-surface gray forks.
BORDER_PAIRS: tuple[tuple[str, str], ...] = (
    ("--color-border", "--color-surface"),
    ("--color-border", "--color-background"),
    ("--color-border-light", "--color-surface"),
    ("--color-border-light", "--color-sidebar"),
    ("--color-border-light", "--color-surface-under"),
    ("--color-border-light", "--color-surface-control"),
    ("--color-border-heavy", "--color-surface"),
    ("--color-input", "--color-surface"),
)

# Sidebar is its own plane, so its ink is measured against its own fill rather
# than against the chat surface.
SIDEBAR_PAIRS: tuple[tuple[str, str, float], ...] = (
    ("--color-sidebar-foreground", "--color-sidebar", BODY_FLOOR),
    ("--color-sidebar-muted-foreground", "--color-sidebar", SECONDARY_FLOOR),
)

# Some sidebar ink sits inside a translucent control painted on the rail. That
# nested stack must be composed in order; measuring either role against the rail
# alone misses the file-tree search and badge treatment.
STACKED_TEXT_PAIRS: tuple[tuple[str, str, str, float], ...] = (
    (
        "--color-sidebar-muted-foreground",
        "--color-surface-control",
        "--color-sidebar",
        SECONDARY_FLOOR,
    ),
)

STATE_ROLES = ("--color-hover", "--color-selected", "--color-active")
STATE_PLANE = "--color-surface"

# The measured ratio each grandfathered pair carried when it was accepted, keyed
# by the same (path, site) pair the exception ledger uses.
#
# The prose lives in `lints/product/exceptions.toml`, which is where a reviewer
# reads why a deviation exists. The NUMBER stays here because an `[[exception]]`
# entry has no field for it, and the number is what makes the entry a ratchet
# rather than a waiver: the pair may improve freely, but any regression below the
# pin fails, and an entry that starts CLEARING its floor fails too (PROD-THEME-6)
# so it gets deleted instead of quietly outliving its reason. A ledger entry with
# no ratio here, or a ratio with no ledger entry, is itself an error
# (PROD-THEME-5) — the two halves may not drift apart.
DECLARED_DEVIATION_RATIOS: dict[tuple[str, str], float] = {
    (THEME_CSS_RECORD_PATH, "[dark] --color-border-light against --color-surface"): 1.14,
    (THEME_CSS_RECORD_PATH, "[dark] --color-border-light against --color-sidebar"): 1.156,
    (
        THEME_CSS_RECORD_PATH,
        "[dark] --color-border-light against --color-surface-under",
    ): 1.127,
    (
        THEME_CSS_RECORD_PATH,
        "[dark] --color-border-light against --color-surface-control",
    ): 1.164,
    (
        THEME_CSS_RECORD_PATH,
        "[dark] --color-selected carries at least as much ink as --color-hover",
    ): 1.08,
}

DEVIATION_RULE_IDS = (BORDER_RULE, STATE_RULE)


def load_declared_deviations() -> tuple[
    dict[tuple[str, str], tuple[float, str]], list[tuple[str, str]], list[tuple[str, str]]
]:
    """Join the exception ledger to the pinned ratios.

    Returns the pinned deviations keyed by `(path, site)`, the ledgered sites
    with no pinned ratio, and the pinned ratios with no ledger entry. Both
    mismatches are PROD-THEME-5 failures rather than silent no-ops: half a
    deviation is a waiver.
    """
    reasons = {
        (entry.path, entry.site): entry.reason
        for entry in RULES.exceptions
        if entry.rule in DEVIATION_RULE_IDS
    }
    ledgered: set[tuple[str, str]] = set()
    for rule_id in DEVIATION_RULE_IDS:
        ledgered |= RULES.exception_sites(rule_id)

    deviations: dict[tuple[str, str], tuple[float, str]] = {}
    unpinned: list[tuple[str, str]] = []
    for key in sorted(ledgered):
        ratio = DECLARED_DEVIATION_RATIOS.get(key)
        if ratio is None:
            unpinned.append(key)
            continue
        deviations[key] = (ratio, reasons.get(key, ""))
    unledgered = sorted(set(DECLARED_DEVIATION_RATIOS) - ledgered)
    return deviations, unpinned, unledgered


DECLARED_DEVIATIONS, UNPINNED_DEVIATIONS, UNLEDGERED_RATIOS = load_declared_deviations()


# ---------------------------------------------------------------- color model


@dataclass(frozen=True)
class Rgb:
    r: float
    g: float
    b: float

    def hex(self) -> str:
        channels = (round(max(0.0, min(255.0, channel))) for channel in (self.r, self.g, self.b))
        return "#" + "".join(f"{channel:02x}" for channel in channels)


class Unresolvable(Exception):
    """A token value this checker cannot reduce to an opaque sRGB color."""


NAMED_COLORS = {
    "black": Rgb(0, 0, 0),
    "white": Rgb(255, 255, 255),
}


def parse_color(value: str) -> tuple[Rgb, float]:
    """Parse a literal color into (rgb, alpha). Alpha 1.0 when opaque."""
    text = value.strip()
    lowered = text.lower()
    if lowered in NAMED_COLORS:
        return NAMED_COLORS[lowered], 1.0
    if lowered == "transparent":
        return Rgb(0, 0, 0), 0.0

    if text.startswith("#"):
        digits = text[1:]
        if len(digits) == 3:
            digits = "".join(ch * 2 for ch in digits)
        if len(digits) == 6:
            return (
                Rgb(int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)),
                1.0,
            )
        if len(digits) == 8:
            return (
                Rgb(int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)),
                int(digits[6:8], 16) / 255,
            )
        raise Unresolvable(f"unsupported hex color {text!r}")

    match = re.fullmatch(r"rgba?\(([^)]*)\)", text, re.IGNORECASE)
    if match:
        parts = [part for part in re.split(r"[,/\s]+", match.group(1).strip()) if part]
        if len(parts) not in (3, 4):
            raise Unresolvable(f"unsupported rgb() color {text!r}")
        channels = [_channel(part) for part in parts[:3]]
        alpha = _alpha(parts[3]) if len(parts) == 4 else 1.0
        return Rgb(*channels), alpha

    match = re.fullmatch(r"hsla?\(([^)]*)\)", text, re.IGNORECASE)
    if match:
        parts = [part for part in re.split(r"[,/\s]+", match.group(1).strip()) if part]
        if len(parts) not in (3, 4):
            raise Unresolvable(f"unsupported hsl() color {text!r}")
        hue = float(parts[0].removesuffix("deg")) % 360
        saturation = float(parts[1].rstrip("%")) / 100
        lightness = float(parts[2].rstrip("%")) / 100
        alpha = _alpha(parts[3]) if len(parts) == 4 else 1.0
        return _hsl_to_rgb(hue, saturation, lightness), alpha

    raise Unresolvable(f"not a color literal: {text!r}")


def _channel(part: str) -> float:
    if part.endswith("%"):
        return float(part[:-1]) * 255 / 100
    return float(part)


def _alpha(part: str) -> float:
    if part.endswith("%"):
        return float(part[:-1]) / 100
    return float(part)


def _hsl_to_rgb(hue: float, saturation: float, lightness: float) -> Rgb:
    chroma = (1 - abs(2 * lightness - 1)) * saturation
    sector = hue / 60
    second = chroma * (1 - abs(sector % 2 - 1))
    table = [
        (chroma, second, 0.0),
        (second, chroma, 0.0),
        (0.0, chroma, second),
        (0.0, second, chroma),
        (second, 0.0, chroma),
        (chroma, 0.0, second),
    ]
    red, green, blue = table[min(int(sector), 5)]
    offset = lightness - chroma / 2
    return Rgb((red + offset) * 255, (green + offset) * 255, (blue + offset) * 255)


def composite(top: Rgb, alpha: float, backdrop: Rgb) -> Rgb:
    """Source-over compositing, the operation an alpha neutral actually needs."""
    return Rgb(
        top.r * alpha + backdrop.r * (1 - alpha),
        top.g * alpha + backdrop.g * (1 - alpha),
        top.b * alpha + backdrop.b * (1 - alpha),
    )


def relative_luminance(color: Rgb) -> float:
    def linear(channel: float) -> float:
        srgb = channel / 255
        return srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4

    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)


def contrast(a: Rgb, b: Rgb) -> float:
    first = relative_luminance(a)
    second = relative_luminance(b)
    lighter, darker = max(first, second), min(first, second)
    return (lighter + 0.05) / (darker + 0.05)


# ------------------------------------------------------------- CSS extraction


def split_top_level(text: str, separator: str) -> list[str]:
    """Split on `separator` at paren depth zero (color-mix arguments nest)."""
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == separator and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
    parts.append("".join(current))
    return parts


def read_block(css: str, selector: str) -> dict[str, str]:
    """Return the declarations of the single top-level block for `selector`.

    Anchored at column zero: the generated stylesheet also carries an INDENTED
    `:root` inside `@media (prefers-reduced-motion: reduce)`, which is a motion
    override rather than a color plane and must not be mistaken for the runtime
    root here.
    """
    pattern = re.compile(
        r"^" + re.escape(selector) + r"\s*\{(?P<body>[^{}]*)\}",
        re.MULTILINE,
    )
    matches = list(pattern.finditer(css))
    if len(matches) != 1:
        raise SystemExit(
            f"check_theme_contrast: expected exactly one {selector} block in "
            f"{THEME_CSS.relative_to(REPO_ROOT)}, found {len(matches)}"
        )
    declarations: dict[str, str] = {}
    for line in matches[0].group("body").split(";"):
        if ":" not in line:
            continue
        name, _, value = line.partition(":")
        name = name.strip()
        if name.startswith("--"):
            declarations[name] = value.strip()
    return declarations


# ------------------------------------------------------------- var/color-mix


class Resolver:
    """Resolves a token name to an opaque sRGB color within one mode.

    Handles the three forms the generated stylesheet can hold: a literal, a
    `var()` alias to another role (including a comma fallback), and
    `color-mix()`. A mix against `transparent` yields a translucent result, so
    the caller must supply the backdrop it is painted on — which is exactly the
    reason the token layer should not hold alpha neutrals at all.
    """

    def __init__(self, declarations: dict[str, str], mode: str) -> None:
        self.declarations = declarations
        self.mode = mode

    def resolve(self, name: str, backdrop: Rgb | None = None) -> Rgb:
        color, alpha = self.resolve_with_alpha(name)
        if alpha >= 0.999:
            return color
        if backdrop is None:
            raise Unresolvable(
                f"{name} is translucent (alpha {alpha:.3f}) and has no known backdrop"
            )
        return composite(color, alpha, backdrop)

    def resolve_with_alpha(
        self, name: str, seen: frozenset[str] = frozenset()
    ) -> tuple[Rgb, float]:
        if name in seen:
            raise Unresolvable(f"cyclic token reference at {name}")
        if name not in self.declarations:
            raise Unresolvable(f"{name} is not declared in the {self.mode} block")
        return self._value(self.declarations[name], seen | {name})

    def _value(self, value: str, seen: frozenset[str]) -> tuple[Rgb, float]:
        text = value.strip()
        var_match = re.fullmatch(r"var\((?P<args>.*)\)", text, re.DOTALL)
        if var_match:
            args = split_top_level(var_match.group("args"), ",")
            target = args[0].strip()
            try:
                return self.resolve_with_alpha(target, seen)
            except Unresolvable:
                if len(args) > 1:
                    return self._value(",".join(args[1:]), seen)
                raise
        mix_match = re.fullmatch(r"color-mix\((?P<args>.*)\)", text, re.DOTALL)
        if mix_match:
            return self._mix(mix_match.group("args"), seen)
        return parse_color(text)

    def _mix(self, args: str, seen: frozenset[str]) -> tuple[Rgb, float]:
        parts = [part.strip() for part in split_top_level(args, ",")]
        if len(parts) != 3 or not parts[0].lower().startswith("in "):
            raise Unresolvable(f"unsupported color-mix() arguments: {args!r}")
        first, first_weight = self._mix_operand(parts[1], seen)
        second, second_weight = self._mix_operand(parts[2], seen)
        if first_weight is None and second_weight is None:
            first_weight = second_weight = 0.5
        elif first_weight is None:
            first_weight = 1 - (second_weight or 0.0)
        elif second_weight is None:
            second_weight = 1 - first_weight
        total = (first_weight or 0.0) + (second_weight or 0.0)
        if total <= 0:
            raise Unresolvable(f"color-mix() weights sum to zero: {args!r}")
        first_weight = (first_weight or 0.0) / total
        second_weight = (second_weight or 0.0) / total

        # Premultiplied interpolation, which is what CSS specifies. Mixing in
        # oklab/lab rather than srgb shifts the result slightly; sRGB is used
        # here because the floors are sRGB-luminance floors and the difference
        # is far below the margin any floor is set at.
        (color_a, alpha_a) = first
        (color_b, alpha_b) = second
        alpha = alpha_a * first_weight + alpha_b * second_weight
        if alpha <= 0:
            return Rgb(0, 0, 0), 0.0
        mixed = Rgb(
            (color_a.r * alpha_a * first_weight + color_b.r * alpha_b * second_weight) / alpha,
            (color_a.g * alpha_a * first_weight + color_b.g * alpha_b * second_weight) / alpha,
            (color_a.b * alpha_a * first_weight + color_b.b * alpha_b * second_weight) / alpha,
        )
        return mixed, alpha

    def _mix_operand(
        self, operand: str, seen: frozenset[str]
    ) -> tuple[tuple[Rgb, float], float | None]:
        percent_match = re.search(r"\s(-?[\d.]+)%$", operand)
        weight: float | None = None
        color_text = operand
        if percent_match:
            weight = float(percent_match.group(1)) / 100
            color_text = operand[: percent_match.start()].strip()
        return self._value(color_text, seen), weight


# ------------------------------------------------------------------ the check


def deviation_site(mode: str, label: str) -> str:
    """The exception-ledger `site` for one measured pair in one mode."""
    return f"[{mode}] {label}"


@dataclass
class Measurement:
    mode: str
    label: str
    ratio: float
    floor: float
    detail: str
    rule_id: str = TEXT_RULE

    @property
    def site(self) -> str:
        return deviation_site(self.mode, self.label)

    @property
    def key(self) -> tuple[str, str]:
        return (THEME_CSS_RECORD_PATH, self.site)

    @property
    def pin(self) -> tuple[float, str] | None:
        return DECLARED_DEVIATIONS.get(self.key)

    def diagnostic(self) -> str:
        """The record-generated diagnostic: rule, alternative, record path."""
        return lint_records.render_diagnostic(
            RULES.rule(self.rule_id),
            f"{THEME_CSS_RECORD_PATH} [{self.mode}]",
            f"{self.label} measures {self.ratio:.2f}:1 against a "
            f"{self.floor:.2f}:1 floor ({self.detail})",
        )

    @property
    def ok(self) -> bool:
        if self.ratio >= self.floor:
            return True
        pin = self.pin
        # Tolerate float noise in the pinned literal, but nothing more.
        return pin is not None and self.ratio >= pin[0] - 0.005

    @property
    def stale_pin(self) -> bool:
        """A pinned pair that now clears its floor: delete the pin, not the row."""
        return self.pin is not None and self.ratio >= self.floor

    def row(self) -> str:
        if self.ratio >= self.floor:
            mark = "stale" if self.stale_pin else "ok"
        elif self.ok:
            mark = "pin"
        else:
            mark = "FAIL"
        return (
            f"  {mark:<5} {self.label:<52} {self.ratio:>6.2f}:1  "
            f"(>= {self.floor:.2f})  {self.detail}"
        )


def measure_mode(mode: str, declarations: dict[str, str]) -> tuple[list[Measurement], list[str]]:
    resolver = Resolver(declarations, mode)
    measurements: list[Measurement] = []
    errors: list[str] = []

    def resolved(name: str, backdrop: Rgb | None = None) -> Rgb | None:
        try:
            return resolver.resolve(name, backdrop)
        except Unresolvable as failure:
            errors.append(f"{mode}: {failure}")
            return None

    # An elevation plane can itself be translucent (dark still holds a couple of
    # alpha fills), and what a person sees is that fill composited over the page.
    # `--color-background` is the bottom of every stack, so it is resolved first
    # and used as the backdrop for the planes above it.
    page = resolved("--color-background")

    planes: dict[str, Rgb] = {}
    for plane in (*TEXT_PLANES, "--color-sidebar"):
        color = resolved(plane, page)
        if color is None:
            continue
        planes[plane] = color

    for role, floor in TEXT_ROLES:
        for plane in TEXT_PLANES:
            backdrop = planes.get(plane)
            if backdrop is None:
                continue
            ink = resolved(role, backdrop)
            if ink is None:
                continue
            measurements.append(
                Measurement(
                    mode,
                    f"{role} on {plane}",
                    contrast(ink, backdrop),
                    floor,
                    f"{ink.hex()} on {backdrop.hex()}",
                    TEXT_RULE,
                )
            )

    for role, plane, floor in SIDEBAR_PAIRS:
        backdrop = planes.get(plane)
        if backdrop is None:
            continue
        ink = resolved(role, backdrop)
        if ink is None:
            continue
        measurements.append(
            Measurement(
                mode,
                f"{role} on {plane}",
                contrast(ink, backdrop),
                floor,
                f"{ink.hex()} on {backdrop.hex()}",
                SIDEBAR_RULE,
            )
        )

    for role, overlay, base_plane, floor in STACKED_TEXT_PAIRS:
        base = planes.get(base_plane)
        if base is None:
            continue
        nested_plane = resolved(overlay, base)
        if nested_plane is None:
            continue
        ink = resolved(role, nested_plane)
        if ink is None:
            continue
        measurements.append(
            Measurement(
                mode,
                f"{role} on {overlay} over {base_plane}",
                contrast(ink, nested_plane),
                floor,
                f"{ink.hex()} on {nested_plane.hex()}",
                SIDEBAR_RULE,
            )
        )

    for role, plane in BORDER_PAIRS:
        # Reuse the page-composited plane so translucent fills such as
        # `--color-surface-control` are measured as people actually see them.
        backdrop = planes.get(plane)
        if backdrop is None:
            continue
        stroke = resolved(role, backdrop)
        if stroke is None:
            continue
        measurements.append(
            Measurement(
                mode,
                f"{role} against {plane}",
                contrast(stroke, backdrop),
                BORDER_FLOOR,
                f"{stroke.hex()} on {backdrop.hex()}",
                BORDER_RULE,
            )
        )

    state_plane = planes.get(STATE_PLANE)
    if state_plane is not None:
        fills: dict[str, Rgb] = {}
        for role in STATE_ROLES:
            fill = resolved(role, state_plane)
            if fill is not None:
                fills[role] = fill
        pairs = [
            ("--color-hover", "--color-selected"),
            ("--color-selected", "--color-active"),
            ("--color-hover", "--color-active"),
        ]
        for first, second in pairs:
            if first not in fills or second not in fills:
                continue
            measurements.append(
                Measurement(
                    mode,
                    f"{first} vs {second}",
                    contrast(fills[first], fills[second]),
                    STATE_STEP_FLOOR,
                    f"{fills[first].hex()} vs {fills[second].hex()}",
                    STATE_RULE,
                )
            )
        for role in STATE_ROLES:
            if role not in fills:
                continue
            measurements.append(
                Measurement(
                    mode,
                    f"{role} against {STATE_PLANE}",
                    contrast(fills[role], state_plane),
                    STATE_STEP_FLOOR,
                    f"{fills[role].hex()} on {state_plane.hex()}",
                    STATE_RULE,
                )
            )

        # Ink direction, not just difference: a persistent selection that
        # carries LESS ink than a transient hover reads as the weaker state,
        # which is how additive alphas invert when a dark scale is flipped.
        if "--color-hover" in fills and "--color-selected" in fills:
            hover_step = contrast(fills["--color-hover"], state_plane)
            selected_step = contrast(fills["--color-selected"], state_plane)
            measurements.append(
                Measurement(
                    mode,
                    "--color-selected carries at least as much ink as --color-hover",
                    selected_step,
                    hover_step,
                    f"selected {fills['--color-selected'].hex()} vs "
                    f"hover {fills['--color-hover'].hex()} off {state_plane.hex()}",
                    STATE_RULE,
                )
            )

    return measurements, errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--table",
        action="store_true",
        help="print every measured pair for both modes, not only the failures",
    )
    args = parser.parse_args(argv)

    if not THEME_CSS.exists():
        print(
            "check_theme_contrast: "
            f"{THEME_CSS.relative_to(REPO_ROOT)} is missing — run "
            "`pnpm --filter @proliferate/design build` first."
        )
        return 1

    css = THEME_CSS.read_text()
    modes = (
        ("dark", read_block(css, DARK_SELECTOR)),
        ("light", read_block(css, LIGHT_SELECTOR)),
    )

    failures: list[Measurement] = []
    pinned: list[Measurement] = []
    stale: list[Measurement] = []
    unresolved: list[str] = []
    diagnostics: list[str] = []
    seen_sites: set[tuple[str, str]] = set()
    for mode, declarations in modes:
        measurements, mode_errors = measure_mode(mode, declarations)
        unresolved.extend(mode_errors)
        for measurement in measurements:
            seen_sites.add(measurement.key)
            if not measurement.ok:
                failures.append(measurement)
            elif measurement.stale_pin:
                stale.append(measurement)
            elif measurement.pin is not None:
                pinned.append(measurement)
        if args.table:
            print(f"{mode}:")
            for measurement in measurements:
                print(measurement.row())

    # A ledger entry for a pair that is no longer measured is dead weight in a
    # design contract, so it fails rather than silently enforcing nothing — and so
    # does half a deviation, whichever half is missing.
    for path, site in sorted(key for key in DECLARED_DEVIATIONS if key not in seen_sites):
        diagnostics.append(
            lint_records.render_diagnostic(
                RULES.rule(ORPHAN_PIN_RULE),
                "lints/product/exceptions.toml",
                f"{site} is grandfathered for {path} but is no longer measured",
            )
        )
    for path, site in UNPINNED_DEVIATIONS:
        diagnostics.append(
            lint_records.render_diagnostic(
                RULES.rule(ORPHAN_PIN_RULE),
                "lints/product/exceptions.toml",
                f"{site} is grandfathered for {path} with no pinned ratio in "
                f"DECLARED_DEVIATION_RATIOS",
            )
        )
    for path, site in UNLEDGERED_RATIOS:
        diagnostics.append(
            lint_records.render_diagnostic(
                RULES.rule(ORPHAN_PIN_RULE),
                CHECKER,
                f"DECLARED_DEVIATION_RATIOS pins {site} for {path} with no "
                f"[[exception]] entry in lints/product/exceptions.toml",
            )
        )
    for measurement in stale:
        diagnostics.append(
            lint_records.render_diagnostic(
                RULES.rule(STALE_PIN_RULE),
                "lints/product/exceptions.toml",
                f"{measurement.site} now measures {measurement.ratio:.2f}:1 and "
                f"clears its {measurement.floor:.2f}:1 floor",
            )
        )

    if pinned:
        print("\nDeclared deviations (pinned, cannot regress):")
        for measurement in pinned:
            _, reason = measurement.pin or (0.0, "")
            print(
                f"  [{measurement.mode}] {measurement.label}: {measurement.ratio:.2f}:1 "
                f"vs a {measurement.floor:.2f}:1 floor — {reason}"
            )

    if not failures and not diagnostics and not unresolved:
        print(
            f"\nTheme contrast check passed (dark + light)"
            f"{f', {len(pinned)} declared deviation(s)' if pinned else ''}."
        )
        return 0

    print("\nTheme contrast floors are not met:")
    for measurement in failures:
        print(measurement.diagnostic())
        print()
    for diagnostic in diagnostics:
        print(diagnostic)
        print()
    # Not a rule violation: a token the resolver cannot reduce to an opaque sRGB
    # color cannot be graded at all, so this is the checker reporting that it
    # could not run rather than that a floor was missed.
    for error in unresolved:
        print(f"  [unmeasurable] {error}")
    print(
        "\nEach role is authored per mode in apps/packages/design/src/tokens.ts. "
        "Raise the token's contrast — the floors are the contract, not the knob."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
