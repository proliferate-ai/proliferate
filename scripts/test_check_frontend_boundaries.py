from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import check_frontend_boundaries as check_module


class RadixImportBoundaryTest(unittest.TestCase):
    def write_files(self, directory: Path, files: dict[str, str]) -> None:
        for name, content in files.items():
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

    def test_radix_import_allowed_under_primitives_and_patterns(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.write_files(
                root,
                {
                    "apps/packages/ui/src/primitives/Dialog.tsx": (
                        'import * as DialogPrimitive from "@radix-ui/react-dialog";\n'
                    ),
                    "apps/packages/ui/src/patterns/CommandPalette.tsx": (
                        'import { Command } from "@radix-ui/react-dialog";\n'
                    ),
                },
            )
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module, "ALL_FRONTEND_SRC_ROOTS", [root / "apps" / "packages" / "ui" / "src"]
            ):
                violations = check_module.find_radix_import_violations()

        self.assertEqual(violations, [])

    def test_radix_import_outside_ui_component_library_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.write_files(
                root,
                {
                    "apps/packages/product-ui/src/patterns/Fancy.tsx": (
                        'import * as PopoverPrimitive from "@radix-ui/react-popover";\n'
                    ),
                    "apps/desktop/src/components/Fancy.tsx": (
                        'import { Slot } from "@radix-ui/react-slot";\n'
                    ),
                },
            )
            roots = [
                root / "apps" / "packages" / "product-ui" / "src",
                root / "apps" / "desktop" / "src",
            ]
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module, "ALL_FRONTEND_SRC_ROOTS", roots
            ):
                violations = check_module.find_radix_import_violations()

                self.assertEqual(
                    {violation.rule_id for violation in violations},
                    {"RADIX_IMPORT_OUTSIDE_UI_COMPONENT_LIBRARY"},
                )
                self.assertEqual(len(violations), 2)
                relative_paths = {violation.relative_path for violation in violations}
                self.assertEqual(
                    relative_paths,
                    {
                        "apps/packages/product-ui/src/patterns/Fancy.tsx",
                        "apps/desktop/src/components/Fancy.tsx",
                    },
                )

    def test_radix_import_ignored_in_comments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.write_files(
                root,
                {
                    "apps/desktop/src/components/Fancy.tsx": (
                        '// do not import from "@radix-ui/react-popover" here\n'
                        "export const Fancy = () => null;\n"
                    ),
                },
            )
            roots = [root / "apps" / "desktop" / "src"]
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module, "ALL_FRONTEND_SRC_ROOTS", roots
            ):
                violations = check_module.find_radix_import_violations()

        self.assertEqual(violations, [])

    def test_radix_import_ignored_in_block_comment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.write_files(
                root,
                {
                    "apps/desktop/src/components/Fancy.tsx": (
                        "/**\n"
                        " * Mirrors @radix-ui/react-popover's positioning contract\n"
                        " * so callers don't need to import it directly.\n"
                        " */\n"
                        "export const Fancy = () => null;\n"
                    ),
                },
            )
            roots = [root / "apps" / "desktop" / "src"]
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module, "ALL_FRONTEND_SRC_ROOTS", roots
            ):
                violations = check_module.find_radix_import_violations()

        self.assertEqual(violations, [])


class UiSrcTopLevelShapeTest(unittest.TestCase):
    def test_only_allowed_top_level_entries_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            ui_src = root / "apps" / "packages" / "ui" / "src"
            for name in check_module.UI_SRC_ALLOWED_TOP_LEVEL_ENTRIES:
                (ui_src / name).mkdir(parents=True)
            with patch.object(check_module, "UI_SRC", ui_src):
                violations = check_module.find_ui_src_top_level_violations()

        self.assertEqual(violations, [])

    def test_unexpected_top_level_entry_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            ui_src = root / "apps" / "packages" / "ui" / "src"
            (ui_src / "primitives").mkdir(parents=True)
            (ui_src / "kit").mkdir(parents=True)
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module, "UI_SRC", ui_src
            ):
                violations = check_module.find_ui_src_top_level_violations()

                self.assertEqual(len(violations), 1)
                violation = violations[0]
                self.assertEqual(violation.rule_id, "UI_SRC_TOP_LEVEL_ENTRY")
                self.assertEqual(violation.relative_path, "apps/packages/ui/src/kit")
                self.assertIn("component-library taxonomy", violation.message)

    def test_missing_ui_src_directory_produces_no_violations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            missing_ui_src = root / "apps" / "packages" / "ui" / "src"
            with patch.object(check_module, "UI_SRC", missing_ui_src):
                violations = check_module.find_ui_src_top_level_violations()

        self.assertEqual(violations, [])

    def test_dotfile_entries_are_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            ui_src = root / "apps" / "packages" / "ui" / "src"
            (ui_src / "primitives").mkdir(parents=True)
            (ui_src / ".DS_Store").write_text("", encoding="utf-8")
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module, "UI_SRC", ui_src
            ):
                violations = check_module.find_ui_src_top_level_violations()

        self.assertEqual(violations, [])


class WarningInkBoundaryTest(unittest.TestCase):
    def run_rule(self, source: str) -> list[check_module.Violation]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            ui_src = root / "apps" / "packages" / "ui" / "src"
            ui_src.mkdir(parents=True)
            (ui_src / "Sample.tsx").write_text(source, encoding="utf-8")
            empty = root / "empty"
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module, "UI_SRC", ui_src
            ), patch.multiple(
                check_module,
                PRODUCT_UI_SRC=empty,
                PRODUCT_SURFACES_SRC=empty,
                PRODUCT_CLIENT_SRC=empty,
                DESKTOP_SRC=empty,
                WEB_SRC=empty,
            ):
                return check_module.find_warning_ink_violations()

    def test_bare_text_warning_fails(self) -> None:
        violations = self.run_rule('const tone = "text-warning";\n')

        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0].rule_id, "WARNING_TOKEN_AS_INK")
        self.assertIn("text-warning-foreground", violations[0].message)

    def test_purpose_built_tokens_pass(self) -> None:
        violations = self.run_rule(
            'const tone = "border-warning-border bg-warning-subtle text-warning-foreground";\n'
        )

        self.assertEqual(violations, [])

    def test_alpha_modified_fill_and_border_fail(self) -> None:
        violations = self.run_rule('const tone = "border-warning/30 bg-warning/10";\n')

        self.assertEqual(len(violations), 2)
        self.assertEqual(
            {violation.rule_id for violation in violations}, {"WARNING_TOKEN_AS_INK"}
        )

    def test_solid_fill_is_allowed(self) -> None:
        # Using the fill token AS a fill is correct (OfflineIndicator's banner).
        violations = self.run_rule('const tone = "bg-warning text-warning-foreground";\n')

        self.assertEqual(violations, [])

    def test_commented_usage_is_ignored(self) -> None:
        violations = self.run_rule('// historical note: text-warning was wrong\n')

        self.assertEqual(violations, [])


if __name__ == "__main__":
    unittest.main()
