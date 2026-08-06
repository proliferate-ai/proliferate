#!/usr/bin/env python3

"""The risk in a contrast guard is not the WCAG formula, it is the resolver:
the values it grades arrive as `var()` chains and `color-mix()` against
`transparent`, and a resolver that quietly mis-composites an alpha neutral will
report a comfortable number for text nobody can read. So the arithmetic is
pinned against known-good references, and the ratchet's refusal to let a pinned
deviation drift is tested as carefully as the floors themselves."""

from __future__ import annotations

import unittest
import unittest.mock

from scripts.check_theme_contrast import (
    BORDER_PAIRS,
    STACKED_TEXT_PAIRS,
    TEXT_PLANES,
    Measurement,
    Resolver,
    Rgb,
    Unresolvable,
    composite,
    contrast,
    parse_color,
    read_block,
)


class ColorMath(unittest.TestCase):
    def test_extremes(self) -> None:
        # The two ends of the WCAG scale, which any implementation must hit exactly.
        self.assertAlmostEqual(contrast(Rgb(0, 0, 0), Rgb(255, 255, 255)), 21.0, places=4)
        self.assertAlmostEqual(contrast(Rgb(255, 255, 255), Rgb(255, 255, 255)), 1.0, places=4)

    def test_symmetry(self) -> None:
        first, second = Rgb(0x16, 0x18, 0x1B), Rgb(0xFF, 0xFF, 0xFF)
        self.assertAlmostEqual(contrast(first, second), contrast(second, first), places=9)

    def test_known_ratio(self) -> None:
        # #767676 on white is the canonical "just passes 4.5:1" grey.
        self.assertAlmostEqual(
            contrast(Rgb(0x76, 0x76, 0x76), Rgb(255, 255, 255)), 4.54, places=2
        )

    def test_hex_forms(self) -> None:
        self.assertEqual(parse_color("#fff")[0].hex(), "#ffffff")
        self.assertEqual(parse_color("#16181b")[0].hex(), "#16181b")
        self.assertAlmostEqual(parse_color("#00000080")[1], 128 / 255, places=4)

    def test_rgba_alpha(self) -> None:
        color, alpha = parse_color("rgba(22,24,27,0.16)")
        self.assertEqual(color.hex(), "#16181b")
        self.assertAlmostEqual(alpha, 0.16, places=6)

    def test_slash_alpha_syntax(self) -> None:
        color, alpha = parse_color("rgb(16 24 40 / 0.08)")
        self.assertEqual(color.hex(), "#101828")
        self.assertAlmostEqual(alpha, 0.08, places=6)

    def test_transparent_is_zero_alpha(self) -> None:
        self.assertEqual(parse_color("transparent")[1], 0.0)

    def test_composite_midpoint(self) -> None:
        self.assertEqual(composite(Rgb(0, 0, 0), 0.5, Rgb(255, 255, 255)).hex(), "#808080")

    def test_rejects_non_color(self) -> None:
        with self.assertRaises(Unresolvable):
            parse_color("0 1px 2px rgb(16 24 40 / 0.06)")


