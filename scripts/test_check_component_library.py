from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import check_component_library as check_module
from scripts.check_component_library import (
    AllowlistEntry,
    RegistryRow,
    Violation,
    build_importers,
    find_hand_rolled_role_violations,
    jsdoc_precedes_export,
    kit_violations,
    parse_registry,
    registry_violations,
    tier_file_violations,
)

DOC = """
### The sanctioned index

#### Primitives (`product-client/src/primitives/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `Button` | [Button.tsx](../apps/packages/product-client/src/primitives/Button.tsx) | The button primitive. |
| `Ghost` | [Ghost.tsx](../apps/packages/product-client/src/primitives/Ghost.tsx) | incubating: lands with the ghost slice. |

#### Icons (`product-client/src/primitives/icons/`)

| Component | Path | Purpose |
| --- | --- | --- |
| `core` | [core.tsx](../apps/packages/product-client/src/primitives/icons/core.tsx) | Glyphs. |

### Something else

| Component | Path | Purpose |
| --- | --- | --- |
| `NotARow` | [x.tsx](../x.tsx) | Outside the index. |
"""


class RegistryParsingTest(unittest.TestCase):
    def parse(self) -> list[RegistryRow]:
        with tempfile.TemporaryDirectory() as directory:
            doc = Path(directory) / "DESIGN_SYSTEM.md"
            doc.write_text(DOC)
            return parse_registry(doc)

    def test_reads_only_sanctioned_index_rows_and_tags_their_tier(self) -> None:
        rows = self.parse()
        self.assertEqual(
            [(row.tier, row.name) for row in rows],
            [
                ("product-client/src/primitives/", "Button"),
                ("product-client/src/primitives/", "Ghost"),
                ("product-client/src/primitives/icons/", "core"),
            ],
        )

    def test_ignores_tables_outside_the_index_section(self) -> None:
        self.assertNotIn("NotARow", [row.name for row in self.parse()])


class HandRolledRoleTest(unittest.TestCase):
    def test_reports_literal_and_conditional_overlay_roles(self) -> None:
        source = (
            "export function A() {\n"
            '  return <div role="dialog">\n'
            '    <span role={onSelect ? "button" : undefined} />\n'
            '    <b role="listitem" />\n'
            "  </div>;\n"
            "}\n"
        )
        violations = find_hand_rolled_role_violations({Path("A.tsx"): source})
        self.assertEqual([v.lineno for v in violations], [2, 3])
        self.assertTrue(all(v.rule_id == "hand-rolled-overlay-role" for v in violations))

    def test_a_single_quoted_role_is_the_same_finding(self) -> None:
        violations = find_hand_rolled_role_violations(
            {Path("A.tsx"): "export const A = () => <div role='dialog' />;\n"}
        )
        self.assertEqual([v.rule_id for v in violations], ["hand-rolled-overlay-role"])

    def test_a_css_attribute_selector_reads_a_role_rather_than_writing_one(self) -> None:
        source = 'const FOCUSABLE = ["[role=\'button\']", \'[role="menu"]\'].join(",");\n'
        self.assertEqual(find_hand_rolled_role_violations({Path("A.ts"): source}), [])

    def test_ignores_commented_out_roles_and_test_files(self) -> None:
        source = '// role="dialog" is what this used to be\nexport const A = 1;\n'
        self.assertEqual(find_hand_rolled_role_violations({Path("A.tsx"): source}), [])
        self.assertEqual(
            find_hand_rolled_role_violations(
                {Path("A.test.tsx"): 'const x = <div role="dialog" />;'}
            ),
            [],
        )


