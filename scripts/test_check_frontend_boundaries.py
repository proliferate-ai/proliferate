from __future__ import annotations

import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from scripts import check_frontend_boundaries as check_module
from scripts import frontend_imports as frontend_imports_module
from scripts import report_frontend_structure as structure_module
from scripts.frontend_imports import collect_imports, collect_module_specifiers


class RadixImportBoundaryTest(unittest.TestCase):
    def write_files(self, directory: Path, files: dict[str, str]) -> None:
        for name, content in files.items():
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

    def test_radix_import_allowed_in_root_primitives_and_nested_patterns(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.write_files(
                root,
                {
                    "apps/packages/product-client/src/primitives/Dialog.tsx": (
                        'import * as DialogPrimitive from "@radix-ui/react-dialog";\n'
                    ),
                    "apps/packages/product-client/src/primitives/patterns/nested/CommandPalette.tsx": (
                        'import { Command } from "@radix-ui/react-dialog";\n'
                    ),
                },
            )
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module,
                "ALL_FRONTEND_SRC_ROOTS",
                [root / "apps" / "packages" / "product-client" / "src"],
            ):
                violations = check_module.find_radix_import_violations()

        self.assertEqual(violations, [])

    def test_radix_import_in_primitive_support_tiers_and_tests_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.write_files(
                root,
                {
                    "apps/packages/product-client/src/primitives/utils/radix.ts": (
                        'import { Slot } from "@radix-ui/react-slot";\n'
                    ),
                    "apps/packages/product-client/src/primitives/icons/radix.tsx": (
                        'import { Slot } from "@radix-ui/react-slot";\n'
                    ),
                    "apps/packages/product-client/src/primitives/__tests__/radix.test.ts": (
                        'import { Slot } from "@radix-ui/react-slot";\n'
                    ),
                },
            )
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module,
                "ALL_FRONTEND_SRC_ROOTS",
                [root / "apps" / "packages" / "product-client" / "src"],
            ):
                violations = check_module.find_radix_import_violations()

        self.assertEqual(len(violations), 3)
        self.assertEqual(
            {violation.rule_id for violation in violations},
            {"FE-UI-1"},
        )

    def test_radix_import_outside_ui_component_library_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.write_files(
                root,
                {
                    "apps/packages/product-client/src/components/patterns/Fancy.tsx": (
                        'import * as PopoverPrimitive from "@radix-ui/react-popover";\n'
                    ),
                    "apps/desktop/src/components/Fancy.tsx": (
                        'import { Slot } from "@radix-ui/react-slot";\n'
                    ),
                },
            )
            roots = [
                root / "apps" / "packages" / "product-client" / "src",
                root / "apps" / "desktop" / "src",
            ]
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module, "ALL_FRONTEND_SRC_ROOTS", roots
            ):
                violations = check_module.find_radix_import_violations()

                self.assertEqual(
                    {violation.rule_id for violation in violations},
                    {"FE-UI-1"},
                )
                self.assertEqual(len(violations), 2)
                relative_paths = {violation.relative_path for violation in violations}
                self.assertEqual(
                    relative_paths,
                    {
                        "apps/packages/product-client/src/components/patterns/Fancy.tsx",
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


class TailwindMergeImportBoundaryTest(unittest.TestCase):
    def write_files(self, directory: Path, files: dict[str, str]) -> None:
        for name, content in files.items():
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")

    def run_rule(
        self,
        root: Path,
    ) -> list[tuple[str, str, int]]:
        product_client_src = root / "apps/packages/product-client/src"
        roots = [
            root / "apps/desktop/src",
            root / "apps/web/src",
            root / "apps/mobile/src",
            root / "apps/packages/design/src",
            product_client_src,
        ]
        with patch.multiple(
            check_module,
            REPO_ROOT=root,
            PRODUCT_CLIENT_PRIMITIVES_SRC=product_client_src / "primitives",
            ALL_FRONTEND_SRC_ROOTS=roots,
        ):
            return sorted(
                (violation.relative_path, violation.rule_id, violation.lineno)
                for violation in check_module.find_tailwind_merge_import_violations()
            )

    def test_only_configured_product_client_wrapper_imports_tailwind_merge(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.write_files(
                root,
                {
                    "apps/packages/product-client/src/primitives/utils/tw-merge.ts": (
                        'import { extendTailwindMerge } from "tailwind-merge";\n'
                    ),
                    "apps/packages/product-client/src/components/Consumer.tsx": (
                        'import { twMerge } from "#product/primitives/utils/tw-merge";\n'
                    ),
                    "apps/web/src/PackageName.ts": (
                        'export const packageName = "tailwind-merge";\n'
                    ),
                },
            )

            violations = self.run_rule(root)

        self.assertEqual(violations, [])

    def test_direct_tailwind_merge_module_loads_fail_in_every_frontend_root(
        self,
    ) -> None:
        cases = [
            (
                "apps/packages/product-client/src/components/Static.tsx",
                'import { twMerge } from "tailwind-merge";\n',
            ),
            (
                "apps/desktop/src/Dynamic.ts",
                'export const load = () => import("tailwind-" + "merge");\n',
            ),
            (
                "apps/web/src/CommonJs.ts",
                'export const merge = require("tailwind-merge");\n',
            ),
            (
                "apps/mobile/src/ImportEquals.ts",
                'import twMerge = require("tailwind-merge");\n',
            ),
            (
                "apps/packages/design/src/ReExport.ts",
                'export { twMerge } from "tailwind-merge/subpath";\n',
            ),
            (
                "apps/desktop/src/__tests__/TailwindMerge.test.ts",
                'vi.mock("tailwind-merge", () => ({}));\n',
            ),
        ]

        for relative_path, source in cases:
            with self.subTest(path=relative_path):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory).resolve()
                    self.write_files(root, {relative_path: source})

                    violations = self.run_rule(root)

                self.assertEqual(
                    violations,
                    [
                        (
                            relative_path,
                            "FE-UI-2",
                            1,
                        )
                    ],
                )

    def test_obscured_package_spelling_remains_parser_backed(self) -> None:
        cases = [
            r'import { twMerge } from "tailw\u0069nd-merge";' "\n",
            r'import { twMerge } from "tailwind-\u006derge";' "\n",
            'import("tail" + "wind-merge");\n',
            'require("tailwind-" + "mer" + "ge");\n',
            (
                r'import("\u0074\u0061\u0069\u006c\u0077\u0069\u006e'
                r'\u0064\u002d\u006d\u0065\u0072\u0067\u0065");' "\n"
            ),
            'jest.mock("tail" + "wind-" + "merge/" + "default-config");\n',
            'import(`tail${"wind"}-merge`);\n',
            (
                'import(("tail" + (true ? "wind" : "unused") + '
                '"-merge") as string);\n'
            ),
        ]

        for source in cases:
            with self.subTest(source=source):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory).resolve()
                    relative_path = "apps/web/src/Obscured.ts"
                    self.write_files(root, {relative_path: source})

                    violations = self.run_rule(root)

                self.assertEqual(
                    violations,
                    [
                        (
                            relative_path,
                            "FE-UI-2",
                            1,
                        )
                    ],
                )

    def test_each_source_is_tokenized_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            self.write_files(
                root,
                {
                    "apps/desktop/src/Candidate.ts": (
                        'import("tail" + "wind-merge");\n'
                    ),
                },
            )
            with patch.object(
                frontend_imports_module,
                "tokenize_typescript",
                wraps=frontend_imports_module.tokenize_typescript,
            ) as tokenize_typescript:
                violations = self.run_rule(root)

        self.assertEqual(len(violations), 1)
        tokenize_typescript.assert_called_once()


class ProductClientPrimitivesTopLevelShapeTest(unittest.TestCase):
    def test_only_allowed_top_level_entries_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            primitives_src = root / "apps/packages/product-client/src/primitives"
            for name in check_module.PRODUCT_CLIENT_PRIMITIVES_ALLOWED_SUPPORT_DIRECTORIES:
                (primitives_src / name).mkdir(parents=True)
            (primitives_src / "Button.tsx").write_text("export {};\n", encoding="utf-8")
            (primitives_src / "popover-surface.ts").write_text(
                "export {};\n", encoding="utf-8"
            )
            with patch.object(
                check_module, "PRODUCT_CLIENT_PRIMITIVES_SRC", primitives_src
            ):
                violations = check_module.find_primitives_top_level_violations()

        self.assertEqual(violations, [])

    def test_unexpected_top_level_entry_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            primitives_src = root / "apps/packages/product-client/src/primitives"
            (primitives_src / "patterns").mkdir(parents=True)
            (primitives_src / "kit").mkdir(parents=True)
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module, "PRODUCT_CLIENT_PRIMITIVES_SRC", primitives_src
            ):
                violations = check_module.find_primitives_top_level_violations()

                self.assertEqual(len(violations), 1)
                violation = violations[0]
                self.assertEqual(
                    violation.rule_id, "FE-PC-7"
                )
                self.assertEqual(
                    violation.relative_path,
                    "apps/packages/product-client/src/primitives/kit",
                )
                self.assertIn("component-library taxonomy", violation.detail)

    def test_missing_primitives_directory_produces_no_violations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            missing_primitives_src = root / "apps/packages/product-client/src/primitives"
            with patch.object(
                check_module,
                "PRODUCT_CLIENT_PRIMITIVES_SRC",
                missing_primitives_src,
            ):
                violations = check_module.find_primitives_top_level_violations()

        self.assertEqual(violations, [])

    def test_dotfile_entries_are_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            primitives_src = root / "apps/packages/product-client/src/primitives"
            primitives_src.mkdir(parents=True)
            (primitives_src / ".DS_Store").write_text("", encoding="utf-8")
            with patch.object(check_module, "REPO_ROOT", root), patch.object(
                check_module, "PRODUCT_CLIENT_PRIMITIVES_SRC", primitives_src
            ):
                violations = check_module.find_primitives_top_level_violations()

        self.assertEqual(violations, [])


class WarningInkBoundaryTest(unittest.TestCase):
    def run_rule(self, source: str) -> list[check_module.Violation]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            product_client_src = root / "apps/packages/product-client/src"
            product_client_src.mkdir(parents=True)
            (product_client_src / "Sample.tsx").write_text(source, encoding="utf-8")
            empty = root / "empty"
            with patch.object(check_module, "REPO_ROOT", root), patch.multiple(
                check_module,
                PRODUCT_CLIENT_SRC=product_client_src,
                DESKTOP_SRC=empty,
                WEB_SRC=empty,
            ):
                return check_module.find_warning_ink_violations()

    def test_bare_text_warning_fails(self) -> None:
        violations = self.run_rule('const tone = "text-warning";\n')

        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0].rule_id, "FE-UI-3")
        self.assertIn("text-warning-foreground", violations[0].detail)

    def test_purpose_built_tokens_pass(self) -> None:
        violations = self.run_rule(
            'const tone = "border-warning-border bg-warning-subtle text-warning-foreground";\n'
        )

        self.assertEqual(violations, [])

    def test_alpha_modified_fill_and_border_fail(self) -> None:
        violations = self.run_rule('const tone = "border-warning/30 bg-warning/10";\n')

        self.assertEqual(len(violations), 2)
        self.assertEqual(
            {violation.rule_id for violation in violations}, {"FE-UI-3"}
        )

    def test_solid_fill_is_allowed(self) -> None:
        # Using the fill token AS a fill is correct (OfflineIndicator's banner).
        violations = self.run_rule('const tone = "bg-warning text-warning-foreground";\n')

        self.assertEqual(violations, [])

    def test_commented_usage_is_ignored(self) -> None:
        violations = self.run_rule('// historical note: text-warning was wrong\n')

        self.assertEqual(violations, [])