class ResolverBehaviour(unittest.TestCase):
    def resolver(self, **declarations: str) -> Resolver:
        return Resolver(dict(declarations), "test")

    def test_literal(self) -> None:
        resolver = self.resolver(**{"--a": "#ffffff"})
        self.assertEqual(resolver.resolve("--a").hex(), "#ffffff")

    def test_var_alias_chain(self) -> None:
        resolver = self.resolver(**{"--a": "var(--b)", "--b": "var(--c)", "--c": "#16181b"})
        self.assertEqual(resolver.resolve("--a").hex(), "#16181b")

    def test_var_comma_fallback_when_target_missing(self) -> None:
        resolver = self.resolver(**{"--a": "var(--absent, #d5d9de)"})
        self.assertEqual(resolver.resolve("--a").hex(), "#d5d9de")

    def test_cycle_is_reported_not_hung(self) -> None:
        resolver = self.resolver(**{"--a": "var(--b)", "--b": "var(--a)"})
        with self.assertRaises(Unresolvable):
            resolver.resolve("--a")

    def test_alpha_mix_needs_a_backdrop(self) -> None:
        # This is the whole light-mode bug in one assertion: an alpha neutral has
        # no color until you say what it sits on.
        resolver = self.resolver(
            **{"--ink": "#ffffff", "--a": "color-mix(in oklab, var(--ink) 8.4%, transparent)"}
        )
        with self.assertRaises(Unresolvable):
            resolver.resolve("--a")

    def test_alpha_mix_over_white_collapses(self) -> None:
        resolver = self.resolver(
            **{"--ink": "#ffffff", "--a": "color-mix(in oklab, var(--ink) 8.4%, transparent)"}
        )
        # White ink at 8.4% over white is invisible — the original defect.
        self.assertEqual(resolver.resolve("--a", Rgb(255, 255, 255)).hex(), "#ffffff")

    def test_opaque_mix_of_two_colors(self) -> None:
        resolver = self.resolver(**{"--a": "color-mix(in srgb, #000000 50%, #ffffff)"})
        self.assertEqual(resolver.resolve("--a").hex(), "#808080")

    def test_mix_without_percentage_is_even(self) -> None:
        resolver = self.resolver(**{"--a": "color-mix(in srgb, #000000, #ffffff)"})
        self.assertEqual(resolver.resolve("--a").hex(), "#808080")

    def test_undeclared_token(self) -> None:
        with self.assertRaises(Unresolvable):
            self.resolver().resolve("--nope")


class BlockExtraction(unittest.TestCase):
    CSS = """@theme {
  --color-background: #181818;
}

:root {
  --color-background: #181818;
  --color-foreground: #ffffff;
}

:root[data-mode="light"] {
  --color-background: #ffffff;
  --color-foreground: #16181b;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-hover: 0ms;
  }
}
"""

    def test_runtime_root_ignores_the_reduced_motion_root(self) -> None:
        # The indented `:root` inside the media query is a motion override, not a
        # color plane; matching it would make the guard ambiguous.
        block = read_block(self.CSS, ":root")
        self.assertEqual(block["--color-foreground"], "#ffffff")
        self.assertNotIn("--duration-hover", block)

    def test_light_root(self) -> None:
        block = read_block(self.CSS, ':root[data-mode="light"]')
        self.assertEqual(block["--color-foreground"], "#16181b")

    def test_missing_selector_is_fatal(self) -> None:
        with self.assertRaises(SystemExit):
            read_block(self.CSS, ":root[data-mode='nope']")


class Ratchet(unittest.TestCase):
    """`DECLARED_DEVIATIONS` is patched per-test so the suite states its own
    inputs instead of depending on whatever the live token set happens to be."""

    def measurement(self, ratio: float, floor: float = 1.25, label: str = "pair") -> Measurement:
        return Measurement("light", label, ratio, floor, "detail")

    def test_clearing_the_floor_needs_no_pin(self) -> None:
        self.assertTrue(self.measurement(1.42).ok)

    def test_below_floor_without_a_pin_fails(self) -> None:
        self.assertFalse(self.measurement(1.10).ok)

    def test_pin_admits_the_measured_value(self) -> None:
        with unittest.mock.patch.dict(
            "scripts.check_theme_contrast.DECLARED_DEVIATIONS",
            {("light", "pair"): (1.24, "approved")},
            clear=True,
        ):
            self.assertTrue(self.measurement(1.24).ok)

    def test_pin_refuses_a_regression(self) -> None:
        with unittest.mock.patch.dict(
            "scripts.check_theme_contrast.DECLARED_DEVIATIONS",
            {("light", "pair"): (1.24, "approved")},
            clear=True,
        ):
            self.assertFalse(self.measurement(1.20).ok)

    def test_pin_allows_improvement_below_the_floor(self) -> None:
        with unittest.mock.patch.dict(
            "scripts.check_theme_contrast.DECLARED_DEVIATIONS",
            {("light", "pair"): (1.20, "approved")},
            clear=True,
        ):
            measurement = self.measurement(1.23)
            self.assertTrue(measurement.ok)
            self.assertFalse(measurement.stale_pin)

    def test_pin_becomes_stale_once_the_floor_is_met(self) -> None:
        with unittest.mock.patch.dict(
            "scripts.check_theme_contrast.DECLARED_DEVIATIONS",
            {("light", "pair"): (1.24, "approved")},
            clear=True,
        ):
            self.assertTrue(self.measurement(1.30).stale_pin)


