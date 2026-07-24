from pathlib import Path
import unittest

from scripts.check_appearance_scaling import (
    check_census_additions,
    check_design_css_source,
    check_design_token_source,
    check_source,
    imported_icon_names,
    raw_hex_scope_excluded,
)


class AppearanceScalingGuardTest(unittest.TestCase):
    def test_rejects_fixed_text_and_imported_icon_sizes(self) -> None:
        source = '''
import { Check as Done, X } from "lucide-react";
export function Example() {
  return <div style={{ fontSize: 12 }} className="text-[13px] text-3xl">
    <Done className="size-4" />
    <X size={16} />
  </div>;
}
'''
        violations = check_source(Path("Example.tsx"), source)
        self.assertEqual(
            {violation.rule_id for violation in violations},
            {"fixed-stock-text-utility", "fixed-text-utility", "fixed-font-size-property", "fixed-glyph-utility", "fixed-glyph-attribute"},
        )

    def test_accepts_semantic_text_and_glyph_tiers(self) -> None:
        source = '''
import { Check } from "lucide-react";
export function Example() {
  return <span className="text-ui"><Check className="icon-paired" /></span>;
}
'''
        self.assertEqual(check_source(Path("Example.tsx"), source), [])

    def test_ignores_examples_in_comments(self) -> None:
        source = '''
// Never add text-3xl or <Check size={16}> here.
/* text-[13px] is forbidden at production call sites. */
export function Example() { return <span className="text-title" />; }
'''
        self.assertEqual(check_source(Path("Example.tsx"), source), [])

    def test_rejects_fixed_status_dot_but_not_structural_avatar(self) -> None:
        source = '''
export function Example() {
  return <>
    <span className="size-1.5 rounded-full bg-info" />
    <div className="size-8 rounded-full bg-muted">A</div>
    <span className="size-2.5 rounded-full bg-background transition-transform" />
  </>;
}
'''
        violations = check_source(Path("Example.tsx"), source)
        self.assertEqual([violation.rule_id for violation in violations], ["fixed-status-glyph-utility"])

    def test_rejects_fixed_inline_svg_geometry_but_not_wrapper_geometry(self) -> None:
        source = '''
export function Example() {
  return <button className="size-8"><svg width="16" height={16} /></button>;
}
'''
        violations = check_source(Path("Example.tsx"), source)
        self.assertEqual([violation.rule_id for violation in violations], [
            "fixed-glyph-attribute",
            "fixed-glyph-attribute",
        ])

    def test_discovers_only_supported_icon_import_sources(self) -> None:
        source = '''
import { Check, X as Close } from "lucide-react";
import { Minus } from "@proliferate/ui/icons";
import { Settings } from "@proliferate/ui";
'''
        self.assertEqual(imported_icon_names(source), {"Check", "Close", "Minus"})

    def test_rejects_fixed_shared_icon_utility(self) -> None:
        source = '''
import { Minus } from "@proliferate/ui/icons";
export function Control() { return <Minus className="size-3.5" />; }
'''
        violations = check_source(Path("Control.tsx"), source)
        self.assertEqual([violation.rule_id for violation in violations], ["fixed-glyph-utility"])

    def test_rejects_fixed_icon_nested_inside_component_prop(self) -> None:
        source = '''
import { Plus } from "@proliferate/ui/icons";
export function Control() {
  return <Popover trigger={<Button><Plus className="size-3" /></Button>} />;
}
'''
        violations = check_source(Path("Control.tsx"), source)
        self.assertEqual([violation.rule_id for violation in violations], ["fixed-glyph-utility"])

    def test_rejects_fixed_svg_descendant_utility(self) -> None:
        source = '''
export function Control({ icon }) {
  return <span className="size-7 [&_svg]:size-3.5">{icon}</span>;
}
'''
        violations = check_source(Path("Control.tsx"), source)
        self.assertEqual(
            [violation.rule_id for violation in violations],
            ["fixed-svg-descendant-utility"],
        )

    def test_rejects_fixed_glyph_class_indirections(self) -> None:
        source = '''
const MENU_ICON_CLASS = "size-3.5";
export function TargetIcon({ size = "size-3.5" }) {
  return <MenuItem iconClassName="size-4 text-current" />;
}
'''
        violations = check_source(Path("Control.tsx"), source)
        self.assertEqual(
            {violation.rule_id for violation in violations},
            {
                "fixed-glyph-alias-utility",
                "fixed-glyph-component-default",
                "fixed-glyph-prop-utility",
            },
        )

    def test_rejects_fixed_global_icon_aliases(self) -> None:
        source = '''
:root {
  --workspace-icon-size: 14px;
  --workspace-action-size: 28px;
  --other-icon-size: var(--icon-paired);
}
'''
        violations = check_design_css_source(Path("product.css"), source)
        self.assertEqual(
            [violation.rule_id for violation in violations],
            ["fixed-glyph-css-variable", "authored-root-token"],
        )

    def test_rejects_closed_foundation_literal_vocabularies(self) -> None:
        source = '''
export function Example() {
  return <div className="
    text-sm text-[color:var(--color-foreground)] rounded-t-[13px] z-[70]
    gap-[5px] size-[18px] shadow-floating hover:bg-accent
    group-hover/item:bg-sidebar-accent hover:bg-foreground/[0.045]
    duration-150
  " />;
}
'''
        violations = check_source(Path("Example.tsx"), source)
        self.assertEqual(
            {violation.rule_id for violation in violations},
            {
                "fixed-stock-text-utility",
                "fixed-text-utility",
                "arbitrary-radius",
                "arbitrary-z",
                "arbitrary-gap",
                "arbitrary-size",
                "retired-shadow",
                "retired-accent-state",
                "foreground-alpha-foundation",
                "numeric-duration",
            },
        )

    def test_rejects_removed_keystone_shadow_and_static_foreground_alpha(self) -> None:
        source = '''
export function Example() {
  return <div className="shadow-keystone bg-foreground/[0.04]" />;
}
'''
        self.assertEqual(
            {violation.rule_id for violation in check_source(Path("Example.tsx"), source)},
            {"retired-shadow", "foreground-alpha-foundation"},
        )

    def test_accepts_closed_semantic_foundation_vocabulary(self) -> None:
        source = '''
export function Example() {
  return <div className="
    text-ui rounded-xl z-tooltip gap-1.5 size-5 shadow-popover
    hover:bg-hover active:bg-active data-[state=selected]:bg-selected
    hover:bg-foreground/90 duration-hover ease-out-quint
  " />;
}
'''
        self.assertEqual(check_source(Path("Example.tsx"), source), [])

    def test_accepts_negative_assertions_for_retired_state_names(self) -> None:
        source = '''
expect(html).not.toContain("hover:bg-sidebar-accent");
expect(html).not.toContain("data-[state=open]:bg-accent");
expect(html).not.toContain("text-xs");
'''
        self.assertEqual(check_source(Path("Example.test.tsx"), source), [])

    def test_rejects_inline_motion_but_allows_non_motion_clocks(self) -> None:
        source = '''
const NETWORK_TIMEOUT_MS = 30_000;
const CARD_EXIT_DURATION_MS = 120;
const style = { transition: "opacity 150ms cubic-bezier(0.4, 0, 0.2, 1)" };
'''
        rule_ids = {violation.rule_id for violation in check_source(Path("motion.ts"), source)}
        self.assertIn("inline-js-motion-literal", rule_ids)
        self.assertIn("inline-motion-literal", rule_ids)
        self.assertIn("inline-easing", rule_ids)
        self.assertNotIn("NETWORK_TIMEOUT_MS", " ".join(rule_ids))

    def test_allows_one_marked_activity_declaration(self) -> None:
        source = '''
/* activity-motion */
const ORBIT_DELAYS = [
  "[animation-delay:0s]",
  "[animation-delay:0.2s]",
] as const;
'''
        self.assertEqual(check_source(Path("activity.tsx"), source), [])

    def test_raw_hex_scope_and_exact_exceptions(self) -> None:
        self.assertTrue(raw_hex_scope_excluded(Path("components/playground/Demo.tsx")))
        self.assertTrue(raw_hex_scope_excluded(Path("components/__fixtures__/Demo.tsx")))
        self.assertTrue(raw_hex_scope_excluded(Path("components/DemoFixtures.tsx")))
        self.assertFalse(raw_hex_scope_excluded(Path("components/Demo.test.tsx")))

        rejected = check_source(Path("components/Demo.test.tsx"), 'const color = "#abcdef";')
        self.assertEqual([violation.rule_id for violation in rejected], ["raw-hex"])
        self.assertEqual(
            check_source(Path("components/Demo.test.tsx"), 'expect(css).not.toContain("#232323");'),
            [],
        )
        self.assertEqual(
            check_source(Path("components/Demo.test.tsx"), '<span>PR #737</span>'),
            [],
        )
        self.assertEqual(
            check_source(Path("components/playground/Demo.tsx"), 'const color = "#abcdef";'),
            [],
        )

    def test_design_css_rejects_global_tokens_and_finite_motion(self) -> None:
        source = '''
@theme { --color-test: red; }
:root { --color-test: red; }
.card {
  transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(8px);
}
'''
        self.assertEqual(
            {violation.rule_id for violation in check_design_css_source(Path("dom.css"), source)},
            {
                "authored-theme-block",
                "authored-root-token",
                "design-finite-motion-literal",
                "unowned-backdrop-filter",
            },
        )

    def test_design_css_allows_marked_infinite_activity_and_composer_backdrop(self) -> None:
        source = '''
/* activity-motion */
.spinner {
  animation: spin 1.5s linear infinite;
}
.chat-composer-surface {
  backdrop-filter: var(--color-composer-backdrop-filter);
}
'''
        self.assertEqual(check_design_css_source(Path("dom.css"), source), [])

    def test_legacy_alias_contract_requires_identical_tagged_values(self) -> None:
        valid_entries = "\n".join(
            f'''"{name}": {{\n  dark: "var(--color-hover) /* legacy-alias */",\n  light: "var(--color-hover) /* legacy-alias */",\n}},'''
            for name in (
                "--color-accent",
                "--color-composer-border",
                "--color-composer-control-hover",
                "--color-list-hover",
                "--color-popover-accent",
                "--color-popover-ring",
                "--color-sidebar-accent",
                "--color-sidebar-border",
                "--shadow-composer",
                "--shadow-floating",
                "--shadow-floating-dark",
                "--workspace-shell-action-hover-background",
                "--workspace-shell-tab-active-background",
                "--workspace-shell-tab-hover-background",
                "--workspace-shell-tab-selected-background",
            )
        )
        self.assertEqual(check_design_token_source(Path("tokens.ts"), valid_entries), [])
        broken = valid_entries.replace(
            'light: "var(--color-hover) /* legacy-alias */"',
            'light: "var(--color-active) /* legacy-alias */"',
            1,
        )
        self.assertIn(
            "invalid-legacy-alias",
            {violation.rule_id for violation in check_design_token_source(Path("tokens.ts"), broken)},
        )

    def test_rejects_numeric_z_and_unvirtualized_long_list_additions(self) -> None:
        sources = [
            (
                Path("/repo/apps/packages/ui/src/NewList.tsx"),
                'export const List = ({ rows }) => <div className="z-10">{rows.map(renderRow)}</div>;',
            )
        ]
        violations = check_census_additions(
            sources,
            {"standardNumericZ": {}, "unvirtualizedLongLists": {}},
            Path("/repo"),
        )
        self.assertEqual(
            {violation.rule_id for violation in violations},
            {"standard-z-addition", "unvirtualized-long-list-addition"},
        )

        baseline = {
            "standardNumericZ": {"apps/packages/ui/src/NewList.tsx|z-10": 1},
            "unvirtualizedLongLists": {"apps/packages/ui/src/NewList.tsx|rows": 1},
        }
        self.assertEqual(check_census_additions(sources, baseline, Path("/repo")), [])


if __name__ == "__main__":
    unittest.main()
