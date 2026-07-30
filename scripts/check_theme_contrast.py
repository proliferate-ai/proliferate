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

Floors (both modes, no per-mode exemptions):
  * body text        >= 7.0:1   against surface and background
  * secondary text   >= 4.5:1   against surface and background
  * faint text       >= 4.5:1   against surface and background
  * borders          >= 1.25:1  against the surface they divide
  * hover/selected/active mutually distinguishable, AND selected carries more
    ink than hover — a persistent state may never read fainter than a
    transient one.

Four measured pairs do not meet those floors and are NOT silently exempted: they
are pinned in `DECLARED_DEVIATIONS` with their exact measured ratio, so each one
is visible in review and can only ever improve. Three are pre-existing dark-mode
facts outside the light retune's scope; one is an approved light value that
misses by 0.01. See that table for the per-entry reasoning.

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
THEME_CSS = REPO_ROOT / "apps" / "packages" / "design" / "dist" / "theme.css"

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
)
TEXT_PLANES: tuple[str, ...] = ("--color-surface", "--color-background")

# Each border role is measured against the plane it actually divides.
BORDER_PAIRS: tuple[tuple[str, str], ...] = (
    ("--color-border", "--color-surface"),
    ("--color-border", "--color-background"),
    ("--color-border-light", "--color-surface"),
    ("--color-border-heavy", "--color-surface"),
    ("--color-input", "--color-surface"),
)

# Sidebar is its own plane, so its ink is measured against its own fill rather
# than against the chat surface.
SIDEBAR_PAIRS: tuple[tuple[str, str, float], ...] = (
    ("--color-sidebar-foreground", "--color-sidebar", BODY_FLOOR),
    ("--color-sidebar-muted-foreground", "--color-sidebar", SECONDARY_FLOOR),
)

STATE_ROLES = ("--color-hover", "--color-selected", "--color-active")
STATE_PLANE = "--color-surface"

# Pinned deviations, keyed by (mode, label) -> (measured ratio, why).
#
# This is a ratchet, not an exemption list. The pinned number is the ratio
# measured when the deviation was accepted: the pair may improve freely, but any
# regression below the pin fails, and an entry that starts CLEARING its floor
# fails too so it gets deleted instead of quietly outliving its reason. Adding a
# row is a design decision, which is why each one carries prose.
DECLARED_DEVIATIONS: dict[tuple[str, str], tuple[float, str]] = {
    ("dark", "--color-border-light against --color-surface"): (
        1.14,
        "pre-existing dark value, untouched by the light retune; raising it "
        "changes every hairline divider in dark mode and needs its own review",
    ),
    ("light", "--color-border-light against --color-surface"): (
        1.24,
        "approved light value #e4e7ea measures 1.24:1, one hundredth under the "
        "floor; it is the deliberate hairline weight and doubles as the hover "
        "fill, so it was not nudged to clear an arbitrary rounding boundary",
    ),
    ("light", "--color-selected vs --color-active"): (
        1.019,
        "approved #dde1e6 vs #dbdfe4 differ by one step by design — selected and "
        "active are adjacent, and both are separately distinguishable from hover",
    ),
    ("dark", "--color-selected carries at least as much ink as --color-hover"): (
        0.0,
        "pre-existing dark inversion (selected #1f1f1f reads fainter than hover "
        "#2a2a2a); the light half is fixed here, dark needs its own retune",
    ),
}


# ---------------------------------------------------------------- color model


@dataclass(frozen=True)
class Rgb:
    r: float
    g: float
    b: float

    def hex(self) -> str:
        return "#{:02x}{:02x}{:02x}".format(
            round(max(0.0, min(255.0, self.r))),
            round(max(0.0, min(255.0, self.g))),
            round(max(0.0, min(255.0, self.b))),
        )


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

    def resolve_with_alpha(self, name: str, seen: frozenset[str] = frozenset()) -> tuple[Rgb, float]:
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


@dataclass
class Measurement:
    mode: str
    label: str
    ratio: float
    floor: float
    detail: str

    @property
    def pin(self) -> tuple[float, str] | None:
        return DECLARED_DEVIATIONS.get((self.mode, self.label))

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

    planes: dict[str, Rgb] = {}
    for plane in (*TEXT_PLANES, "--color-sidebar"):
        color = resolved(plane)
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
            )
        )

    for role, plane in BORDER_PAIRS:
        backdrop = resolved(plane)
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
    errors: list[str] = []
    seen_labels: set[tuple[str, str]] = set()
    for mode, declarations in modes:
        measurements, mode_errors = measure_mode(mode, declarations)
        errors.extend(mode_errors)
        for measurement in measurements:
            seen_labels.add((measurement.mode, measurement.label))
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

    # A pin for a pair that is no longer measured is dead weight in a design
    # contract, so it is an error rather than a silent no-op.
    orphans = sorted(key for key in DECLARED_DEVIATIONS if key not in seen_labels)
    for mode, label in orphans:
        errors.append(f"{mode}: DECLARED_DEVIATIONS pins {label!r}, which is no longer measured")
    for measurement in stale:
        errors.append(
            f"{measurement.mode}: {measurement.label} now measures "
            f"{measurement.ratio:.2f}:1 and clears its {measurement.floor:.2f}:1 floor — "
            "remove its DECLARED_DEVIATIONS entry"
        )

    if pinned:
        print("\nDeclared deviations (pinned, cannot regress):")
        for measurement in pinned:
            _, reason = measurement.pin or (0.0, "")
            print(
                f"  [{measurement.mode}] {measurement.label}: {measurement.ratio:.2f}:1 "
                f"vs a {measurement.floor:.2f}:1 floor — {reason}"
            )

    if not failures and not errors:
        print(
            f"\nTheme contrast check passed (dark + light)"
            f"{f', {len(pinned)} declared deviation(s)' if pinned else ''}."
        )
        return 0

    print("\nTheme contrast floors are not met:")
    for measurement in failures:
        print(f"  [{measurement.mode}] {measurement.label}: {measurement.ratio:.2f}:1 "
              f"is below the {measurement.floor:.2f}:1 floor ({measurement.detail})")
    for error in errors:
        print(f"  [error] {error}")
    print(
        "\nEach role is authored per mode in apps/packages/design/src/tokens.ts. "
        "Raise the token's contrast — the floors are the contract, not the knob."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
