from pathlib import Path
import re
import unittest
from unittest import mock

from scripts import check_appearance_scaling as check_module
from scripts.check_appearance_scaling import (
    CENSUS_SLACK_RULE_ID,
    SANCTION_FILES_KEY,
    SANCTION_JUSTIFICATION_KEY,
    SANCTION_KEY,
    STAGED_CENSUS_KEY,
    STAGED_RULE_IDS,
    Violation,
    apply_staged_baseline,
    census_slack,
    check_census_additions,
    check_design_css_source,
    check_design_token_source,
    check_source,
    collect_raw_violations,
    imported_icon_names,
    load_baselines,
    raw_hex_scope_excluded,
    relative_path,
    staged_census,
    unsanctioned_growth,
)

LEGACY_ALIAS_SOURCE = "\n".join(
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

    def test_rejects_every_retired_shadow_spelling(self) -> None:
        """Historical keystone variants and stock Tailwind elevation both emit
        non-token shadows, so every spelling is one rule, not a family of holes."""
        for utility in (
            "shadow-keystone",
            "shadow-keystone-sm",
            "shadow-keystone-lg",
            "shadow-floating",
            "shadow-floating-dark",
            "shadow-sm",
            "shadow-md",
            "shadow-lg",
            "shadow-xl",
            "shadow-2xl",
            "shadow-inner",
            "shadow-[0_1px_2px_rgba(0,0,0,0.4)]",
        ):
            with self.subTest(utility=utility):
                source = f'const cls = "rounded-lg {utility} border";\n'
                self.assertEqual(
                    [violation.rule_id for violation in check_source(Path("E.tsx"), source)],
                    ["retired-shadow"],
                )

    def test_accepts_semantic_and_unrelated_shadow_names(self) -> None:
        source = 'const cls = "shadow-popover shadow-modal shadow-subtle shadow-none";\n'
        self.assertEqual(check_source(Path("E.tsx"), source), [])

    def test_rejects_low_foreground_alpha_in_every_spelling_and_position(self) -> None:
        """Tailwind compiles `/5`, `/[0.05]`, and `/[5%]` to the same color-mix,
        and a static fill is the same defect as an interaction-prefixed one."""
        for utility in (
            "bg-foreground/5",
            "bg-foreground/10",
            "bg-foreground/[0.04]",
            "bg-foreground/[.04]",
            "bg-foreground/[8%]",
            "bg-foreground/[10%]",
            "hover:bg-foreground/5",
            "hover:bg-foreground/[8%]",
            "active:bg-foreground/[0.052]",
            "group-hover/item:bg-foreground/[0.045]",
            "data-[state=open]:bg-foreground/10",
        ):
            with self.subTest(utility=utility):
                source = f'const cls = "{utility} rounded-lg";\n'
                self.assertEqual(
                    [violation.rule_id for violation in check_source(Path("E.tsx"), source)],
                    ["foreground-alpha-foundation"],
                )

    def test_accepts_opaque_foreground_fills(self) -> None:
        """Above 10% the fill is a deliberate surface, not a state overlay."""
        for utility in (
            "bg-foreground/20",
            "bg-foreground/90",
            "bg-foreground/[0.18]",
            "bg-foreground/[40%]",
            "hover:bg-foreground/80",
        ):
            with self.subTest(utility=utility):
                self.assertEqual(
                    check_source(Path("E.tsx"), f'const cls = "{utility}";\n'), []
                )

    def test_accepts_negative_assertions_for_foreground_alpha(self) -> None:
        source = 'expect(cls).not.toContain("bg-foreground/5");\n'
        self.assertEqual(check_source(Path("E.test.tsx"), source), [])

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
        self.assertEqual(
            rule_ids,
            {"inline-js-motion-literal", "inline-motion-literal", "inline-easing"},
        )

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
            check_source(Path("components/Demo.test.tsx"), "<span>PR #737</span>"),
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
            {violation.rule_id for violation in check_design_css_source(Path("product.css"), source)},
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
  -webkit-backdrop-filter: var(--composer-backdrop-filter);
  backdrop-filter: var(--composer-backdrop-filter);
}
'''
        self.assertEqual(check_design_css_source(Path("product.css"), source), [])

    def test_backdrop_filter_ownership_covers_the_vendor_prefixed_spelling(self) -> None:
        """The house style authors the pair, and WebKit is the desktop shell's
        engine — so a prefixed-only blur is the declaration that actually renders
        and must not be the one spelling the ownership gate cannot see."""
        for declaration in ("backdrop-filter", "-webkit-backdrop-filter"):
            with self.subTest(declaration=declaration):
                source = ".some-panel {\n  %s: blur(24px);\n}\n" % declaration
                self.assertEqual(
                    [
                        violation.rule_id
                        for violation in check_design_css_source(Path("product.css"), source)
                    ],
                    ["unowned-backdrop-filter"],
                )

    def test_authored_backdrop_filter_in_product_source_covers_both_spellings(self) -> None:
        for declaration in ("backdrop-filter", "-webkit-backdrop-filter"):
            with self.subTest(declaration=declaration):
                source = 'const style = { cssText: "%s: blur(8px)" };\n' % declaration
                self.assertEqual(
                    [
                        violation.rule_id
                        for violation in check_source(Path("Panel.tsx"), source)
                    ],
                    ["authored-backdrop-filter"],
                )

    def test_backdrop_filter_rule_ignores_unrelated_custom_properties(self) -> None:
        """`--color-composer-backdrop-filter: ...` is a token name, not a
        declaration of the property, so widening the prefix must not catch it."""
        self.assertEqual(
            check_source(
                Path("Panel.tsx"),
                'const cls = "supports-[backdrop-filter]:bg-background/80";\n',
            ),
            [],
        )

    def test_design_css_allows_component_scoped_mode_variables(self) -> None:
        """Only genuinely global roots are generated; scoped blocks stay authored."""
        source = '''