class JsdocTest(unittest.TestCase):
    def test_accepts_a_block_directly_above_the_declaration(self) -> None:
        self.assertTrue(
            jsdoc_precedes_export("/** What it is. */\nexport function Button() {}\n", "Button")
        )

    def test_accepts_a_file_header_block(self) -> None:
        source = '/** Module doc. */\nimport x from "y";\n\nexport const Button = 1;\n'
        self.assertTrue(jsdoc_precedes_export(source, "Button"))

    def test_rejects_a_line_comment_and_a_missing_declaration(self) -> None:
        self.assertFalse(
            jsdoc_precedes_export("// what it is\nexport function Button() {}\n", "Button")
        )
        self.assertFalse(jsdoc_precedes_export("export function Other() {}\n", "Button"))

    def test_rejects_a_plain_block_comment(self) -> None:
        self.assertFalse(
            jsdoc_precedes_export("/* an aside */\nexport function Button() {}\n", "Button")
        )
        self.assertFalse(
            jsdoc_precedes_export(
                '/* module aside */\nimport x from "y";\n\nexport const Button = 1;\n',
                "Button",
            )
        )

    def test_rejects_an_empty_doc_block(self) -> None:
        self.assertFalse(
            jsdoc_precedes_export("/**\n *\n */\nexport function Button() {}\n", "Button")
        )


class ImportGraphTest(unittest.TestCase):
    def graph(self, tmp: Path, consumer_source: str) -> dict[Path, set[Path]]:
        component = tmp / "Widget.tsx"
        component.write_text("export function Widget() {}\n")
        consumer = tmp / "Surface.tsx"
        consumer.write_text(consumer_source)
        return build_importers({component: component.read_text(), consumer: consumer_source})

    def test_a_real_import_is_a_call_site(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory).resolve()
            graph = self.graph(tmp, 'import { Widget } from "./Widget";\n')
            self.assertEqual(graph[tmp / "Widget.tsx"], {tmp / "Surface.tsx"})

    def test_a_commented_out_import_is_not_a_call_site(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory).resolve()
            line = self.graph(tmp, '// import { Widget } from "./Widget";\n')
            self.assertEqual(line, {})
            block = self.graph(tmp, '/* import { Widget } from "./Widget"; */\n')
            self.assertEqual(block, {})


class RegistryRuleTest(unittest.TestCase):
    def build(self, tmp: Path) -> tuple[list[RegistryRow], dict[Path, str]]:
        component = tmp / "Widget.tsx"
        component.write_text("export function Widget() {}\n")
        consumer = tmp / "Surface.tsx"
        consumer.write_text('import { Widget } from "./Widget";\n')
        rows = [
            RegistryRow(
                tier="product-client/src/primitives/",
                name="Widget",
                link="Widget.tsx",
                purpose="A widget.",
                lineno=10,
            )
        ]
        return rows, {component: component.read_text(), consumer: consumer.read_text()}

    def test_a_component_with_no_consumer_is_dead_vocabulary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory).resolve()
            rows, sources = self.build(tmp)
            with mock.patch.object(check_module, "DESIGN_SYSTEM_DOC", tmp / "DOC.md"):
                rule_ids = {
                    violation.rule_id for violation in registry_violations(rows, sources, {})
                }
            self.assertIn("dead-library-component", rule_ids)
            self.assertIn("missing-library-jsdoc", rule_ids)

    def test_a_consumer_clears_the_dead_rule(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory).resolve()
            rows, sources = self.build(tmp)
            importers = {tmp / "Widget.tsx": {tmp / "Surface.tsx"}}
            with mock.patch.object(check_module, "DESIGN_SYSTEM_DOC", tmp / "DOC.md"):
                rule_ids = {
                    violation.rule_id
                    for violation in registry_violations(rows, sources, importers)
                }
            self.assertNotIn("dead-library-component", rule_ids)

    def test_a_surviving_incubating_note_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory).resolve()
            rows, sources = self.build(tmp)
            rows = [
                RegistryRow(
                    tier=rows[0].tier,
                    name=rows[0].name,
                    link=rows[0].link,
                    purpose="incubating: lands with the widget slice.",
                    lineno=10,
                )
            ]
            with mock.patch.object(check_module, "DESIGN_SYSTEM_DOC", tmp / "DOC.md"):
                rule_ids = {
                    violation.rule_id for violation in registry_violations(rows, sources, {})
                }
            self.assertEqual(rule_ids, {"expired-incubating-note"})

    def test_a_row_that_links_nothing_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory).resolve()
            rows = [
                RegistryRow(
                    tier="product-client/src/primitives/",
                    name="Gone",
                    link="Gone.tsx",
                    purpose="A widget.",
                    lineno=3,
                )
            ]
            with mock.patch.object(check_module, "DESIGN_SYSTEM_DOC", tmp / "DOC.md"):
                violations = registry_violations(rows, {}, {})
            self.assertEqual(
                [violation.rule_id for violation in violations],
                ["registry-row-without-file"],
            )


