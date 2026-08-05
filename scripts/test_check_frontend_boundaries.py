from __future__ import annotations

import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from scripts import check_frontend_boundaries as check_module
from scripts import report_frontend_structure as structure_module
from scripts.frontend_imports import collect_imports


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
            if violation.rule_id == "PRODUCT_CLIENT_LAYER_DIRECTION"
        ]
        self.assertEqual(len(layer_violations), 2 * len(forbidden_pairs))

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
            "PRODUCT_CLIENT_LAYER_DIRECTION",
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
            if violation.rule_id == "PRODUCT_CLIENT_LAYER_DIRECTION"
        ]
        self.assertEqual([violation.lineno for violation in layer_violations], [2, 3])
        self.assertIn("type-only", layer_violations[0].message)
        self.assertIn("runtime", layer_violations[1].message)

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
            if violation.rule_id == "PRODUCT_CLIENT_FORBIDDEN_IMPORT"
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
            if violation.rule_id == "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER"
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
            if violation.rule_id == "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER"
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
            if violation.rule_id == "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER"
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
            if violation.rule_id == "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER"
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
            if violation.rule_id == "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER"
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
            if violation.rule_id == "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER"
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
            if violation.rule_id == "QUERY_HOOK_OUTSIDE_ACCESS_OR_CACHE"
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
            if violation.rule_id == "QUERY_HOOK_OUTSIDE_ACCESS_OR_CACHE"
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
        self.assertEqual(domain_rules, ["DOMAIN_FORBIDDEN_IMPORT"])

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
            if violation.rule_id == "STORE_RUNTIME_ACCESS"
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
            if violation.rule_id == "STORE_RUNTIME_ACCESS"
        }
        self.assertEqual(runtime_paths, {"mixed.ts", "type-named-runtime.ts"})

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
            ["STORE_FORBIDDEN_ACCESS"],
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
            if violation.rule_id == "QUERY_HOOK_OUTSIDE_ACCESS_OR_CACHE"
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
            {"ANYHARNESS_CLIENT_OUTSIDE_ACCESS", "STORE_RUNTIME_ACCESS"}
            <= dynamic_client_rules
        )
        dynamic_store_rules = [
            violation.rule_id
            for violation in violations
            if violation.path.name == "dynamic-store.ts"
        ]
        self.assertIn(
            "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER",
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
            if violation.rule_id == "QUERY_HOOK_OUTSIDE_ACCESS_OR_CACHE"
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
                ("raw-string-name.ts", "ANYHARNESS_CLIENT_OUTSIDE_ACCESS"),
                ("raw-string-name.ts", "STORE_RUNTIME_ACCESS"),
                ("raw-dynamic-member.ts", "ANYHARNESS_CLIENT_OUTSIDE_ACCESS"),
                ("raw-dynamic-member.ts", "STORE_RUNTIME_ACCESS"),
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
            if violation.rule_id == "QUERY_HOOK_OUTSIDE_ACCESS_OR_CACHE"
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
            if violation.rule_id == "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER"
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
            if violation.rule_id == "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER"
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
            in {"DOMAIN_FORBIDDEN_IMPORT", "WORKFLOW_FORBIDDEN_IMPORT"}
        ]
        self.assertEqual(
            purity_rules,
            [
                "DOMAIN_FORBIDDEN_IMPORT",
                "DOMAIN_FORBIDDEN_IMPORT",
                "WORKFLOW_FORBIDDEN_IMPORT",
                "WORKFLOW_FORBIDDEN_IMPORT",
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
            if violation.rule_id == "QUERY_HOOK_OUTSIDE_ACCESS_OR_CACHE"
        }
        self.assertEqual(query_paths, {"for-query.ts"})
        set_state = [
            (violation.path.name, violation.lineno)
            for violation in violations
            if violation.rule_id == "PRODUCT_CLIENT_STORE_SET_STATE_OUTSIDE_OWNER"
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
            in {"PRODUCT_CLIENT_LAYER_DIRECTION", "PRODUCT_CLIENT_FORBIDDEN_IMPORT"}
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
        self.assertEqual(counts.get("COMPONENT_FORBIDDEN_ACCESS"), 1)
        self.assertEqual(counts.get("STORE_FORBIDDEN_ACCESS"), 1)
        self.assertEqual(counts.get("ANYHARNESS_CLIENT_OUTSIDE_ACCESS"), 1)
        self.assertEqual(counts.get("DOMAIN_FORBIDDEN_IMPORT"), 2)
        self.assertEqual(counts.get("WORKFLOW_FORBIDDEN_IMPORT"), 2)

    def test_exact_junk_drawer_names_fail_but_descriptive_helpers_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            files = self.write_files(
                root,
                {
                    "apps/packages/product-client/src/lib/domain/chat/utils.ts": "export {};\n",
                    "apps/packages/product-client/src/lib/domain/chat/session-runtime-helpers.ts": "export {};\n",
                    "apps/packages/ui/src/lib/utils.ts": "export {};\n",
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

    def test_allowlist_overage_and_stale_count_both_fail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            path = root / "apps/packages/product-client/src/hooks/chat/sample.ts"
            path.parent.mkdir(parents=True)
            path.write_text("export {};\n", encoding="utf-8")
            entry = check_module.AllowlistEntry("RULE", path.relative_to(root).as_posix(), 1, "debt")
            with patch.multiple(
                check_module,
                REPO_ROOT=root,
                load_allowlist=lambda: {("RULE", entry.relative_path): entry},
                collect_violations=lambda: [
                    check_module.Violation("RULE", path, 1, "old"),
                    check_module.Violation("RULE", path, 2, "new"),
                ],
            ), redirect_stdout(StringIO()):
                self.assertEqual(check_module.main(), 1)
            with patch.multiple(
                check_module,
                REPO_ROOT=root,
                load_allowlist=lambda: {("RULE", entry.relative_path): entry},
                collect_violations=lambda: [],
            ), redirect_stdout(StringIO()):
                self.assertEqual(check_module.main(), 1)


if __name__ == "__main__":
    unittest.main()
