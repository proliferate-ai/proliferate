from pathlib import Path
import unittest

from scripts.check_appearance_scaling import (
    check_design_css_source,
    check_source,
    imported_icon_names,
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
        self.assertEqual([violation.rule_id for violation in violations], ["fixed-glyph-css-variable"])


if __name__ == "__main__":
    unittest.main()