class TierFileTest(unittest.TestCase):
    def layout(self, root: Path) -> tuple[Path, Path]:
        primitives = root / "apps/packages/product-client/src/primitives"
        patterns = primitives / "patterns"
        (patterns / "secrets").mkdir(parents=True)
        (primitives / "icons").mkdir()
        (primitives / "utils").mkdir()
        (primitives / "Button.tsx").write_text("export function Button() {}\n")
        return primitives, patterns

    def run_rule(
        self,
        root: Path,
        primitives: Path,
        patterns: Path,
        importers: dict[Path, set[Path]] | None = None,
    ) -> list[Violation]:
        rows = [
            RegistryRow(
                tier="product-client/src/primitives/",
                name="Button",
                link="../apps/packages/product-client/src/primitives/Button.tsx",
                purpose="The button.",
                lineno=1,
            )
        ]
        with (
            mock.patch.object(check_module, "REPO_ROOT", root),
            mock.patch.object(check_module, "PRIMITIVES_DIR", primitives),
            mock.patch.object(check_module, "PATTERNS_DIR", patterns),
            mock.patch.object(check_module, "ICONS_DIR", primitives / "icons"),
            mock.patch.object(
                check_module,
                "PRODUCT_PATTERNS_DIR",
                root / "apps/packages/product-client/src/components/patterns",
            ),
            mock.patch.object(
                check_module,
                "TIER_ROOTS",
                {
                    "product-client/src/primitives/": primitives,
                    "product-client/src/primitives/patterns/": patterns,
                },
            ),
            mock.patch.object(
                check_module,
                "DESIGN_SYSTEM_DOC",
                root / "specs" / "DESIGN_SYSTEM.md",
            ),
        ):
            (root / "specs").mkdir(exist_ok=True)
            return tier_file_violations(rows, importers or {})

    def test_an_indexed_tier_file_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            primitives, patterns = self.layout(root)
            self.assertEqual(self.run_rule(root, primitives, patterns), [])

    def test_an_unindexed_tier_file_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            primitives, patterns = self.layout(root)
            (primitives / "Orphan.tsx").write_text("export const Orphan = 1;\n")
            violations = self.run_rule(root, primitives, patterns)
            self.assertEqual(
                [violation.rule_id for violation in violations],
                ["tier-file-without-registry-row"],
            )

    def test_support_directories_and_named_modules_are_not_components(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            primitives, patterns = self.layout(root)
            (primitives / "utils" / "show-toast.tsx").write_text("export const a = 1;\n")
            (primitives / "icons" / "core.tsx").write_text("export const b = 1;\n")
            (primitives / "Button.test.tsx").write_text("export const c = 1;\n")
            named = primitives / "surface-helper.ts"
            named.write_text("export const d = 1;\n")
            unnamed = self.run_rule(root, primitives, patterns)
            self.assertEqual(
                [violation.relative_path for violation in unnamed],
                [named.relative_to(root).as_posix()],
            )
            with mock.patch.object(
                check_module,
                "NON_COMPONENT_TIER_FILES",
                {named.relative_to(root).as_posix()},
            ):
                violations = self.run_rule(root, primitives, patterns)
            self.assertEqual([violation.relative_path for violation in violations], [])

    def test_a_private_part_of_an_indexed_component_is_exempt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            primitives, patterns = self.layout(root)
            part = patterns / "secrets" / "SecretRow.tsx"
            part.write_text("export const SecretRow = 1;\n")
            sibling = patterns / "secrets" / "SecretList.tsx"
            sibling.write_text('import { SecretRow } from "./SecretRow";\n')
            violations = self.run_rule(
                root,
                primitives,
                patterns,
                importers={part: {sibling}, sibling: {part}},
            )
            self.assertEqual([v.relative_path for v in violations], [])

    def test_an_unimported_module_in_a_component_folder_is_still_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            primitives, patterns = self.layout(root)
            (patterns / "secrets" / "Nobody.tsx").write_text("export const N = 1;\n")
            violations = self.run_rule(root, primitives, patterns)
            self.assertEqual(
                [violation.rule_id for violation in violations],
                ["tier-file-without-registry-row"],
            )

    def test_a_module_imported_from_outside_its_folder_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            primitives, patterns = self.layout(root)
            part = patterns / "secrets" / "SecretRow.tsx"
            part.write_text("export const SecretRow = 1;\n")
            outsider = primitives / "Button.tsx"
            violations = self.run_rule(root, primitives, patterns, importers={part: {outsider}})
            self.assertEqual(
                [violation.rule_id for violation in violations],
                ["tier-file-without-registry-row"],
            )


class KitPlacementTest(unittest.TestCase):
    def test_a_kit_member_may_not_import_feature_code(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            patterns = root / "apps/packages/product-client/src/primitives/patterns"
            kit = patterns / "tabs"
            kit.mkdir(parents=True)
            feature = root / "apps/packages/product-client/src/components/workspace"
            feature.mkdir(parents=True)
            (feature / "useTabs.ts").write_text("export const useTabs = () => {};\n")
            member = kit / "ChromeTab.tsx"
            source = 'import { useTabs } from "#product/components/workspace/useTabs";\n'
            member.write_text(source)
            rows = [
                RegistryRow(
                    tier="product-client/src/primitives/patterns/",
                    name="ChromeTab",
                    link="../apps/packages/product-client/src/primitives/patterns/tabs/ChromeTab.tsx",
                    purpose="Tabs kit.",
                    lineno=1,
                )
            ]
            with (
                mock.patch.object(check_module, "REPO_ROOT", root),
                mock.patch.object(check_module, "PATTERNS_DIR", patterns),
                mock.patch.object(
                    check_module,
                    "PRODUCT_CLIENT_SRC",
                    root / "apps/packages/product-client/src",
                ),
            ):
                violations = kit_violations(rows, {member: source})
            self.assertEqual(
                [violation.rule_id for violation in violations],
                ["kit-imports-feature-code"],
            )

    def test_a_kit_directory_with_no_index_row_is_unsanctioned(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            patterns = root / "patterns"
            (patterns / "ghosts").mkdir(parents=True)
            with (
                mock.patch.object(check_module, "REPO_ROOT", root),
                mock.patch.object(check_module, "PATTERNS_DIR", patterns),
            ):
                violations = kit_violations([], {})
            self.assertEqual(
                [violation.rule_id for violation in violations],
                ["kit-directory-without-registry-rows"],
            )


class AllowlistTest(unittest.TestCase):
    def write(self, tmp: Path, body: str) -> Path:
        path = tmp / "allowlist.json"
        path.write_text(body)
        return path

    def test_an_entry_without_a_justification_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory).resolve()
            path = self.write(
                tmp,
                '{"deadLibraryComponents": {"a.tsx": {"count": 1, "justification": "  "}}}',
            )
            with self.assertRaises(ValueError):
                check_module.load_allowlist(path)

    def test_a_zero_count_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory).resolve()
            path = self.write(
                tmp,
                '{"deadLibraryComponents": {"a.tsx": {"count": 0, "justification": "x"}}}',
            )
            with self.assertRaises(ValueError):
                check_module.load_allowlist(path)

    def test_a_valid_entry_loads_with_its_reason(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory).resolve()
            path = self.write(
                tmp,
                '{"deadLibraryComponents": {"a.tsx": {"count": 2, "justification": "why"}}}',
            )
            self.assertEqual(
                check_module.load_allowlist(path),
                {("dead-library-component", "a.tsx"): AllowlistEntry(2, "why")},
            )


class ShippedAllowlistTest(unittest.TestCase):
    def test_the_repository_allowlist_parses_and_every_entry_is_justified(self) -> None:
        entries = check_module.load_allowlist()
        self.assertTrue(entries)
        for entry in entries.values():
            self.assertTrue(entry.justification.strip())


if __name__ == "__main__":
    unittest.main()