class ProductClientPrimitiveStructureTest(unittest.TestCase):
    def write_files(self, root: Path, files: dict[str, str]) -> list[Path]:
        paths: list[Path] = []
        for relative_path, content in files.items():
            path = root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            paths.append(path)
        return paths

    def test_raw_dom_and_primitive_definitions_are_owned_by_nested_primitives(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            product_src = root / "apps/packages/product-client/src"
            primitives_src = product_src / "primitives"
            files = self.write_files(
                root,
                {
                    "apps/packages/product-client/src/primitives/Button.tsx": (
                        "export function Button() { return <button />; }\n"
                    ),
                    "apps/packages/product-client/src/components/LocalButton.tsx": (
                        "export function Button() { return <button />; }\n"
                    ),
                },
            )
            with patch.multiple(
                structure_module,
                REPO_ROOT=root,
                PRODUCT_CLIENT_SRC=product_src,
                PRODUCT_CLIENT_PRIMITIVES_SRC=primitives_src,
                DOM_APP_AND_PACKAGE_ROOTS=[product_src],
            ):
                violations = structure_module.find_raw_dom_controls(files)
                violations += structure_module.find_primitive_definitions(files)

        self.assertEqual(len(violations), 2)
        self.assertEqual(
            {violation.path.name for violation in violations}, {"LocalButton.tsx"}
        )

    def test_nested_primitives_preserve_the_former_package_purity_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            product_src = root / "apps/packages/product-client/src"
            primitives_src = product_src / "primitives"
            files = self.write_files(
                root,
                {
                    "apps/packages/product-client/src/primitives/AliasEscape.ts": (
                        'import { View } from "#product/components/View";\n'
                    ),
                    "apps/packages/product-client/src/primitives/utils/RelativeEscape.ts": (
                        'import { model } from "../../lib/domain/model";\n'
                    ),
                    "apps/packages/product-client/src/primitives/ForbiddenPackages.ts": (
                        'import { model } from "@proliferate/product-client/internal/domain/chats/model";\n'
                        'import { cloud } from "@proliferate/cloud-sdk";\n'
                        'import { runtime } from "@anyharness/sdk";\n'
                        'import { useQuery } from "@tanstack/react-query";\n'
                    ),
                    "apps/packages/product-client/src/primitives/RootPrimitive.ts": (
                        'import React from "react";\n'
                        'import { tokens } from "@proliferate/design";\n'
                        'import { cn } from "#product/primitives/utils/class-names";\n'
                    ),
                    "apps/packages/product-client/src/primitives/patterns/Pattern.tsx": (
                        'import { Button } from "../Button";\n'
                    ),
                },
            )
            with patch.multiple(
                structure_module,
                REPO_ROOT=root,
                PRODUCT_CLIENT_SRC=product_src,
                PRODUCT_CLIENT_PRIMITIVES_SRC=primitives_src,
                PACKAGE_ROOTS={
                    "product-client-primitives": primitives_src,
                    "product-client": product_src,
                },
            ):
                violations = structure_module.find_forbidden_shared_package_imports(files)

        self.assertEqual(len(violations), 6)
        self.assertEqual(
            {violation.path.name for violation in violations},
            {"AliasEscape.ts", "RelativeEscape.ts", "ForbiddenPackages.ts"},
        )


class ProductClientBoundaryTest(unittest.TestCase):
    def write_files(self, root: Path, files: dict[str, str]) -> list[Path]:
        paths: list[Path] = []
        for relative_path, content in files.items():
            path = root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            paths.append(path)
        return paths

    def run_product_rules(
        self,
        root: Path,
        files: dict[str, str],
    ) -> list[check_module.Violation]:
        paths = self.write_files(root, files)
        product_src = root / "apps" / "packages" / "product-client" / "src"
        with patch.multiple(
            check_module,
            REPO_ROOT=root,
            PRODUCT_CLIENT_SRC=product_src,
        ):
            return [
                violation
                for path in paths
                for violation in check_module.find_product_client_violations(path)
            ]

    def test_shared_parser_retains_multiline_type_mixed_and_dynamic_facts(self) -> None:
        source = (
            "// import('apps/desktop/src/not-code')\n"
            "import type {\n"
            "  First,\n"
            "} from '#product/components/First';\n"
            "import { value, type Shape } from '#product/components/Mixed';\n"
            "const load = () => import('#product/components/Lazy');\n"
            "export type { PublicShape } from '#product/components/Public';\n"
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual([statement.lineno for statement in statements], [2, 5, 6, 7])
        self.assertEqual(
            [statement.type_only for statement in statements],
            [True, False, False, True],
        )
        self.assertEqual(
            [statement.source for statement in statements],
            [
                "#product/components/First",
                "#product/components/Mixed",
                "#product/components/Lazy",
                "#product/components/Public",
            ],
        )
        self.assertTrue(statements[0].statement.startswith("import type"))

    def test_shared_parser_handles_types_templates_jsx_regex_and_escaped_sources(self) -> None:
        source = (
            "import runtimeHook, { type HookOptions } "
            "from '@proliferate/cloud-sdk-react';\n"
            "import { type as runtimeBinding } from '@anyharness/sdk-react';\n"
            "type Hook = import('@proliferate/cloud-sdk-react').UseHook;\n"
            "const direct = import(`#product/components/Direct`);\n"
            "const nested = `${import('#product/components/Nested')}`;\n"
            "const computed = import(`#product/${from('@tauri-apps/api')}`);\n"
            "const nestedSpecifier = "
            "import(`${import('#product/components/SpecifierInner')}`);\n"
            "const prose = <code>import('apps/desktop/src/not-code')</code>;\n"
            "const regex = /import('apps\\/desktop\\/src\\/not-code')/;\n"
            "export const Demo = () => <>from '@tauri-apps/api'</>;\n"
            "export const prose = () => from('@tauri-apps/api');\n"
            "const metadata = import.meta;\n"
            "const escaped = import('@tauri\\u002dapps/api');\n"
        )

        statements = collect_imports(Path("Sample.tsx"), source)

        self.assertEqual(
            [statement.source for statement in statements],
            [
                "@proliferate/cloud-sdk-react",
                "@anyharness/sdk-react",
                "@proliferate/cloud-sdk-react",
                "#product/components/Direct",
                "#product/components/Nested",
                "#product/components/SpecifierInner",
                "@tauri-apps/api",
            ],
        )
        self.assertEqual(
            [statement.type_only for statement in statements],
            [False, False, True, False, False, False, False],
        )

    def test_shared_parser_distinguishes_control_flow_regex_from_division(self) -> None:
        source = (
            "if (ready) /import('apps\\/desktop\\/src\\/not-code')/.test(value);\n"
            "while (ready) /import('apps\\/desktop\\/src\\/not-code')/.test(value);\n"
            "for (; ready;) /import('apps\\/desktop\\/src\\/not-code')/.test(value);\n"
            "do /import('apps\\/desktop\\/src\\/not-code')/.test(value); while (ready);\n"
            "if (ready) {}\n"
            "/import('apps\\/desktop\\/src\\/not-code')/.test(value);\n"
            "const compared = value > /import('apps\\/desktop\\/src\\/not-code')/.test(value);\n"
            "const divided = total / import('#product/components/Divided').default;\n"
            "const objectDivided = {} / import('#product/components/ObjectDivided').default;\n"
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [(statement.source, statement.lineno) for statement in statements],
            [
                ("#product/components/Divided", 8),
                ("#product/components/ObjectDivided", 9),
            ],
        )

    def test_shared_parser_accepts_from_as_a_contextual_import_name(self) -> None:
        source = (
            "import { from } from '#product/components/Imported';\n"
            "export { from } from '#product/components/Exported';\n"
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in statements],
            ["#product/components/Imported", "#product/components/Exported"],
        )

    def test_shared_parser_keeps_ts_assertions_and_semicolonless_runtime_imports(self) -> None:
        source = (
            "const lazy = <unknown>import('#product/components/Lazy');\n"
            "type TypeOnly =\n"
            "  import('@proliferate/cloud-sdk-react').UseHook\n"
            "type Previous = unknown\n"
            "export default import('@proliferate/cloud-sdk-react')\n"
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in statements],
            [
                "#product/components/Lazy",
                "@proliferate/cloud-sdk-react",
                "@proliferate/cloud-sdk-react",
            ],
        )
        self.assertEqual(
            [statement.type_only for statement in statements],
            [False, True, False],
        )

        runtime_expressions = [
            "consume(import('@proliferate/cloud-sdk-react'))",
            "runtime = import('@proliferate/cloud-sdk-react')",
            "void [import('@proliferate/cloud-sdk-react')]",
            "ready ? import('@proliferate/cloud-sdk-react') : fallback",
            "const choice = ready ? value : import('@proliferate/cloud-sdk-react')",
        ]
        for expression in runtime_expressions:
            with self.subTest(expression=expression):
                statements = collect_imports(
                    Path("Sample.ts"),
                    f"type Previous = unknown\n{expression}\n",
                )
                self.assertEqual(len(statements), 1)
                self.assertFalse(statements[0].type_only)

    def test_shared_parser_recognizes_import_types_in_standard_type_positions(self) -> None:
        source = (
            "type First = import('@proliferate/cloud-sdk-react').First\n"
            "type Second = import('@proliferate/cloud-sdk-react').Second\n"
            "function take(\n"
            "  value: import('@proliferate/cloud-sdk-react').Thing,\n"
            "): void {}\n"
            "interface Shape {\n"
            "  value: import('@proliferate/cloud-sdk-react').Thing;\n"
            "}\n"
            "const ref = useRef<import('@proliferate/cloud-sdk-react').Thing>();\n"
            "const annotated: import('@proliferate/cloud-sdk-react').Thing = value;\n"
            "const runtimeDefault = (\n"
            "  value: unknown = import('@proliferate/cloud-sdk-react')\n"
            ") => value;\n"
            "const runtimeObject = {\n"
            "  value: import('@proliferate/cloud-sdk-react'),\n"
            "};\n"
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.lineno for statement in statements],
            [1, 2, 4, 7, 9, 10, 12, 15],
        )
        self.assertEqual(
            [statement.type_only for statement in statements],
            [True, True, True, True, True, True, False, False],
        )

        additional_type_positions = [
            "function read(): import('@proliferate/cloud-sdk-react').Thing {}",
            "const read = (): import('@proliferate/cloud-sdk-react').Thing => value;",
            (
                "interface Reader { "
                "read(value: import('@proliferate/cloud-sdk-react').Thing): "
                "import('@proliferate/cloud-sdk-react').Thing }"
            ),
            "class Holder { value: import('@proliferate/cloud-sdk-react').Thing; }",
            "const asserted = value as import('@proliferate/cloud-sdk-react').Thing;",
            (
                "interface Extended extends "
                "Wrapper<import('@proliferate/cloud-sdk-react').Thing> {}"
            ),
        ]
        for type_source in additional_type_positions:
            with self.subTest(type_source=type_source):
                statements = collect_imports(Path("Sample.ts"), type_source)
                self.assertTrue(statements)
                self.assertTrue(all(statement.type_only for statement in statements))

    def test_shared_parser_distinguishes_advanced_type_positions_from_runtime(self) -> None:
        runtime_expressions = [
            'function f(value = { load: import("pkg") }) {}',
            'function f(value = ready ? current : import("pkg")) {}',
            'const x = ready ? current() : import("pkg")',
            'class X { value = ready ? current : import("pkg") }',
            'let value: string\nimport("pkg")',
            'left < (await import("pkg")).default > (right)',
            'function f(): Result { return import("pkg") }',
            'const f = (): Result => import("pkg")',
            'consume(ready ? current : import("pkg"))\nconst later = () => value',
            'consume(ready ? current : import("pkg"))\nfunction later() {}',
            'const x = (value as Shape) ? current : import("pkg")',
            'const x = value satisfies Shape ? current : import("pkg")',
            'const x = { as: import("pkg") }',
            'const x = { satisfies: import("pkg") }',
            'object.as(import("pkg"))',
            (
                'const ok = (left as any) < '
                '(import("pkg") as any).Thing > (right as any)'
            ),
            'left < (import("pkg")).Thing > (right)',
            'left < import("pkg").then(load) > (right)',
            (
                'left < (ready ? import("pkg") : fallback).default '
                '> (right)'
            ),
            'import type, { Value } from "pkg"',
        ]
        for runtime_source in runtime_expressions:
            with self.subTest(runtime_source=runtime_source):
                statements = collect_imports(Path("Sample.ts"), runtime_source)
                self.assertEqual(len(statements), 1)
                self.assertFalse(statements[0].type_only)

        type_expressions = [
            'type Box<T = import("pkg").Thing> = T',
            'type Box<T extends import("pkg").Thing> = T',
            'const fn = <T extends import("pkg").Thing>(x: T) => x',
            'class Box<T extends import("pkg").Thing> {}',
            'fn?.<import("pkg").Thing>()',
            'const C = Factory<import("pkg").Thing>',
            'const x = <import("pkg").Thing>value',
            'const { x }: import("pkg").Thing = value',
            'const a = 1, b: import("pkg").Thing = value',
            'const value = source satisfies Readonly<import("pkg").Thing>',
            'const value = source as { load: import("pkg").Thing }',
            'function read(): { value: import("pkg").Thing } {}',
            'const read = (): { value: import("pkg").Thing } => value',
            'function read(cb: (value: string) => import("pkg").Thing) {}',
            'class Child extends Base<import("pkg").Thing> {}',
            'tag<import("pkg").Thing>`value`',
            'type Fn = (value: string)\n=> import("pkg").Thing',
            'type Fn = (value: string) =>\nimport("pkg").Thing',
            'left < import("pkg") > (right)',
            'select < typeof import("pkg") > (input)',
        ]
        for type_source in type_expressions:
            with self.subTest(type_source=type_source):
                statements = collect_imports(Path("Sample.ts"), type_source)
                self.assertEqual(len(statements), 1)
                self.assertTrue(statements[0].type_only)

    def test_shared_parser_stops_generic_return_types_at_runtime_bodies(self) -> None:
        runtime_sources = [
            'async function load(): Promise<unknown> { return import("function") }',
            (
                'class Loader { load(): Record<string, unknown> '
                '{ return import("class-method") } }'
            ),
            (
                'const loader = { load(): Promise<Result<Value>> '
                '{ return import("object-method") } };'
            ),
            'const load = (): Promise<unknown> => import("arrow")',
        ]
        for runtime_source in runtime_sources:
            with self.subTest(runtime_source=runtime_source):
                statements = collect_imports(Path("Sample.ts"), runtime_source)
                self.assertEqual(len(statements), 1)
                self.assertFalse(statements[0].type_only)

        paired_source = (
            'function load(): Promise<Result<Array<import("contract").Shape>>> {\n'
            '  return import("runtime");\n'
            '}\n'
        )
        paired = collect_imports(Path("Sample.ts"), paired_source)
        self.assertEqual(
            [(statement.source, statement.type_only) for statement in paired],
            [("contract", True), ("runtime", False)],
        )

        function_type_sources = [
            (
                'function read(): () => { value: import("function-type").Thing } '
                '{ throw failure }'
            ),
            (
                'const read = (): () => { value: import("arrow-type").Thing } '
                '=> value;'
            ),
        ]
        for type_source in function_type_sources:
            with self.subTest(type_source=type_source):
                statements = collect_imports(Path("Sample.ts"), type_source)
                self.assertEqual(len(statements), 1)
                self.assertTrue(statements[0].type_only)

    def test_shared_parser_preserves_semantic_static_and_dynamic_import_facts(self) -> None:
        source = (
            'import defaultName, { useQuery as query, type Shape, '
            'mutationOptions as useMutation, "getAnyHarnessClient" as make } '
            'from "pkg-a";\n'
            'import * as Namespace from "pkg-b";\n'
            'export { useMutation as mutation } from "pkg-c";\n'
            'export * from "pkg-d";\n'
            'import Equals = require("pkg-e");\n'
            'const { useQuery: dynamicQuery, other = fallback, ...rest } = '
            'await import("pkg-f");\n'
            'const dynamicNamespace: Module = await import("pkg-g");\n'
            'const client = (await import("pkg-h")).getAnyHarnessClient;\n'
            'import("pkg-i").then(async '
            '({ useInfiniteQuery: query }) => query());\n'
            'import("pkg-j").then((Query) => Query.useQuery());\n'
        )

        statements = {
            statement.source: statement
            for statement in collect_imports(Path("Sample.ts"), source)
        }

        self.assertEqual(
            statements["pkg-a"].imported_names,
            frozenset(
                {
                    "default",
                    "useQuery",
                    "Shape",
                    "mutationOptions",
                    "getAnyHarnessClient",
                }
            ),
        )
        self.assertEqual(
            statements["pkg-a"].local_bindings,
            frozenset({"defaultName", "query", "Shape", "useMutation", "make"}),
        )
        self.assertEqual(statements["pkg-b"].imported_names, frozenset({"*"}))
        self.assertEqual(
            statements["pkg-b"].namespace_bindings,
            frozenset({"Namespace"}),
        )
        self.assertEqual(statements["pkg-c"].imported_names, frozenset({"useMutation"}))
        self.assertFalse(statements["pkg-c"].local_bindings)
        self.assertEqual(statements["pkg-d"].imported_names, frozenset({"*"}))
        self.assertEqual(
            statements["pkg-e"].namespace_bindings,
            frozenset({"Equals"}),
        )
        self.assertEqual(
            statements["pkg-f"].imported_names,
            frozenset({"*", "useQuery", "other"}),
        )
        self.assertEqual(
            statements["pkg-f"].local_bindings,
            frozenset({"dynamicQuery", "other", "rest"}),
        )
        self.assertEqual(
            statements["pkg-f"].namespace_bindings,
            frozenset({"rest"}),
        )
        self.assertEqual(
            statements["pkg-g"].namespace_bindings,
            frozenset({"dynamicNamespace"}),
        )
        self.assertEqual(
            statements["pkg-h"].imported_names,
            frozenset({"getAnyHarnessClient"}),
        )
        self.assertEqual(
            statements["pkg-h"].local_bindings,
            frozenset({"client"}),
        )
        self.assertEqual(
            statements["pkg-i"].imported_names,
            frozenset({"useInfiniteQuery"}),
        )
        self.assertEqual(
            [
                (binding.name, binding.namespace)
                for binding in statements["pkg-i"].scoped_bindings
            ],
            [("query", False)],
        )
        self.assertEqual(statements["pkg-j"].imported_names, frozenset({"*"}))
        self.assertEqual(
            [
                (binding.name, binding.namespace)
                for binding in statements["pkg-j"].scoped_bindings
            ],
            [("Query", True)],
        )

    def test_shared_parser_skips_regex_after_declaration_and_catch_blocks(self) -> None:
        source = (
            "function read(): Result {}\n"
            "/import('apps\\/desktop\\/src\\/not-code')/.test(value);\n"
            "class Reader extends mixin(Base) {}\n"
            "/import('apps\\/desktop\\/src\\/not-code')/.test(value);\n"
            "try {} catch (error) {}\n"
            "/import('apps\\/desktop\\/src\\/not-code')/.test(value);\n"
            'const functionValue = function() {} / import("pkg-function");\n'
            'const classValue = class {} / import("pkg-class");\n'
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in statements],
            ["pkg-function", "pkg-class"],
        )

    def test_shared_parser_recurses_dynamic_options_and_requires_a_literal_argument(self) -> None:
        source = (
            'import("outer-a", import("inner-a"));\n'
            'import("outer-b", { with: make(import("inner-b")) });\n'
            'import((("grouped")));\n'
            'import("prefix/" + name);\n'
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in statements],
            ["outer-a", "inner-a", "outer-b", "inner-b", "grouped"],
        )

    def test_shared_parser_ends_semicolonless_static_statements_at_their_grammar_end(self) -> None:
        source = (
            'import { value } from "pkg-a"\n'
            "const unrelatedA = 1;\n"
            'import data from "pkg-b" with { type: "json" }\n'
            "const unrelatedB = 2;\n"
            'import Equals = require("pkg-c")\n'
            "const unrelatedC = 3;\n"
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.statement for statement in statements],
            [
                'import { value } from "pkg-a"',
                'import data from "pkg-b" with { type: "json" }',
                'import Equals = require("pkg-c")',
            ],
        )

    def test_shared_parser_handles_asserted_dynamic_literals_and_following_assert_calls(self) -> None:
        source = (
            'const first = import("pkg-a" as const);\n'
            'const second = import(("pkg-b" satisfies string));\n'
            'const computed = import(source satisfies string);\n'
            'import value from "pkg-c"\n'
            'assert(value)\n'
            'import data from "pkg-d" assert { type: "json" }\n'
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in statements],
            ["pkg-a", "pkg-b", "pkg-c", "pkg-d"],
        )
        self.assertEqual(statements[2].statement, 'import value from "pkg-c"')
        self.assertEqual(
            statements[3].statement,
            'import data from "pkg-d" assert { type: "json" }',
        )

    def test_shared_parser_distinguishes_regex_contexts_from_postfix_division(self) -> None:
        source = (
            "for (const item of /import('apps\\/desktop\\/src\\/of')/ as any) {}\n"
            "const contains = 'x' in /import('apps\\/desktop\\/src\\/in')/;\n"
            "const instance = value instanceof "
            "/import('apps\\/desktop\\/src\\/instanceof')/;\n"
            "const kind = typeof /import('apps\\/desktop\\/src\\/typeof')/;\n"
            "async function ratios(value: number) {\n"
            "  const asserted = value! / "
            "(await import('#product/components/Asserted')).default;\n"
            "  const incremented = value++ / "
            "(await import('#product/components/Incremented')).default;\n"
            "  const property = fixture.of / "
            "(await import('#product/components/PropertyOf')).default;\n"
            "  const of = value ?? 1;\n"
            "  const named = of / "
            "(await import('#product/components/NamedOf')).default;\n"
            "  return asserted + incremented + property + named;\n"
            "}\n"
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in statements],
            [
                "#product/components/Asserted",
                "#product/components/Incremented",
                "#product/components/PropertyOf",
                "#product/components/NamedOf",
            ],
        )

    def test_every_forbidden_layer_pair_fails_for_alias_and_relative_imports(self) -> None:
        forbidden_pairs = sorted(check_module.PRODUCT_CLIENT_FORBIDDEN_LAYER_EDGES)
        files: dict[str, str] = {}
        for index, (source_layer, target_layer) in enumerate(forbidden_pairs):
            files[f"apps/packages/product-client/src/{source_layer}/alias-{index}/Sample.ts"] = (
                f'import {{ Value }} from "#product/{target_layer}/Value";\n'
            )
            files[f"apps/packages/product-client/src/{source_layer}/relative-{index}/Sample.ts"] = (
                f'import {{ Value }} from "../../{target_layer}/Value";\n'
            )

        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        layer_violations = [
            violation
            for violation in violations
            if violation.rule_id == "FE-PC-6"
        ]
        self.assertEqual(len(layer_violations), 2 * len(forbidden_pairs))

    def test_primitives_cannot_escape_to_other_product_client_layers(self) -> None:
        files = {
            "apps/packages/product-client/src/primitives/AliasEscape.ts": (
                'import { View } from "#product/components/View";\n'
            ),
            "apps/packages/product-client/src/primitives/utils/RelativeEscape.ts": (
                'import { model } from "../../lib/domain/model";\n'
            ),
            "apps/packages/product-client/src/primitives/patterns/InternalEscape.ts": (
                "import { useThing } from "
                '"@proliferate/product-client/internal/hooks/use-thing";\n'
            ),
            "apps/packages/product-client/src/primitives/RootPrimitive.ts": (
                'import { cn } from "#product/primitives/utils/class-names";\n'
            ),
            "apps/packages/product-client/src/primitives/patterns/Pattern.tsx": (
                'import { Button } from "#product/primitives/Button";\n'
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        layer_violations = [
            violation
            for violation in violations
            if violation.rule_id == "FE-PC-6"
        ]
        self.assertEqual(
            {violation.path.name for violation in layer_violations},
            {"AliasEscape.ts", "RelativeEscape.ts", "InternalEscape.ts"},
        )

    def test_reverse_same_layer_and_lower_store_imports_pass(self) -> None:
        files = {
            "apps/packages/product-client/src/components/chat/Sample.ts": (
                'import { useThing } from "#product/hooks/chat/use-thing";\n'
            ),
            "apps/packages/product-client/src/hooks/chat/Sample.ts": (
                'import { useThing } from "#product/hooks/workspaces/use-thing";\n'
            ),
            "apps/packages/product-client/src/stores/chat/Sample.ts": (
                'import { model } from "#product/lib/domain/chat/model";\n'
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        self.assertNotIn(
            "FE-PC-6",
            {violation.rule_id for violation in violations},
        )

    def test_type_only_multiline_edge_and_dynamic_edge_report_start_lines(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/typed.ts": (
                "\nimport type {\n  Props,\n} from '#product/components/chat/View';\n"
            ),
            "apps/packages/product-client/src/hooks/chat/lazy.ts": (
                "\n\nconst load = () => import('#product/components/chat/View');\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        layer_violations = [
            violation
            for violation in violations
            if violation.rule_id == "FE-PC-6"
        ]
        self.assertEqual([violation.lineno for violation in layer_violations], [2, 3])
        self.assertIn("type-only", layer_violations[0].detail)
        self.assertIn("runtime", layer_violations[1].detail)

    def test_fixture_host_text_passes_but_real_host_import_and_tauri_global_fail(self) -> None:
        files = {
            "apps/packages/product-client/src/lib/domain/chat/fixture.ts": (
                'const sample = "apps/desktop/src/App.tsx __TAURI_INTERNALS__";\n'
                "// import '@/host-only'\n"
            ),
            "apps/packages/product-client/src/hooks/chat/host-import.ts": (
                "import thing from 'apps/desktop/src/thing';\n"
                "const tauri = window.__TAURI_INTERNALS__;\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            violations = self.run_product_rules(root, files)

        forbidden = [
            violation
            for violation in violations
            if violation.rule_id == "FE-PC-5"
        ]
        self.assertEqual(len(forbidden), 2)
        self.assertTrue(all(violation.path.name == "host-import.ts" for violation in forbidden))

    def test_imported_store_alias_set_state_fails_but_react_and_owner_calls_pass(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/external.ts": (
                "import { useChatStore as chatState } from '#product/stores/chat/chat-store';\n"
                "chatState.setState({ ready: true });\n"
                "this.setState({ ready: true });\n"
            ),
            "apps/packages/product-client/src/stores/chat/chat-store.ts": (
                "const useChatStore = { setState(_value: unknown) {} };\n"
                "useChatStore.setState({ ready: true });\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        set_state = [
            violation
            for violation in violations
            if violation.rule_id == "FE-STORE-3"
        ]
        self.assertEqual(len(set_state), 1)
        self.assertEqual(set_state[0].lineno, 2)

    def test_imported_store_set_state_respects_lexical_and_property_shadowing(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/external.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "useChatStore.setState({ top: true });\n"
                "function parameter(useChatStore: OtherObject) {\n"
                "  useChatStore.setState({ parameter: true });\n"
                "}\n"
                "const arrow = (useChatStore: OtherObject) => "
                "useChatStore.setState({ arrow: true });\n"
                "function local() {\n"
                "  const useChatStore = fixture.store;\n"
                "  useChatStore.setState({ local: true });\n"
                "}\n"
                "function destructured() {\n"
                "  const { useChatStore } = fixture;\n"
                "  useChatStore.setState({ destructured: true });\n"
                "}\n"
                "fixture.useChatStore.setState({ property: true });\n"
                "fixture?.useChatStore.setState({ optional: true });\n"
                "function unshadowed() {\n"
                "  useChatStore.setState({ nested: true });\n"
                "}\n"
                "function typed(other: ReturnType<typeof useChatStore>) {\n"
                "  useChatStore.setState({ typed: true });\n"
                "}\n"
                "function propertyParameter({ useChatStore: local }: Fixture) {\n"
                "  useChatStore.setState({ propertyParameter: true });\n"
                "  local.setState({ local: true });\n"
                "}\n"
                "function propertyDestructure() {\n"
                "  const { useChatStore: local } = fixture;\n"
                "  useChatStore.setState({ propertyDestructure: true });\n"
                "}\n"
                "function temporalDeadZone() {\n"
                "  useChatStore.setState({ localBeforeDeclaration: true });\n"
                "  const useChatStore = fixture.store;\n"
                "}\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        set_state = [
            violation
            for violation in violations
            if violation.rule_id == "FE-STORE-3"
        ]
        self.assertEqual(
            [violation.lineno for violation in set_state],
            [2, 18, 21, 24, 29],
        )

    def test_named_function_and_class_expressions_do_not_shadow_the_outer_import(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/expressions.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "const functionExpression = function useChatStore() {\n"
                "  useChatStore.setState({ innerFunctionName: true });\n"
                "};\n"
                "useChatStore.setState({ afterFunctionExpression: true });\n"
                "const classExpression = class useChatStore {\n"
                "  static update() {\n"
                "    useChatStore.setState({ innerClassName: true });\n"
                "  }\n"
                "};\n"
                "useChatStore.setState({ afterClassExpression: true });\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        set_state = [
            violation
            for violation in violations
            if violation.rule_id == "FE-STORE-3"
        ]
        self.assertEqual([violation.lineno for violation in set_state], [5, 11])

    def test_store_set_state_handles_unary_loop_parenthesized_and_optional_contexts(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/contexts.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "void function useChatStore() {\n"
                "  useChatStore.setState({ innerFunctionName: true });\n"
                "}();\n"
                "useChatStore.setState({ afterFunction: true });\n"
                "void class useChatStore {\n"
                "  static update() {\n"
                "    useChatStore.setState({ innerClassName: true });\n"
                "  }\n"
                "};\n"
                "useChatStore.setState({ afterClass: true });\n"
                "for (const useChatStore of stores) {\n"
                "  useChatStore.setState({ loopLocal: true });\n"
                "}\n"
                "useChatStore.setState({ afterLoop: true });\n"
                "(useChatStore).setState({ parenthesized: true });\n"
                "useChatStore?.setState({ optional: true });\n"
                "factory(useChatStore).setState({ returnedObject: true });\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        set_state = [
            violation
            for violation in violations
            if violation.rule_id == "FE-STORE-3"
        ]
        self.assertEqual(
            [violation.lineno for violation in set_state],
            [5, 11, 15, 16, 17],
        )

    def test_store_set_state_handles_optional_calls_operators_and_later_loop_bindings(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/contexts.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "useChatStore.setState?.({ optionalCall: true });\n"
                "useChatStore?.setState?.({ optionalReceiverAndCall: true });\n"
                "const ClassExpression = ready && class useChatStore {\n"
                "  static update() { useChatStore.setState({ innerClass: true }); }\n"
                "};\n"
                "useChatStore.setState({ afterClass: true });\n"
                "const FunctionExpression = ready || function useChatStore() {\n"
                "  useChatStore.setState({ innerFunction: true });\n"
                "};\n"
                "useChatStore.setState({ afterFunction: true });\n"
                "for (let index = 0, useChatStore = stores[index]; index < 1; index++) {\n"
                "  useChatStore.setState({ loopLocal: true });\n"
                "}\n"
                "useChatStore.setState({ afterLoop: true });\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        set_state = [
            violation
            for violation in violations
            if violation.rule_id == "FE-STORE-3"
        ]
        self.assertEqual(
            [violation.lineno for violation in set_state],
            [2, 3, 7, 11, 15],
        )

    def test_store_set_state_tracks_assertions_brackets_commas_and_namespaces(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/direct.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "(useChatStore as StoreApi<State>).setState({ asserted: true });\n"
                "(<StoreApi<State>>useChatStore).setState({ angled: true });\n"
                "useChatStore['setState']({ bracketed: true });\n"
                "(0, useChatStore).setState({ comma: true });\n"
                "factory(useChatStore).setState({ callResult: true });\n"
                "fixture.useChatStore.setState({ property: true });\n"
                "function shadowed(useChatStore: Other) { useChatStore.setState({}); }\n"
                "function defaultRead({ other = useChatStore }: Other) {\n"
                "  useChatStore.setState({ imported: true });\n"
                "}\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/static-namespace.ts": (
                "import * as Stores from '#product/stores/chat/chat-store';\n"
                "Stores.useChatStore.setState({ staticNamespace: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/dynamic-namespace.ts": (
                "const Stores = await import('#product/stores/chat/chat-store');\n"
                "Stores['useChatStore'].setState({ dynamicNamespace: true });\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        set_state = [
            (violation.path.name, violation.lineno)
            for violation in violations
            if violation.rule_id == "FE-STORE-3"
        ]
        self.assertEqual(
            set_state,
            [
                ("direct.ts", 2),
                ("direct.ts", 3),
                ("direct.ts", 4),
                ("direct.ts", 5),
                ("direct.ts", 10),
                ("static-namespace.ts", 2),
                ("dynamic-namespace.ts", 2),
            ],
        )

    def test_query_hooks_pass_in_access_and_cache_but_fail_in_workflow_and_facade(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/access/cloud/query.ts": (
                "import { useQuery } from '@tanstack/react-query';\n"
            ),
            "apps/packages/product-client/src/hooks/chat/cache/query.ts": (
                "import { useQueries } from '@tanstack/react-query';\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/action.ts": (
                "import { useMutation } from '@tanstack/react-query';\n"
            ),
            "apps/packages/product-client/src/hooks/chat/facade/model.ts": (
                "import { useSuspenseQuery } from '@tanstack/react-query';\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        query_violations = [
            violation
            for violation in violations
            if violation.rule_id == "FE-CACHE-2"
        ]
        self.assertEqual(len(query_violations), 2)
        self.assertEqual(
            {violation.path.name for violation in query_violations},
            {"action.ts", "model.ts"},
        )

    def test_query_hooks_fail_in_non_owner_lib_areas_without_duplicate_domain_rules(self) -> None:
        files = {
            "apps/packages/product-client/src/lib/access/cloud/query.ts": (
                "import { useQuery } from '@tanstack/react-query';\n"
            ),
            "apps/packages/product-client/src/lib/infra/query.ts": (
                "import { useMutation } from '@tanstack/react-query';\n"
            ),
            "apps/packages/product-client/src/lib/domain/chat/query.ts": (
                "import { useQueries } from '@tanstack/react-query';\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        query_paths = {
            violation.path.as_posix().split("/src/", 1)[1]
            for violation in violations
            if violation.rule_id == "FE-CACHE-2"
        }
        self.assertEqual(
            query_paths,
            {
                "lib/access/cloud/query.ts",
                "lib/infra/query.ts",
            },
        )
        domain_rules = [
            violation.rule_id
            for violation in violations
            if violation.path.as_posix().endswith("lib/domain/chat/query.ts")
        ]
        self.assertEqual(domain_rules, ["FE-DOMAIN-1"])

    def test_store_runtime_access_fails_but_contract_types_and_pure_sdk_helpers_pass(self) -> None:
        files = {
            "apps/packages/product-client/src/stores/chat/legal.ts": (
                "import type { TranscriptState } from '@anyharness/sdk';\n"
                "import { createTranscriptState } from '@anyharness/sdk';\n"
            ),
            "apps/packages/product-client/src/stores/chat/react-sdk.ts": (
                "import { useCloudThing } from '@proliferate/cloud-sdk-react';\n"
            ),
            "apps/packages/product-client/src/stores/chat/raw-client.ts": (
                "import { getAnyHarnessClient } from '@anyharness/sdk';\n"
            ),
            "apps/packages/product-client/src/stores/chat/cloud-constructor.ts": (
                "import { createProliferateClient } from '@proliferate/cloud-sdk';\n"
                "export const client = createProliferateClient({});\n"
            ),
            "apps/packages/product-client/src/stores/chat/runtime-constructor.ts": (
                "import { AnyHarnessClient } from '@anyharness/sdk';\n"
                "export const client = new AnyHarnessClient({ baseUrl });\n"
            ),
            "apps/packages/product-client/src/stores/chat/fetch.ts": (
                "export const load = () => fetch('/state');\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        runtime_access = [
            violation
            for violation in violations
            if violation.rule_id == "FE-STORE-2"
        ]
        self.assertEqual(
            {violation.path.name for violation in runtime_access},
            {
                "react-sdk.ts",
                "raw-client.ts",
                "cloud-constructor.ts",
                "runtime-constructor.ts",
                "fetch.ts",
            },
        )

    def test_store_import_type_expressions_and_mixed_runtime_imports_are_distinguished(self) -> None:
        files = {
            "apps/packages/product-client/src/stores/chat/type-expression.ts": (
                "type Hook = import('@proliferate/cloud-sdk-react').UseHook;\n"
            ),
            "apps/packages/product-client/src/stores/chat/mixed.ts": (
                "import runtimeHook, { type HookOptions } "
                "from '@proliferate/cloud-sdk-react';\n"
            ),
            "apps/packages/product-client/src/stores/chat/type-named-runtime.ts": (
                "import { type as runtimeBinding } from '@anyharness/sdk-react';\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        runtime_paths = {
            violation.path.name
            for violation in violations
            if violation.rule_id == "FE-STORE-2"
        }
        self.assertEqual(runtime_paths, {"mixed.ts", "type-named-runtime.ts"})

    def test_generic_return_types_do_not_hide_store_runtime_imports(self) -> None:
        files = {
            "apps/packages/product-client/src/stores/chat/function.ts": (
                "export async function load(): Promise<unknown> {\n"
                "  return import('@tanstack/react-query');\n"
                "}\n"
            ),
            "apps/packages/product-client/src/stores/chat/class-method.ts": (
                "class Loader {\n"
                "  load(): Record<string, unknown> {\n"
                "    return import('@proliferate/cloud-sdk-react');\n"
                "  }\n"
                "}\n"
            ),
            "apps/packages/product-client/src/stores/chat/object-method.ts": (
                "const loader = {\n"
                "  load(): Promise<Result<Value>> {\n"
                "    return import('@anyharness/sdk-react');\n"
                "  },\n"
                "};\n"
            ),
            "apps/packages/product-client/src/stores/chat/type-only.ts": (
                "export function contract(): "
                "Promise<import('@proliferate/cloud-sdk-react').UseHook> {\n"
                "  throw new Error('not implemented');\n"
                "}\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        runtime_paths = {
            violation.path.name
            for violation in violations
            if violation.rule_id == "FE-STORE-2"
        }
        self.assertEqual(
            runtime_paths,
            {"function.ts", "class-method.ts", "object-method.ts"},
        )

    def test_internal_store_access_has_exactly_one_rule_owner(self) -> None:
        files = {
            "apps/packages/product-client/src/stores/chat/internal-access.ts": (
                "import { getAnyHarnessClient } "
                "from '#product/lib/access/anyharness/client';\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        self.assertEqual(
            [violation.rule_id for violation in violations],
            ["FE-STORE-1"],
        )

    def test_dynamic_and_namespace_imports_preserve_identifier_sensitive_rules(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/dynamic-query.ts": (
                "export async function load() {\n"
                "  const { useMutation } = await import('@tanstack/react-query');\n"
                "  return useMutation;\n"
                "}\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/namespace-query.ts": (
                "import * as Query from '@tanstack/react-query';\n"
                "export const mutation = Query.useMutation;\n"
            ),
            "apps/packages/product-client/src/stores/chat/dynamic-client.ts": (
                "export async function load() {\n"
                "  const { getAnyHarnessClient } = await import('@anyharness/sdk');\n"
                "  return getAnyHarnessClient();\n"
                "}\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/dynamic-store.ts": (
                "export async function update() {\n"
                "  const { useChatStore } = "
                "await import('#product/stores/chat/chat-store');\n"
                "  useChatStore.setState({ ready: true });\n"
                "}\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        query_paths = {
            violation.path.name
            for violation in violations
            if violation.rule_id == "FE-CACHE-2"
        }
        self.assertEqual(
            query_paths,
            {"dynamic-query.ts", "namespace-query.ts"},
        )
        dynamic_client_rules = {
            violation.rule_id
            for violation in violations
            if violation.path.name == "dynamic-client.ts"
        }
        self.assertTrue(
            {"FE-ACCESS-2", "FE-STORE-2"}
            <= dynamic_client_rules
        )
        dynamic_store_rules = [
            violation.rule_id
            for violation in violations
            if violation.path.name == "dynamic-store.ts"
        ]
        self.assertIn(
            "FE-STORE-3",
            dynamic_store_rules,
        )

    def test_identifier_sensitive_rules_preserve_export_identity_and_namespace_scope(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/alias-safe.ts": (
                "import { mutationOptions as useMutation } "
                "from '@tanstack/react-query';\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/alias-real.ts": (
                "import { useMutation as mutate } from '@tanstack/react-query';\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/namespace-shadow.ts": (
                "import * as Query from '@tanstack/react-query';\n"
                "function local(Query: Other) { Query.useQuery(); }\n"
                "fixture.Query.useMutation();\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/namespace-used.ts": (
                "import * as Query from '@tanstack/react-query';\n"
                "Query['useInfiniteQuery']();\n"
                "const { useMutation: mutate } = Query;\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/dynamic-then.ts": (
                "import('@tanstack/react-query').then("
                "({ useQuery: query }) => query());\n"
            ),
            "apps/packages/product-client/src/stores/chat/raw-alias-safe.ts": (
                "import { createTranscriptState as getAnyHarnessClient } "
                "from '@anyharness/sdk';\n"
            ),
            "apps/packages/product-client/src/stores/chat/raw-string-name.ts": (
                "import { 'getAnyHarnessClient' as makeClient } "
                "from '@anyharness/sdk';\n"
            ),
            "apps/packages/product-client/src/stores/chat/raw-dynamic-member.ts": (
                "const makeClient = (await import('@anyharness/sdk'))"
                ".getAnyHarnessClient;\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        query_paths = {
            violation.path.name
            for violation in violations
            if violation.rule_id == "FE-CACHE-2"
        }
        self.assertEqual(
            query_paths,
            {"alias-real.ts", "namespace-used.ts", "dynamic-then.ts"},
        )
        raw_rules = {
            (violation.path.name, violation.rule_id)
            for violation in violations
            if violation.path.name.startswith("raw-")
        }
        self.assertEqual(
            raw_rules,
            {
                ("raw-string-name.ts", "FE-ACCESS-2"),
                ("raw-string-name.ts", "FE-STORE-2"),
                ("raw-dynamic-member.ts", "FE-ACCESS-2"),
                ("raw-dynamic-member.ts", "FE-STORE-2"),
            },
        )

    def test_dynamic_then_bindings_are_checked_only_inside_their_callbacks(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/async-query.ts": (
                "import('@tanstack/react-query').then(async "
                "({ useQuery: query }) => query());\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/namespace-query.ts": (
                "import('@tanstack/react-query').then("
                "Query => Query.useInfiniteQuery());\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/generic-namespace-query.ts": (
                "import('@tanstack/react-query').then<void>("
                "Query => void Query.useMutation());\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/sibling-safe.ts": (
                "import('@tanstack/react-query').then("
                "Query => void Query.QueryClient, "
                "Query => Query.useMutation());\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/block-sibling-safe.ts": (
                "async function inspect() {\n"
                "  if (ready) {\n"
                "    const Query = await import('@tanstack/react-query');\n"
                "    void Query.QueryClient;\n"
                "  }\n"
                "  if (other) {\n"
                "    const Query = fixture.query;\n"
                "    Query.useQuery();\n"
                "  }\n"
                "}\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        query_paths = {
            violation.path.name
            for violation in violations
            if violation.rule_id == "FE-CACHE-2"
        }
        self.assertEqual(
            query_paths,
            {"async-query.ts", "namespace-query.ts", "generic-namespace-query.ts"},
        )

    def test_dynamic_and_static_namespace_store_aliases_cannot_mutate_state(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/dynamic-destructure.ts": (
                "import('#product/stores/chat/chat-store').then("
                "({ useChatStore: chat }) => chat.setState({ ready: true }));\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/dynamic-namespace.ts": (
                "import('#product/stores/chat/chat-store').then(Stores => {\n"
                "  const { useChatStore: chat } = Stores\n"
                "  chat.setState({ ready: true });\n"
                "});\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/static-namespace.ts": (
                "import * as Stores from '#product/stores/chat/chat-store';\n"
                "const { useChatStore: chat } = Stores, marker = 1;\n"
                "chat.setState({ ready: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/asserted-namespace.ts": (
                "import * as Stores from '#product/stores/chat/chat-store';\n"
                "const { useChatStore: chat } = Stores satisfies typeof Stores;\n"
                "chat.setState({ ready: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/direct-alias.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "const chat = useChatStore;\n"
                "chat.setState({ ready: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/member-alias.ts": (
                "import * as Stores from '#product/stores/chat/chat-store';\n"
                "const chat = Stores.useChatStore;\n"
                "chat.setState({ ready: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/asserted-direct-alias.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "const chat = useChatStore as StoreApi<State>;\n"
                "chat.setState({ ready: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/comma-alias-safe.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "const chat = (useChatStore, fixture.store);\n"
                "chat.setState({ unrelated: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/member-comma-alias-safe.ts": (
                "import * as Stores from '#product/stores/chat/chat-store';\n"
                "const chat = (Stores.useChatStore, fixture.store);\n"
                "chat.setState({ unrelated: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/comma-last-alias.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "const chat = (fixture.store, useChatStore);\n"
                "chat.setState({ ready: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/member-comma-last-alias.ts": (
                "import * as Stores from '#product/stores/chat/chat-store';\n"
                "const chat = (fixture.store, Stores.useChatStore);\n"
                "chat.setState({ ready: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/member-target-safe.ts": (
                "import * as Stores from '#product/stores/chat/chat-store';\n"
                "({ useChatStore: target.store } = Stores);\n"
                "target.setState({ unrelated: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/block-sibling-safe.ts": (
                "async function inspect() {\n"
                "  if (ready) {\n"
                "    const Stores = await "
                "import('#product/stores/chat/chat-store');\n"
                "    void Stores.useChatStore;\n"
                "  }\n"
                "  if (other) {\n"
                "    const Stores = fixture.stores;\n"
                "    Stores.useChatStore.setState({ local: true });\n"
                "  }\n"
                "}\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        set_state_paths = {
            violation.path.name
            for violation in violations
            if violation.rule_id == "FE-STORE-3"
        }
        self.assertEqual(
            set_state_paths,
            {
                "dynamic-destructure.ts",
                "dynamic-namespace.ts",
                "static-namespace.ts",
                "asserted-namespace.ts",
                "direct-alias.ts",
                "member-alias.ts",
                "asserted-direct-alias.ts",
                "comma-last-alias.ts",
                "member-comma-last-alias.ts",
            },
        )

    def test_store_alias_tracking_distinguishes_calls_from_comma_expressions(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/call-result.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "const chat = selectStore(value, useChatStore);\n"
                "chat.setState({ unrelated: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/comma-result.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "const chat = (value, useChatStore);\n"
                "chat.setState({ ready: true });\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        set_state = [
            (violation.path.name, violation.lineno)
            for violation in violations
            if violation.rule_id == "FE-STORE-3"
        ]
        self.assertEqual(set_state, [("comma-result.ts", 3)])

    def test_domain_and_workflow_purity_covers_react_package_subpaths(self) -> None:
        files = {
            "apps/packages/product-client/src/lib/domain/chat/react.ts": (
                "import { jsx } from 'react/jsx-runtime';\n"
                "import type { UseQueryResult } "
                "from '@tanstack/react-query/build/legacy';\n"
            ),
            "apps/packages/product-client/src/lib/workflows/chat/react.ts": (
                "import { createRoot } from 'react-dom/client';\n"
                "import { useQuery } from '@tanstack/react-query/experimental';\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        purity_rules = [
            violation.rule_id
            for violation in violations
            if violation.rule_id
            in {"FE-DOMAIN-1", "FE-DOMAIN-2"}
        ]
        self.assertEqual(
            purity_rules,
            [
                "FE-DOMAIN-1",
                "FE-DOMAIN-1",
                "FE-DOMAIN-2",
                "FE-DOMAIN-2",
            ],
        )

    def test_for_initializer_imports_and_function_scoped_var_shadows_are_distinguished(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/workflows/for-query.ts": (
                "async function inspect() {\n"
                "  for (const Query = await import('@tanstack/react-query'); ready;) {\n"
                "    Query.useMutation();\n"
                "    break;\n"
                "  }\n"
                "}\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/for-store.ts": (
                "async function update() {\n"
                "  for (const Stores = await "
                "import('#product/stores/chat/chat-store'); ready;) {\n"
                "    Stores.useChatStore.setState({ ready: true });\n"
                "    break;\n"
                "  }\n"
                "}\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/var-store.ts": (
                "import { useChatStore } from '#product/stores/chat/chat-store';\n"
                "function local() {\n"
                "  if (ready) { var useChatStore = fixture.store; }\n"
                "  useChatStore.setState({ local: true });\n"
                "}\n"
                "useChatStore.setState({ imported: true });\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/var-query-safe.ts": (
                "import * as Query from '@tanstack/react-query';\n"
                "function local() {\n"
                "  if (ready) { var Query = fixture.query; }\n"
                "  Query.useQuery();\n"
                "}\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        query_paths = {
            violation.path.name
            for violation in violations
            if violation.rule_id == "FE-CACHE-2"
        }
        self.assertEqual(query_paths, {"for-query.ts"})
        set_state = [
            (violation.path.name, violation.lineno)
            for violation in violations
            if violation.rule_id == "FE-STORE-3"
        ]
        self.assertEqual(set_state, [("for-store.ts", 3), ("var-store.ts", 6)])

    def test_executable_template_and_jsx_code_is_checked_but_display_text_and_regex_pass(self) -> None:
        files = {
            "apps/packages/product-client/src/hooks/chat/template.ts": (
                "const direct = import(`#product/components/Direct`);\n"
                "const nested = `${import('#product/components/Nested')}`;\n"
                "const tauri = `${window.__TAURI_INTERNALS__}`;\n"
                "const divided = numerator / import('#product/components/Divided');\n"
            ),
            "apps/packages/product-client/src/hooks/chat/display.tsx": (
                "export const Demo = () => (\n"
                "  <code>import('apps/desktop/src/not-code') "
                "from '@tauri-apps/api' __TAURI_INTERNALS__</code>\n"
                ");\n"
                "const pattern = /import('apps\\/desktop\\/src\\/not-code')/;\n"
                "const executable = <code>{import('#product/components/InExpression')}</code>;\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        relevant = [
            violation
            for violation in violations
            if violation.rule_id
            in {"FE-PC-6", "FE-PC-5"}
        ]
        self.assertEqual(len(relevant), 5)
        self.assertEqual(
            [violation.lineno for violation in relevant],
            [1, 2, 4, 3, 5],
        )

    def test_product_client_generalizes_existing_access_and_lib_purity_rules(self) -> None:
        files = {
            "apps/packages/product-client/src/components/chat/Raw.tsx": (
                "import { probe } from '#product/lib/access/cloud/probe';\n"
            ),
            "apps/packages/product-client/src/stores/chat/state.ts": (
                "import type { Snapshot } from '#product/lib/access/cloud/snapshot';\n"
            ),
            "apps/packages/product-client/src/hooks/chat/workflows/raw-client.ts": (
                "import { getAnyHarnessClient } from '@anyharness/sdk-react';\n"
            ),
            "apps/packages/product-client/src/lib/domain/chat/model.ts": (
                "import React from 'react';\n"
                "import type { Raw } from '#product/lib/access/cloud/raw';\n"
            ),
            "apps/packages/product-client/src/lib/workflows/chat/run.ts": (
                "import type { QueryClient } from '@tanstack/react-query';\n"
                "import { raw } from '#product/lib/access/cloud/raw';\n"
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_product_rules(Path(directory).resolve(), files)

        counts: dict[str, int] = {}
        for violation in violations:
            counts[violation.rule_id] = counts.get(violation.rule_id, 0) + 1
        self.assertEqual(counts.get("FE-COMPONENT-1"), 1)
        self.assertEqual(counts.get("FE-STORE-1"), 1)
        self.assertEqual(counts.get("FE-ACCESS-2"), 1)
        self.assertEqual(counts.get("FE-DOMAIN-1"), 2)
        self.assertEqual(counts.get("FE-DOMAIN-2"), 2)

    def test_exact_junk_drawer_names_fail_but_descriptive_helpers_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            files = self.write_files(
                root,
                {
                    "apps/packages/product-client/src/lib/domain/chat/utils.ts": "export {};\n",
                    "apps/packages/product-client/src/lib/domain/chat/session-runtime-helpers.ts": "export {};\n",
                    "apps/packages/design/src/utils.ts": "export {};\n",
                },
            )
            with patch.multiple(
                structure_module,
                REPO_ROOT=root,
                PRODUCT_CLIENT_SRC=root / "apps/packages/product-client/src",
            ):
                violations = structure_module.find_junk_drawer_filename_violations(files)

        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0].path.name, "utils.ts")

    def test_generic_return_types_do_not_hide_domain_runtime_imports(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            paths = self.write_files(
                root,
                {
                    "apps/packages/product-client/src/domain/runtime.ts": (
                        "export async function load(): Promise<void> {\n"
                        "  const { createProliferateClient } = "
                        "await import('@proliferate/cloud-sdk');\n"
                        "  return createProliferateClient({});\n"
                        "}\n"
                    ),
                    "apps/packages/product-client/src/domain/type-only.ts": (
                        "export function contract(): "
                        "Promise<Result<Array<"
                        "import('@proliferate/cloud-sdk').CloudWorkspace>>> {\n"
                        "  throw new Error('not implemented');\n"
                        "}\n"
                    ),
                },
            )
            package_root = root / "apps/packages/product-client/src/domain"
            with patch.multiple(
                structure_module,
                REPO_ROOT=root,
                PACKAGE_ROOTS={"product-client-domain": package_root},
            ):
                violations = structure_module.find_forbidden_shared_package_imports(paths)

        self.assertEqual(
            [
                (violation.path.name, violation.rule_id, violation.lineno)
                for violation in violations
            ],
            [("runtime.ts", "FE-STRUCT-7", 2)],
        )

    def test_new_site_in_grandfathered_file_and_stale_entry_both_fail(self) -> None:
        """The property a per-file count could not express.

        A count of 1 for this file tolerated any single hit, so repairing the
        listed site and introducing a different one netted to zero. Site-level
        entries make each half fail on its own: the unlisted site is a failure
        even though its file is grandfathered, and the listed site going quiet is
        a stale entry.
        """
        rule_id = "FE-PC-6"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            path = root / "apps/packages/product-client/src/hooks/chat/sample.ts"
            path.parent.mkdir(parents=True)
            path.write_text("export {};\n", encoding="utf-8")
            relative_path = path.relative_to(root).as_posix()
            granted = "#product/components/chat/Listed"
            ledger = {rule_id: {(relative_path, granted)}}

            listed = check_module.Violation(rule_id, path, 1, granted, "listed")
            unlisted = check_module.Violation(
                rule_id, path, 2, "#product/components/chat/New", "new"
            )

            # Both sites present: the grandfathered one passes, the new one fails.
            with patch.multiple(
                check_module,
                REPO_ROOT=root,
                tolerated_sites=lambda: ledger,
                collect_violations=lambda: [listed, unlisted],
            ), redirect_stdout(StringIO()) as output:
                self.assertEqual(check_module.main(), 1)
            printed = output.getvalue()
            self.assertIn(rule_id, printed)
            # The unlisted site is reported; the grandfathered one is silent.
            self.assertIn("found: new", printed)
            self.assertNotIn("found: listed", printed)

            # Listed site repaired, nothing left: its entry is now stale.
            with patch.multiple(
                check_module,
                REPO_ROOT=root,
                tolerated_sites=lambda: ledger,
                collect_violations=lambda: [],
            ), redirect_stdout(StringIO()) as output:
                self.assertEqual(check_module.main(), 1)
            printed = output.getvalue()
            self.assertIn("Stale frontend exception entries:", printed)
            self.assertIn(granted, printed)

            # Only the listed site: clean, which is what carry-forward means.
            with patch.multiple(
                check_module,
                REPO_ROOT=root,
                tolerated_sites=lambda: ledger,
                collect_violations=lambda: [listed],
            ), redirect_stdout(StringIO()):
                self.assertEqual(check_module.main(), 0)


class ModuleSpecifierCollectorTest(unittest.TestCase):
    def test_runtime_names_preserve_mixed_type_value_semantics(self) -> None:
        source = (
            'import { createTranscriptState, type TranscriptState } from "@anyharness/sdk";\n'
            'export { reduceEvents, type SessionEvent } from "@anyharness/sdk";\n'
            'import type { CloudWorkspace } from "@proliferate/cloud-sdk";\n'
            'import "side-effect";\n'
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.runtime_imported_names for statement in statements],
            [
                frozenset({"createTranscriptState"}),
                frozenset({"reduceEvents"}),
                frozenset(),
                frozenset({"*"}),
            ],
        )

    def test_augmented_collector_adds_literal_require_and_test_mocks_once(self) -> None:
        source = (
            'import Equals = require("import-equals");\n'
            'const common = require("common-js");\n'
            'vi.mock("vitest-mock", () => ({}));\n'
            'jest.mock(("jest-mock" as const));\n'
            'object.require("property-not-a-load");\n'
            'require("computed/" + name);\n'
            'foo((require))!("argument-not-a-load");\n'
            'foo((vi)).mock("receiver-not-the-api");\n'
            '(object.require)!("grouped-property-not-a-load");\n'
            '(vi, other).mock("runtime-choice-not-the-api");\n'
            'object.require?.("optional-property-not-a-load");\n'
            '(object.require)?.("grouped-optional-property-not-a-load");\n'
            '(other, require)?.("optional-choice-not-a-load");\n'
            'vi.mock?.("optional-mock-not-hoisted");\n'
            'vi?.mock("optional-receiver-not-hoisted");\n'
            'vi["mock"]("computed-mock-not-hoisted");\n'
            '// require("comment-only");\n'
        )

        statements = collect_module_specifiers(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in statements],
            ["import-equals", "common-js", "vitest-mock", "jest-mock"],
        )
        self.assertTrue(
            all(
                statement.runtime_imported_names == frozenset({"*"})
                for statement in statements
            )
        )

    def test_augmented_collector_accepts_non_null_and_generic_loader_calls(self) -> None:
        source = (
            'const required = require!("require-non-null");\n'
            'const generic = require<ModuleShape>("require-generic");\n'
            'vi.mock!("vi-non-null");\n'
            'vi.mock<ModuleShape>("vi-generic");\n'
            'jest.mock!<ModuleShape>("jest-both");\n'
            'jest.mock<() => ModuleShape>("jest-function-type");\n'
            'vi.mock<">">("vi-literal-type");\n'
            'vi!.mock("vi-receiver-non-null");\n'
            '(jest!).mock("jest-grouped-receiver");\n'
            '(vi)!.mock<ModuleShape>("vi-grouped-receiver");\n'
            '(require)("require-grouped-plain");\n'
            '(require)!<ModuleShape>("require-grouped-generic");\n'
            '((require))!("require-double-grouped");\n'
            '(vi.mock)!("vi-grouped-callee");\n'
            '(jest.mock as MockFn)("jest-asserted-callee");\n'
        )

        statements = collect_module_specifiers(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in statements],
            [
                "require-non-null",
                "require-generic",
                "vi-non-null",
                "vi-generic",
                "jest-both",
                "jest-function-type",
                "vi-literal-type",
                "vi-receiver-non-null",
                "jest-grouped-receiver",
                "vi-grouped-receiver",
                "require-grouped-plain",
                "require-grouped-generic",
                "require-double-grouped",
                "vi-grouped-callee",
                "jest-asserted-callee",
            ],
        )

    def test_augmented_collector_accepts_assertions_and_escaped_identifiers(self) -> None:
        source = (
            '(<typeof require>require)(<string>"angle-require");\n'
            '(<typeof vi>vi).mock(("angle-vi"!));\n'
            '(<typeof jest>jest)!.mock<ModuleShape>(<string>"angle-jest");\n'
            r'requ\u0069re("escaped-require");' "\n"
            r'v\u{69}.m\u006fck("escaped-vi");' "\n"
            r'j\u0065st.mock("escaped-jest");' "\n"
        )

        statements = collect_module_specifiers(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in statements],
            [
                "angle-require",
                "angle-vi",
                "angle-jest",
                "escaped-require",
                "escaped-vi",
                "escaped-jest",
            ],
        )

    def test_collectors_evaluate_finite_metro_request_expressions(self) -> None:
        source = (
            'import("dynamic-" + "concat");\n'
            'import(`dynamic-${"template"}`);\n'
            'import(true ? "dynamic-conditional" : unknown);\n'
            'import(",");\n'
            'require?.("optional-require");\n'
            '(require)?.<ModuleShape>("optional-generic");\n'
            'require("" + "empty-prefix");\n'
            'require("" || "logical-require");\n'
            'require((0, "sequence-require"));\n'
            'require("(");\n'
            'require("<" + "angle-fragment");\n'
            'require(("!", "punctuation-sequence"));\n'
            'require("!" && "punctuation-logical");\n'
            'require("!" ? "punctuation-conditional" : unknown);\n'
            'vi.mock("mock-" + "concat");\n'
            'jest.mock(`${"nested-" + "template"}/${`inner-${"value"}`}`);\n'
        )

        imports = collect_imports(Path("Sample.ts"), source)
        statements = collect_module_specifiers(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in imports],
            [
                "dynamic-concat",
                "dynamic-template",
                "dynamic-conditional",
                ",",
            ],
        )
        self.assertEqual(
            [statement.source for statement in statements],
            [
                "dynamic-concat",
                "dynamic-template",
                "dynamic-conditional",
                ",",
                "optional-require",
                "optional-generic",
                "empty-prefix",
                "logical-require",
                "sequence-require",
                "(",
                "<angle-fragment",
                "punctuation-sequence",
                "punctuation-logical",
                "punctuation-conditional",
                "mock-concat",
                "nested-template/inner-value",
            ],
        )

    def test_computed_requests_fail_closed_without_losing_nested_imports(self) -> None:
        source = (
            'import("dynamic-prefix/" + name + "/suffix");\n'
            'require("require-prefix/" + name);\n'
            'vi.mock(`mock-prefix/${"fragment"}/${name}`);\n'
            'jest.mock(`mock-prefix/${/ignored/}/${"fragment"}`);\n'
            'require(`outer/${import("nested-inner")}/${name}`);\n'
            'require(`known-${true ? "outer" : import("nested-dead")}`);\n'
        )

        imports = collect_imports(Path("Sample.ts"), source)
        statements = collect_module_specifiers(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.source for statement in imports],
            ["nested-inner", "nested-dead"],
        )
        self.assertEqual(
            [statement.source for statement in statements],
            ["nested-inner", "known-outer", "nested-dead"],
        )

    def test_lone_named_type_binding_is_a_runtime_symbol(self) -> None:
        source = (
            'import { type } from "imported";\n'
            'export { type } from "exported";\n'
            'import { type Contract } from "type-only";\n'
            'type Module = typeof import("module-type");\n'
        )

        statements = collect_imports(Path("Sample.ts"), source)

        self.assertEqual(
            [statement.runtime_imported_names for statement in statements],
            [
                frozenset({"type"}),
                frozenset({"type"}),
                frozenset(),
                frozenset(),
            ],
        )
        self.assertEqual(statements[-1].imported_names, frozenset({"*"}))


class ProductClientDomainBoundaryTest(unittest.TestCase):
    def write_files(self, root: Path, files: dict[str, str]) -> list[Path]:
        paths: list[Path] = []
        for relative_path, content in files.items():
            path = root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            paths.append(path)
        return paths

    def run_domain_rules(
        self, root: Path, files: dict[str, str]
    ) -> list[check_module.Violation]:
        paths = self.write_files(root, files)
        product_src = root / "apps/packages/product-client/src"
        domain_src = product_src / "domain"
        with patch.multiple(
            check_module,
            REPO_ROOT=root,
            PRODUCT_CLIENT_SRC=product_src,
            PRODUCT_CLIENT_DOMAIN_SRC=domain_src,
        ):
            return [
                violation
                for path in paths
                if path.suffix in {".ts", ".tsx"}
                for violation in check_module.find_product_client_domain_violations(path)
            ]

    def test_domain_allows_exact_types_helpers_relative_imports_and_fixtures(self) -> None:
        files = {
            "apps/packages/product-client/src/domain/model.ts": "export type Model = {};\n",
            "apps/packages/product-client/src/domain/allowed.ts": (
                'import type { CloudWorkspace } from "@proliferate/cloud-sdk";\n'
                "import {\n"
                "  createTranscriptState,\n"
                "  type TranscriptState,\n"
                '} from "@anyharness/sdk";\n'
                "import type { FeedWebSocketAuthTransport, SessionMcpTransport } "
                'from "@anyharness/sdk";\n'
                'export { reduceEvents } from "@anyharness/sdk";\n'
                'import { parseToolBackgroundWork } from "@anyharness/sdk";\n'
                'import type { Model } from "./model";\n'
                "const load = () => import(\"@anyharness/sdk\").then("
                "({ deriveCanonicalPlan }) => deriveCanonicalPlan);\n"
            ),
            "apps/packages/product-client/src/domain/workflows/definition-v2.test.ts": (
                'import { describe } from "vitest";\n'
                "import v2Full from "
                '"../../../../../../fixtures/contracts/workflow-definition/v2-full.json";\n'
            ),
            "apps/packages/product-client/src/domain/chats/transcript/transcript-presentation.test.ts": (
                'import { it } from "vitest";\n'
                "import claude from "
                '"../../../../../../../fixtures/contracts/native-subagent-transcript/claude.json";\n'
                "import codex from "
                '"../../../../../../../fixtures/contracts/native-subagent-transcript/codex.json";\n'
            ),
            "fixtures/contracts/workflow-definition/v2-full.json": "{}\n",
            "fixtures/contracts/native-subagent-transcript/claude.json": "{}\n",
            "fixtures/contracts/native-subagent-transcript/codex.json": "{}\n",
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_domain_rules(Path(directory).resolve(), files)

        self.assertEqual(violations, [])

    def test_client_core_type_plumbing_fails_boundary_and_structure(self) -> None:
        raw_names = (
            "AnyHarnessClient",
            "AnyHarnessClientOptions",
            "AnyHarnessError",
            "AnyHarnessMeasurementOperationId",
            "AnyHarnessRequestOptions",
            "AnyHarnessRequestStartEvent",
            "AnyHarnessRequestTimingLifecycle",
            "AnyHarnessTimingCategory",
            "AnyHarnessTimingEvent",
            "AnyHarnessTimingObserver",
            "AnyHarnessTimingScope",
            "AnyHarnessTransport",
        )
        self.assertEqual(
            set(raw_names),
            check_module.PRODUCT_CLIENT_DOMAIN_RAW_ANYHARNESS_CLIENT_CORE_IMPORTS,
        )
        self.assertEqual(
            check_module.PRODUCT_CLIENT_DOMAIN_RAW_ANYHARNESS_CLIENT_CORE_IMPORTS,
            structure_module.PRODUCT_CLIENT_DOMAIN_RAW_ANYHARNESS_CLIENT_CORE_IMPORTS,
        )
        self.assertEqual(
            check_module.PRODUCT_CLIENT_DOMAIN_RAW_CLOUD_CLIENT_IMPORTS,
            structure_module.PRODUCT_CLIENT_DOMAIN_RAW_CLOUD_CLIENT_IMPORTS,
        )
        prefix = "apps/packages/product-client/src/domain"
        files = {
            f"{prefix}/raw-client-core-{index}.ts": (
                f'import type {{ {name} }} from "@anyharness/sdk";\n'
            )
            for index, name in enumerate(raw_names)
        }
        files[f"{prefix}/allowed-data-transports.ts"] = (
            "import type { CreateSessionRequest, FeedWebSocketAuthTransport, "
            "SessionMcpTransport, TerminalWebSocketAuthTransport } "
            'from "@anyharness/sdk";\n'
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            paths = self.write_files(root, files)
            product_src = root / "apps/packages/product-client/src"
            domain_src = product_src / "domain"
            with patch.multiple(
                check_module,
                REPO_ROOT=root,
                PRODUCT_CLIENT_SRC=product_src,
                PRODUCT_CLIENT_DOMAIN_SRC=domain_src,
            ):
                boundary_violations = [
                    violation
                    for path in paths
                    for violation in check_module.find_product_client_domain_violations(
                        path
                    )
                ]
            with patch.multiple(
                structure_module,
                REPO_ROOT=root,
                PRODUCT_CLIENT_SRC=product_src,
                PRODUCT_CLIENT_DOMAIN_SRC=domain_src,
                PACKAGE_ROOTS={
                    "product-client-domain": domain_src,
                    "product-client": product_src,
                },
            ):
                structure_violations = (
                    structure_module.find_forbidden_shared_package_imports(paths)
                )

        expected_paths = {
            f"raw-client-core-{index}.ts" for index in range(len(raw_names))
        }
        self.assertEqual(
            {violation.path.name for violation in boundary_violations},
            expected_paths,
        )
        self.assertEqual(
            {violation.path.name for violation in structure_violations},
            expected_paths,
        )

    def test_domain_rejects_every_forbidden_dependency_family_and_api(self) -> None:
        prefix = "apps/packages/product-client/src/domain"
        files = {
            f"{prefix}/react.ts": 'import React from "react";\n',
            f"{prefix}/dom.ts": 'import { createRoot } from "react-dom/client";\n',
            f"{prefix}/native.ts": 'import { View } from "react-native";\n',
            f"{prefix}/query.ts": 'import { useQuery } from "@tanstack/react-query";\n',
            f"{prefix}/cloud-react.ts": (
                'import { useCloud } from "@proliferate/cloud-sdk-react";\n'
            ),
            f"{prefix}/runtime-cloud.ts": (
                'import { createClient, type CloudWorkspace } from "@proliferate/cloud-sdk";\n'
            ),
            f"{prefix}/runtime-anyharness.ts": (
                'import { AnyHarnessClient, type TranscriptState } from "@anyharness/sdk";\n'
            ),
            f"{prefix}/type-cloud-client.ts": (
                "import type { CreateProliferateClientOptions, "
                "ProliferateCloudClient, ProliferateOpenApiClient } "
                'from "@proliferate/cloud-sdk";\n'
            ),
            f"{prefix}/type-anyharness-client.ts": (
                "import type { AnyHarnessClient, AnyHarnessClientOptions, "
                "AnyHarnessRequestOptions, AnyHarnessTransport } "
                'from "@anyharness/sdk";\n'
            ),
            f"{prefix}/type-anyharness-module.ts": (
                'type Sdk = typeof import("@anyharness/sdk");\n'
            ),
            f"{prefix}/lone-type-runtime.ts": (
                'import { type } from "@anyharness/sdk";\n'
            ),
            f"{prefix}/sdk-react.ts": (
                'import { getAnyHarnessClient } from "@anyharness/sdk-react";\n'
            ),
            f"{prefix}/self-alias.ts": (
                'import { model } from "#product/domain/chats/model";\n'
            ),
            f"{prefix}/self-package.ts": (
                "import { model } from "
                '"@proliferate/product-client/internal/domain/chats/model";\n'
            ),
            f"{prefix}/ui.ts": (
                'import { Button } from "#product/primitives/Button";\n'
                'import { Screen } from "#product/components/Screen";\n'
                'import { useThing } from "#product/hooks/use-thing";\n'
                'import { store } from "#product/stores/store";\n'
                'import { access } from "#product/lib/access/cloud/access";\n'
                'import { host } from "#product/host/product-host";\n'
            ),
            f"{prefix}/styles.ts": 'import "./styles.css";\n',
            f"{prefix}/tauri.ts": 'import { invoke } from "@tauri-apps/api/core";\n',
            f"{prefix}/browser.ts": 'import * as Browser from "expo-web-browser";\n',
            f"{prefix}/call-loads.test.ts": (
                'const react = require("react");\n'
                'vi.mock("@proliferate/product-client/internal/components/View");\n'
                'jest.mock("@anyharness/sdk-react");\n'
            ),
            f"{prefix}/globals.test.ts": (
                "window.location.reload();\n"
                "document.createElement('div');\n"
                "void __TAURI_INTERNALS__;\n"
            ),
            f"{prefix}/jsx.tsx": "export const View = () => <div />;\n",
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_domain_rules(Path(directory).resolve(), files)

        rule_ids = {violation.rule_id for violation in violations}
        self.assertIn("FE-PC-2", rule_ids)
        self.assertIn("FE-PC-4", rule_ids)
        self.assertIn("FE-PC-1", rule_ids)
        self.assertTrue(
            {
                "react.ts",
                "dom.ts",
                "native.ts",
                "query.ts",
                "cloud-react.ts",
                "runtime-cloud.ts",
                "runtime-anyharness.ts",
                "type-cloud-client.ts",
                "type-anyharness-client.ts",
                "type-anyharness-module.ts",
                "lone-type-runtime.ts",
                "sdk-react.ts",
                "self-alias.ts",
                "self-package.ts",
                "ui.ts",
                "styles.ts",
                "tauri.ts",
                "browser.ts",
                "call-loads.test.ts",
                "globals.test.ts",
                "jsx.tsx",
            }.issubset({violation.path.name for violation in violations})
        )

    def test_domain_fixture_escape_is_exact_and_production_never_escapes(self) -> None:
        prefix = "apps/packages/product-client/src/domain"
        files = {
            f"{prefix}/production.ts": 'import value from "../../outside";\n',
            f"{prefix}/workflows/definition.test.ts": (
                "import wrong from "
                '"../../../../../../fixtures/contracts/workflow-definition/wrong.json";\n'
                'import local from "../../../../../../server/not-a-fixture.json";\n'
            ),
            "fixtures/contracts/workflow-definition/wrong.json": "{}\n",
            "server/not-a-fixture.json": "{}\n",
        }
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_domain_rules(Path(directory).resolve(), files)

        escapes = [
            violation
            for violation in violations
            if violation.rule_id == "FE-PC-3"
        ]
        self.assertEqual(len(escapes), 3)

    def test_structure_classifier_checks_nested_domain_before_product_client(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            product_src = root / "apps/packages/product-client/src"
            domain_src = product_src / "domain"
            files = self.write_files(
                root,
                {
                    "apps/packages/product-client/src/domain/allowed.ts": (
                        "import { createTranscriptState, type TranscriptState } "
                        'from "@anyharness/sdk";\n'
                        "import type { FeedWebSocketAuthTransport, "
                        "SessionMcpTransport } from \"@anyharness/sdk\";\n"
                    ),
                    "apps/packages/product-client/src/domain/raw.ts": (
                        'import { AnyHarnessClient } from "@anyharness/sdk";\n'
                    ),
                    "apps/packages/product-client/src/domain/raw-anyharness-type.ts": (
                        "import type { AnyHarnessClient, AnyHarnessClientOptions, "
                        "AnyHarnessRequestOptions, AnyHarnessTransport } "
                        'from "@anyharness/sdk";\n'
                    ),
                    "apps/packages/product-client/src/domain/raw-cloud-type.ts": (
                        "import type { CreateProliferateClientOptions, "
                        "ProliferateCloudClient } "
                        'from "@proliferate/cloud-sdk";\n'
                    ),
                    "apps/packages/product-client/src/domain/raw-module-type.ts": (
                        'type CloudSdk = typeof import("@proliferate/cloud-sdk");\n'
                    ),
                    "apps/packages/product-client/src/domain/lone-type-runtime.ts": (
                        'export { type } from "@anyharness/sdk";\n'
                    ),
                    "apps/packages/product-client/src/domain/escape.ts": (
                        'import { Button } from "../primitives/Button";\n'
                    ),
                },
            )
            with patch.multiple(
                structure_module,
                REPO_ROOT=root,
                PRODUCT_CLIENT_SRC=product_src,
                PRODUCT_CLIENT_DOMAIN_SRC=domain_src,
                PACKAGE_ROOTS={
                    "product-client-domain": domain_src,
                    "product-client": product_src,
                },
            ):
                violations = structure_module.find_forbidden_shared_package_imports(files)

        self.assertEqual(
            {violation.path.name for violation in violations},
            {
                "raw.ts",
                "raw-anyharness-type.ts",
                "raw-cloud-type.ts",
                "raw-module-type.ts",
                "lone-type-runtime.ts",
                "escape.ts",
            },
        )


class MobileProductClientBoundaryTest(unittest.TestCase):
    def write_files(self, root: Path, files: dict[str, str]) -> list[Path]:
        paths: list[Path] = []
        for relative_path, content in files.items():
            path = root / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            paths.append(path)
        return paths

    def run_mobile_rules(
        self, root: Path, source: str
    ) -> list[check_module.Violation]:
        mobile_src = root / "apps/mobile/src"
        product_src = root / "apps/packages/product-client/src"
        domain_src = product_src / "domain"
        paths = self.write_files(
            root,
            {
                "apps/mobile/src/Sample.test.ts": source,
                "apps/mobile/src/local.ts": "export {};\n",
                "apps/packages/product-client/src/domain/chats/model.ts": "export {};\n",
                "apps/packages/product-client/src/components/View.tsx": "export {};\n",
            },
        )
        mobile_file = paths[0]
        with patch.multiple(
            check_module,
            REPO_ROOT=root,
            MOBILE_SRC=mobile_src,
            PRODUCT_CLIENT_SRC=product_src,
            PRODUCT_CLIENT_DOMAIN_SRC=domain_src,
        ):
            return check_module.find_mobile_product_client_import_violations(
                mobile_file
            )

    def test_mobile_accepts_all_literal_forms_for_one_concrete_domain_file(self) -> None:
        target = "@proliferate/product-client/internal/domain/chats/model"
        source = (
            'import "./local";\n'
            f'import {{ Model }} from "{target}";\n'
            f'export type {{ Shape }} from "{target}";\n'
            f'type Inline = import("{target}").Shape;\n'
            f'const lazy = import("{target}");\n'
            f'const common = require("{target}");\n'
            f'import Alias = require("{target}");\n'
            f'vi.mock("{target}");\n'
            f'jest.mock("{target}");\n'
        )
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_mobile_rules(Path(directory).resolve(), source)

        self.assertEqual(violations, [])

    def test_mobile_rejects_broad_and_nonconcrete_product_client_edges(self) -> None:
        source = (
            'import "@proliferate/product-client";\n'
            'const host = import("@proliferate/product-client/host/product-host");\n'
            "const primitive = (require)!("
            '"@proliferate/product-client/internal/primitives/Button");\n'
            'vi!.mock<ModuleShape>("@proliferate/product-client/internal/components/View");\n'
            '(jest!).mock!<ModuleShape>("@proliferate/product-client/internal/hooks/use-thing");\n'
            '(require)("@proliferate/product-client/internal/providers/ProductProvider");\n'
            'export { store } from "@proliferate/product-client/internal/stores/store";\n'
            'type Access = import("@proliferate/product-client/internal/lib/access/cloud").Access;\n'
            'import { missing } from "@proliferate/product-client/internal/domain/chats/missing";\n'
            'import { directory } from "@proliferate/product-client/internal/domain/chats/model/";\n'
            'import { domain } from "../../packages/product-client/src/domain/chats/model";\n'
            'import { view } from "../../packages/product-client/src/components/View";\n'
            '(<typeof require>require)(<string>'
            '"@proliferate/product-client/internal/components/Angle");\n'
            r'requ\u0069re("@proliferate/product-client/internal/components/Escaped");'
            "\n"
            'require?.("@proliferate/" + '
            '"product-client/internal/components/Optional");\n'
            'void import(`@proliferate/${"product-client"}'
            '/internal/components/Template`);\n'
            'void import(true ? '
            '"@proliferate/product-client/internal/components/Conditional" '
            ': "./local");\n'
            'require("" || '
            '"@proliferate/product-client/internal/components/Logical");\n'
            'require((0, '
            '"@proliferate/product-client/internal/components/Sequence"));\n'
            '(<typeof vi>vi).mock(("@proliferate/'
            'product-client/internal/components/Asserted"!));\n'
        )
        with tempfile.TemporaryDirectory() as directory:
            violations = self.run_mobile_rules(Path(directory).resolve(), source)

        self.assertEqual(len(violations), 20)
        self.assertEqual(
            {violation.rule_id for violation in violations},
            {"FE-MOBILE-1"},
        )


class LucideIconSourceTest(unittest.TestCase):
    """UI-conformance review check 5, both halves: imports and manifests."""

    def test_reports_every_lucide_import_spelling(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            path = root / "Feature.tsx"
            path.write_text(
                'import { Check } from "lucide-react";\n'
                'import Dyn from "lucide-react/dynamicIconImports";\n'
                'export { X } from "lucide-react";\n'
                '// import { Y } from "lucide-react";\n'
                'import { Real } from "#product/primitives/icons/core";\n',
                encoding="utf-8",
            )
            with patch.object(check_module, "LUCIDE_SCANNED_MANIFESTS", []):
                violations = check_module.find_lucide_icon_source_violations([path])
        self.assertEqual([violation.lineno for violation in violations], [1, 2, 3])
        self.assertTrue(
            all(violation.rule_id == "LUCIDE_ICON_SOURCE" for violation in violations)
        )

    def test_reports_a_manifest_dependency_entry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            manifest = root / "package.json"
            manifest.write_text(
                '{\n  "dependencies": {\n    "lucide-react": "^0.4.0",\n'
                '    "react": "19"\n  }\n}\n',
                encoding="utf-8",
            )
            with patch.object(check_module, "LUCIDE_SCANNED_MANIFESTS", [manifest]):
                violations = check_module.find_lucide_icon_source_violations([])
        self.assertEqual(
            [(violation.rule_id, violation.lineno) for violation in violations],
            [("LUCIDE_PACKAGE_DEPENDENCY", 3)],
        )

    def test_the_shipped_tree_declares_and_imports_no_lucide(self) -> None:
        self.assertEqual(check_module.find_lucide_icon_source_violations(), [])


if __name__ == "__main__":
    unittest.main()