class PlaneCoverage(unittest.TestCase):
    """The original defect was not a bad ratio, it was an unmeasured plane.

    Light mode collapses six elevation roles onto white, so a guard that reads
    only `--color-surface` and `--color-background` reports green while the
    sidebar and the one-step-off-white fills go unchecked. These tests pin the
    plane list itself, so adding an elevation role without adding it here fails
    rather than silently widening the blind spot.
    """

    def test_every_text_plane_is_measured(self) -> None:
        # Every `--color-*` role in the authority that names a plane text is
        # painted on. Translucent planes are composited by the checker; transient
        # state fills are excluded deliberately — see the note on TEXT_PLANES.
        expected = {
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
        }
        self.assertEqual(set(TEXT_PLANES), expected)

    def test_state_fills_are_not_text_planes(self) -> None:
        # Holding the faint tier to 4.5:1 on top of `active` would force faint
        # to collapse into secondary and flatten the ramp; state fills get their
        # own step floors instead.
        for role in ("--color-hover", "--color-selected", "--color-active"):
            self.assertNotIn(role, TEXT_PLANES)

    def test_the_faint_tier_is_measured_after_alpha_composition(self) -> None:
        # Alpha ink has no final color until it is composited over the plane. The
        # rejected 55% proposal missed 4.5:1 on every light plane; 62% clears the
        # darkest nested control fill as well as white, rail, and editor.
        ink = Rgb(0x1A, 0x1C, 0x1F)
        white = Rgb(0xFF, 0xFF, 0xFF)
        rail = Rgb(0xF6, 0xF6, 0xF6)
        control = composite(ink, 0.049, white)
        rail_control = composite(ink, 0.049, rail)
        planes = (
            white,
            rail,
            Rgb(0xFA, 0xFA, 0xFA),
            control,
            rail_control,
        )
        for plane in planes:
            self.assertGreaterEqual(contrast(composite(ink, 0.62, plane), plane), 4.5)
            self.assertLess(contrast(composite(ink, 0.55, plane), plane), 4.5)

    def test_sidebar_muted_ink_clears_a_control_on_its_rail(self) -> None:
        self.assertIn(
            (
                "--color-sidebar-muted-foreground",
                "--color-surface-control",
                "--color-sidebar",
                4.5,
            ),
            STACKED_TEXT_PAIRS,
        )
        ink = Rgb(0x1A, 0x1C, 0x1F)
        rail = Rgb(0xF6, 0xF6, 0xF6)
        rail_control = composite(ink, 0.049, rail)
        self.assertGreaterEqual(contrast(composite(ink, 0.62, rail), rail), 4.5)
        self.assertGreaterEqual(
            contrast(composite(ink, 0.62, rail_control), rail_control), 4.5
        )
        self.assertLess(contrast(composite(ink, 0.61, rail_control), rail_control), 4.5)
        self.assertLess(contrast(composite(ink, 0.60, rail), rail), 4.5)

    def test_the_lightest_border_is_measured_on_every_light_parent(self) -> None:
        expected = {
            ("--color-border-light", "--color-surface"),
            ("--color-border-light", "--color-sidebar"),
            ("--color-border-light", "--color-surface-under"),
            ("--color-border-light", "--color-surface-control"),
        }
        self.assertTrue(expected.issubset(set(BORDER_PAIRS)))

        ink = Rgb(0x1A, 0x1C, 0x1F)
        white = Rgb(0xFF, 0xFF, 0xFF)
        rail = Rgb(0xF6, 0xF6, 0xF6)
        control = composite(ink, 0.049, white)
        rail_control = composite(ink, 0.049, rail)
        for plane in (white, rail, control, rail_control):
            self.assertGreaterEqual(contrast(composite(ink, 0.114, plane), plane), 1.25)
        self.assertLess(contrast(composite(ink, 0.113, rail_control), rail_control), 1.25)


if __name__ == "__main__":
    unittest.main()