:root[data-mode="light"] .right-panel-tab-system {
  --right-panel-tab-surface: var(--color-surface);
}
:root[data-mode="light"] {
  --color-test: red;
}
'''
        self.assertEqual(
            [violation.rule_id for violation in check_design_css_source(Path("product.css"), source)],
            ["authored-root-token"],
        )

    def test_legacy_alias_contract_requires_identical_tagged_values(self) -> None:
        self.assertEqual(check_design_token_source(Path("tokens.ts"), LEGACY_ALIAS_SOURCE), [])
        broken = LEGACY_ALIAS_SOURCE.replace(
            'light: "var(--color-hover) /* legacy-alias */"',
            'light: "var(--color-active) /* legacy-alias */"',
            1,
        )
        self.assertIn(
            "invalid-legacy-alias",
            {violation.rule_id for violation in check_design_token_source(Path("tokens.ts"), broken)},
        )

    def test_legacy_alias_census_rejects_extra_markers(self) -> None:
        extra = LEGACY_ALIAS_SOURCE + '\n"--color-extra": {\n  dark: "var(--color-hover) /* legacy-alias */",\n  light: "var(--color-hover) /* legacy-alias */",\n},'
        self.assertIn(
            "legacy-alias-census",
            {violation.rule_id for violation in check_design_token_source(Path("tokens.ts"), extra)},
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

    def test_staged_census_absorbs_frozen_sites_and_rejects_new_ones(self) -> None:
        """The staging contract: pre-migration hits are frozen per file, additions fail."""
        path = Path("/repo/apps/packages/ui/src/Legacy.tsx")
        legacy = [
            Violation("fixed-stock-text-utility", path, 4, "m"),
            Violation("fixed-stock-text-utility", path, 9, "m"),
        ]
        census = staged_census(legacy, Path("/repo"))
        self.assertEqual(census, {"apps/packages/ui/src/Legacy.tsx|fixed-stock-text-utility": 2})
        self.assertEqual(apply_staged_baseline(legacy, census, Path("/repo")), [])

        regressed = [*legacy, Violation("fixed-stock-text-utility", path, 14, "m")]
        reported = apply_staged_baseline(regressed, census, Path("/repo"))
        self.assertEqual([violation.lineno for violation in reported], [14])
        self.assertIn("frozen census is 2", reported[0].message)

    def test_slack_census_entry_fails_and_names_the_ratchet_command(self) -> None:
        """Absorption is anonymous, so a freed slot is a live allowance.

        `apply_staged_baseline` matches on (file, rule) and never on the site
        that earned the slot, so a census entry allocating more than its file
        now uses would silently absorb the NEXT new violation there. Slack must
        therefore fail, and the message must point at the one remedy that
        cannot paper over a regression (`--write-baseline` refuses growth).
        """
        path = Path("/repo/apps/packages/ui/src/Legacy.tsx")
        census = {"apps/packages/ui/src/Legacy.tsx|fixed-stock-text-utility": 3}
        remaining = [Violation("fixed-stock-text-utility", path, 4, "m")]

        # Bounded from above: the surviving hit is still absorbed.
        self.assertEqual(apply_staged_baseline(remaining, census, Path("/repo")), [])

        reported = census_slack(remaining, census, Path("/repo"))
        self.assertEqual([violation.rule_id for violation in reported], [CENSUS_SLACK_RULE_ID])
        self.assertIn("frozen at 3 here but the file now has 1", reported[0].message)
        self.assertIn("--write-baseline", reported[0].message)

    def test_a_fixed_site_cannot_shield_a_new_violation_of_the_same_rule(self) -> None:
        """The exact leak: migrate 2 of 3 sites, add 1 brand-new one, and the
        per-file count is unchanged so the upper bound sees nothing."""
        path = Path("/repo/apps/packages/ui/src/Legacy.tsx")
        census = {"apps/packages/ui/src/Legacy.tsx|fixed-stock-text-utility": 3}
        after = [
            Violation("fixed-stock-text-utility", path, 4, "m"),
            Violation("fixed-stock-text-utility", path, 40, "brand new"),
        ]
        self.assertEqual(apply_staged_baseline(after, census, Path("/repo")), [])
        self.assertEqual(
            [violation.rule_id for violation in census_slack(after, census, Path("/repo"))],
            [CENSUS_SLACK_RULE_ID],
        )

    def test_ratcheted_down_census_is_tight_and_then_bans_the_new_site(self) -> None:
        """After --write-baseline the entry equals the surviving hits: no slack,
        and the next new violation in that file fails on the upper bound."""
        path = Path("/repo/apps/packages/ui/src/Legacy.tsx")
        remaining = [Violation("fixed-stock-text-utility", path, 4, "m")]
        ratcheted = staged_census(remaining, Path("/repo"))
        self.assertEqual(ratcheted, {"apps/packages/ui/src/Legacy.tsx|fixed-stock-text-utility": 1})
        self.assertEqual(census_slack(remaining, ratcheted, Path("/repo")), [])

        regressed = [*remaining, Violation("fixed-stock-text-utility", path, 40, "new")]
        self.assertEqual(
            [violation.lineno for violation in apply_staged_baseline(regressed, ratcheted, Path("/repo"))],
            [40],
        )
        self.assertEqual(census_slack(regressed, ratcheted, Path("/repo")), [])

    def test_a_fully_migrated_file_must_lose_its_census_entry(self) -> None:
        """Zero surviving hits is the strongest slack: the whole entry is dead
        allowance and the file should be back under an absolute ban."""
        census = {"apps/packages/ui/src/Legacy.tsx|retired-shadow": 2}
        reported = census_slack([], census, Path("/repo"))
        self.assertEqual([violation.rule_id for violation in reported], [CENSUS_SLACK_RULE_ID])
        self.assertIn("frozen at 2 here but the file now has 0", reported[0].message)
        self.assertEqual(census_slack([], {}, Path("/repo")), [])

    def test_slack_is_only_judged_for_files_that_were_actually_scanned(self) -> None:
        """The pre-commit hook passes an explicit file list. An unscanned file's
        count is unknown, not zero, so scoping keeps the hook honest instead of
        reporting every censused file in the repository as slack."""
        path = Path("/repo/apps/packages/ui/src/Touched.tsx")
        census = {
            "apps/packages/ui/src/Touched.tsx|retired-shadow": 1,
            "apps/packages/ui/src/Untouched.tsx|retired-shadow": 2,
        }
        touched_only = {"apps/packages/ui/src/Touched.tsx"}
        surviving = [Violation("retired-shadow", path, 3, "m")]

        self.assertEqual(
            census_slack(surviving, census, Path("/repo"), scope=touched_only),
            [],
            "the untouched file was never scanned, so its 0 hits are unknown, not slack",
        )
        # Unscoped (the CI run) the same inputs DO report the untouched file,
        # which is what makes the full-tree run the authority.
        self.assertEqual(
            [violation.path.name for violation in census_slack(surviving, census, Path("/repo"))],
            ["Untouched.tsx"],
        )
        # And a genuinely slack in-scope entry is still reported by the hook.
        self.assertEqual(
            [
                violation.path.name
                for violation in census_slack([], census, Path("/repo"), scope=touched_only)
            ],
            ["Touched.tsx"],
        )

    def test_the_census_slack_rule_is_not_itself_staged(self) -> None:
        """A guard that its own census could absorb is not a guard."""
        self.assertNotIn(CENSUS_SLACK_RULE_ID, STAGED_RULE_IDS)
        self.assertEqual(
            staged_census(
                [Violation(CENSUS_SLACK_RULE_ID, Path("/repo/a.tsx"), 1, "m")], Path("/repo")
            ),
            {},
        )

    def test_the_default_ci_path_reports_census_slack(self) -> None:
        """The whole finding was that NOTHING ever failed on slack, so the wiring
        is the assertion: the entry point CI runs must surface it."""
        census = {"apps/packages/ui/src/Legacy.tsx|retired-shadow": 2}
        with (
            mock.patch.object(check_module, "collect_raw_violations", return_value=[]),
            mock.patch.object(
                check_module, "load_baselines", return_value={STAGED_CENSUS_KEY: census}
            ),
        ):
            self.assertEqual(
                [violation.rule_id for violation in check_module.collect_violations()],
                [CENSUS_SLACK_RULE_ID],
            )

    def test_unstaged_rules_are_never_absorbed_by_the_census(self) -> None:
        """Rules outside STAGED_RULE_IDS fail on their first hit, census or not."""
        path = Path("/repo/apps/packages/design/src/tokens.ts")
        unstaged = Violation("legacy-alias-census", path, 1, "m")
        self.assertNotIn("legacy-alias-census", STAGED_RULE_IDS)
        self.assertEqual(staged_census([unstaged], Path("/repo")), {})
        self.assertEqual(
            apply_staged_baseline(
                [unstaged],
                {"apps/packages/design/src/tokens.ts|legacy-alias-census": 5},
                Path("/repo"),
            ),
            [unstaged],
        )

    def test_emptied_census_family_becomes_an_absolute_ban(self) -> None:
        """A staged rule with no census entries behaves exactly like a hard rule."""
        path = Path("/repo/apps/packages/ui/src/Clean.tsx")
        violation = Violation("retired-shadow", path, 3, "m")
        self.assertEqual(
            [reported.lineno for reported in apply_staged_baseline([violation], {}, Path("/repo"))],
            [3],
        )

    def test_every_census_growth_sanction_names_a_real_staged_rule(self) -> None:
        """v2 4.6: growth needs a written sanction, and it must be enforceable.

        A sanction naming a rule that no longer exists is dead text that would
        silently authorize nothing (or, worse, be assumed to authorize something).
        """
        sanctions = load_baselines().get(SANCTION_KEY, {})
        self.assertTrue(sanctions, "the shipped baseline records its growth sanctions")
        for rule_id, sanction in sanctions.items():
            with self.subTest(rule_id=rule_id):
                self.assertIn(rule_id, STAGED_RULE_IDS)
                self.assertGreater(
                    len(sanction[SANCTION_JUSTIFICATION_KEY]),
                    80,
                    "sanctions are written trails",
                )
                files = sanction[SANCTION_FILES_KEY]
                self.assertTrue(files, "a sanction covers named call sites, not a family")
                for relative, ceiling in files.items():
                    self.assertRegex(relative, r"^apps/.+\.(?:ts|tsx|css)$")
                    self.assertGreater(ceiling, 0)

    def test_census_growth_is_refused_outside_the_sanctioned_call_sites(self) -> None:
        """The defect this replaces: a family-wide sanction let ANY file grow.

        Growth is only ever allowed at the exact file a sanction names, and only
        up to the count it records — so a brand-new keystone shadow in an
        unrelated file cannot ride in on another file's justification.
        """
        sanctions = {
            "retired-shadow": {
                SANCTION_FILES_KEY: {"apps/packages/ui/src/kit/Sonner.tsx": 1},
                SANCTION_JUSTIFICATION_KEY: "x" * 81,
            }
        }
        previous = {"apps/packages/ui/src/kit/Sonner.tsx|retired-shadow": 0}

        self.assertEqual(
            unsanctioned_growth(
                previous,
                {"apps/packages/ui/src/kit/Sonner.tsx|retired-shadow": 1},
                sanctions,
            ),
            [],
        )
        self.assertEqual(
            unsanctioned_growth(
                previous,
                {"apps/packages/ui/src/kit/Sonner.tsx|retired-shadow": 2},
                sanctions,
            ),
            ["apps/packages/ui/src/kit/Sonner.tsx|retired-shadow: 0 -> 2"],
        )
        self.assertEqual(
            unsanctioned_growth(
                previous,
                {"apps/packages/product-ui/src/repos/AddRepoFlow.tsx|retired-shadow": 1},
                sanctions,
            ),
            ["apps/packages/product-ui/src/repos/AddRepoFlow.tsx|retired-shadow: 0 -> 1"],
        )

    def test_census_growth_is_refused_for_an_unsanctioned_family(self) -> None:
        self.assertEqual(
            unsanctioned_growth({"a.tsx|arbitrary-z": 1}, {"a.tsx|arbitrary-z": 2}, {}),
            ["a.tsx|arbitrary-z: 1 -> 2"],
        )
        self.assertEqual(
            unsanctioned_growth({"a.tsx|arbitrary-z": 3}, {"a.tsx|arbitrary-z": 1}, {}),
            [],
            "shrinking is always free",
        )

    def test_shipped_census_allocates_no_more_than_the_tree_actually_uses(self) -> None:
        """An over-allocated entry is an unearned allowance: it hands a clean file
        room for a brand-new violation, which is the ban leaking, not shrinking."""
        census = load_baselines()[STAGED_CENSUS_KEY]
        actual = staged_census(collect_raw_violations())
        over_allocated = {
            key: (count, actual.get(key, 0))
            for key, count in census.items()
            if count > actual.get(key, 0)
        }
        self.assertEqual(over_allocated, {})

    def test_shipped_census_has_no_entry_for_a_dead_class(self) -> None:
        """The keystone regression: a removed token's utility must be deleted at
        the call site, never absorbed by the census."""
        census = load_baselines()[STAGED_CENSUS_KEY]
        button = "apps/packages/ui/src/primitives/Button.tsx|retired-shadow"
        self.assertNotIn(button, census)

    def test_scanned_roots_cover_every_root_tailwind_compiles(self) -> None:
        """The product-surfaces hole, made unrepeatable.

        ``@source`` in product.css is the definition of "this tree ships utilities":
        a root listed there is compiled into the stylesheet users load, so a root
        listed there but absent from PRODUCTION_ROOTS holds every foundation ban
        at zero strength — which is exactly how product-surfaces shipped a
        `text-sm` off a REMOVED token with no gate, no census entry, and no
        migration target. Asserting the two lists against each other means the
        next package added to the build cannot arrive ungated: whoever adds the
        ``@source`` line has to census the root in the same commit.
        """
        product_css = next(
            path for path in check_module.DESIGN_CSS_FILES if path.name == "product.css"
        )
        sourced = {
            (product_css.parent / match).resolve()
            for match in re.findall(r'@source\s+"([^"]+)"', product_css.read_text())
        }
        self.assertTrue(sourced, "product.css must declare the roots Tailwind scans")
        scanned = set(check_module.PRODUCTION_ROOTS)
        self.assertEqual(
            sorted(relative_path(path) for path in sourced - scanned),
            [],
            "Tailwind compiles these roots but the foundation guard never reads them",
        )

    def test_the_pre_commit_hook_owns_the_same_roots_as_ci(self) -> None:
        """A root only CI sees is a root the local guard waves through.

        The hook is the fast path developers actually feel; if its filter and
        PRODUCTION_ROOTS disagree, a violation commits cleanly and only surfaces
        in CI — the drift that let product-surfaces sit unenforced in both.
        """
        hook = (check_module.REPO_ROOT / "scripts" / "git-hooks" / "pre-commit").read_text()
        for root in check_module.PRODUCTION_ROOTS:
            relative = relative_path(root)
            package = relative.removeprefix("apps/packages/").removesuffix("/src")
            with self.subTest(root=relative):
                self.assertTrue(
                    f"{package}/src" in hook or f"({package}|" in hook or f"|{package}|" in hook
                    or f"|{package})" in hook,
                    f"{relative} is scanned by CI but not matched by the pre-commit hook",
                )


if __name__ == "__main__":
    unittest.main()
