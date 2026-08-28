from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts import check_mobile_product_client_export as check_module

DOMAIN_IMPORT = "@proliferate/product-client/internal/domain/chats/model"


def expected_metro_facts() -> dict[str, object]:
    return {
        "resolveRequest": None,
        "unstable_enablePackageExports": True,
        "unstable_conditionNames": [],
        "unstable_conditionsByPlatform": {
            "ios": ["react-native"],
            "android": ["react-native"],
            "web": ["browser"],
        },
    }


class MobileProductClientExportCheckerTest(unittest.TestCase):
    def matching(self, errors: list[str], rule_id: str, detail: str) -> list[str]:
        """Diagnostics naming `rule_id` whose `found:` line carries `detail`.

        Keying on both halves is the point: the rule id proves the engine
        reached for the right record, and the detail proves it found the right
        thing. A record renamed out from under the engine fails here.
        """
        return [
            error for error in errors if rule_id in error and detail in error and "found:" in error
        ]

    def has(self, errors: list[str], rule_id: str, detail: str) -> None:
        self.assertTrue(
            self.matching(errors, rule_id, detail),
            f"no {rule_id} diagnostic mentioning {detail!r} in {errors!r}",
        )

    def write_text(self, root: Path, relative_path: str, content: str) -> Path:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def write_json(self, root: Path, relative_path: str, value: object) -> Path:
        return self.write_text(
            root,
            relative_path,
            json.dumps(value, indent=2) + "\n",
        )

    def write_valid_repo(
        self,
        root: Path,
        *,
        mobile_source: str = f'import {{ Chat }} from "{DOMAIN_IMPORT}";\n',
        include_runtime: bool = True,
        include_declaration: bool = True,
    ) -> None:
        self.write_json(
            root,
            "apps/mobile/tsconfig.json",
            {"compilerOptions": {"strict": True}},
        )
        self.write_text(root, "apps/mobile/src/example.ts", mobile_source)
        self.write_json(
            root,
            "apps/packages/product-client/package.json",
            {
                "exports": {
                    "./internal/*": {
                        "types": "./src/*",
                        "default": "./dist/*.js",
                    }
                }
            },
        )
        if include_runtime:
            self.write_text(
                root,
                "apps/packages/product-client/dist/domain/chats/model.js",
                "export {};\n",
            )
        if include_declaration:
            self.write_text(
                root,
                "apps/packages/product-client/dist/domain/chats/model.d.ts",
                "export interface Chat {}\n",
            )

    def check_preflight(
        self, root: Path, *, metro_facts: dict[str, object] | None = None
    ) -> list[str]:
        return check_module.check_preflight(
            root,
            metro_facts=(expected_metro_facts() if metro_facts is None else metro_facts),
        )

    def test_valid_domain_import_and_built_targets_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root)

            errors = self.check_preflight(root)

        self.assertEqual(errors, [])

    def test_preflight_requires_at_least_one_product_client_edge(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root, mobile_source="export {};\n")

            errors = self.check_preflight(root)

        self.has(errors, "FE-EXPORT-8", "no ProductClient import")

    def test_static_dynamic_require_and_mock_broad_imports_fail(self) -> None:
        mobile_source = "\n".join(
            (
                'import ProductClient from "@proliferate/product-client";',
                'void import("@proliferate/product-client/internal/host/client");',
                '(require)!<ModuleShape>("@proliferate/product-client/internal/primitives/Button");',
                '(require)("@proliferate/product-client/internal/access/cloud");',
                'vi!.mock<ModuleShape>("@proliferate/product-client/internal/components/Chat");',
                '(jest!).mock!<ModuleShape>("@proliferate/product-client/internal/stores/chats");',
                "(<typeof require>require)(<string>"
                '"@proliferate/product-client/internal/components/Angle");',
                r'requ\u0069re("@proliferate/product-client/internal/components/Escaped");',
                'require?.("@proliferate/" + "product-client/internal/components/Optional");',
                'void import(`@proliferate/${"product-client"}/internal/components/Template`);',
                "void import(true ? "
                '"@proliferate/product-client/internal/components/Conditional" '
                ': "./local");',
                'require("" || "@proliferate/product-client/internal/components/Logical");',
                'require((0, "@proliferate/product-client/internal/components/Sequence"));',
                '(<typeof vi>vi).mock(("@proliferate/'
                'product-client/internal/components/Asserted"!));',
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root, mobile_source=mobile_source)

            errors = self.check_preflight(root)

        boundary_errors = self.matching(
            errors, "FE-EXPORT-5", "Mobile may import ProductClient only"
        )
        self.assertEqual(len(boundary_errors), 14)

    def test_relative_product_client_source_paths_fail(self) -> None:
        mobile_source = "\n".join(
            (
                'import { model } from "../../packages/product-client/src/domain/chats/model";',
                'require("../../packages/product-client/src/components/Chat");',
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root, mobile_source=mobile_source)
            self.write_text(
                root,
                "apps/packages/product-client/src/domain/chats/model.ts",
                "export {};\n",
            )
            self.write_text(
                root,
                "apps/packages/product-client/src/components/Chat.tsx",
                "export {};\n",
            )

            errors = self.check_preflight(root)

        boundary_errors = self.matching(
            errors, "FE-EXPORT-5", "Mobile may import ProductClient only"
        )
        self.assertEqual(len(boundary_errors), 2)

    def test_all_supported_loader_forms_reach_valid_domain_target(self) -> None:
        mobile_source = "\n".join(
            (
                f'import type {{ Chat }} from "{DOMAIN_IMPORT}";',
                f'export {{ Chat }} from "{DOMAIN_IMPORT}";',
                f'void import("{DOMAIN_IMPORT}");',
                f'require("{DOMAIN_IMPORT}");',
                f'vi.mock("{DOMAIN_IMPORT}");',
                f'jest.mock("{DOMAIN_IMPORT}");',
                f'import ChatModule = require("{DOMAIN_IMPORT}");',
            )
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root, mobile_source=mobile_source)

            errors = self.check_preflight(root)

        self.assertEqual(errors, [])

    def test_base_url_and_paths_fail(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root)
            self.write_json(
                root,
                "apps/mobile/tsconfig.json",
                {
                    "compilerOptions": {
                        "baseUrl": ".",
                        "paths": {
                            "@proliferate/product-client/*": ["../packages/product-client/src/*"]
                        },
                    }
                },
            )

            errors = self.check_preflight(root)

        self.has(errors, "FE-EXPORT-1", "baseUrl must be absent")
        self.has(errors, "FE-EXPORT-1", "paths must be absent")

    def test_custom_metro_resolver_and_condition_drift_fail(self) -> None:
        facts = expected_metro_facts()
        facts["resolveRequest"] = "function"
        facts["unstable_enablePackageExports"] = False
        facts["unstable_conditionNames"] = ["import"]
        facts["unstable_conditionsByPlatform"] = {
            "ios": ["browser"],
            "android": ["react-native"],
            "web": ["browser"],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root)

            errors = self.check_preflight(root, metro_facts=facts)

        self.has(errors, "FE-EXPORT-2", "custom resolver.resolveRequest")
        self.has(errors, "FE-EXPORT-3", "unstable_enablePackageExports")
        self.has(errors, "FE-EXPORT-3", "unstable_conditionNames")
        self.has(errors, "FE-EXPORT-3", "unstable_conditionsByPlatform")

    def test_package_export_override_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root)
            self.write_json(
                root,
                "apps/packages/product-client/package.json",
                {
                    "exports": {
                        "./internal/*": {
                            "types": "./src/*",
                            "react-native": "./src/native/*",
                            "default": "./dist/*.js",
                        }
                    }
                },
            )

            errors = self.check_preflight(root)

        self.has(errors, "FE-EXPORT-4", "forbidden condition overrides")

    def test_non_dist_runtime_export_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root)
            self.write_json(
                root,
                "apps/packages/product-client/package.json",
                {
                    "exports": {
                        "./internal/*": {
                            "types": "./src/*",
                            "default": "./src/*.js",
                        }
                    }
                },
            )

            errors = self.check_preflight(root)

        self.has(errors, "FE-EXPORT-4", "must be exactly './dist/*.js'")

    def test_missing_runtime_target_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root, include_runtime=False)

            errors = self.check_preflight(root)

        self.has(errors, "FE-EXPORT-6", "missing built ProductClient runtime target")

    def test_type_only_edge_needs_declaration_but_not_runtime_js(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(
                root,
                mobile_source=f'import type {{ Chat }} from "{DOMAIN_IMPORT}";\n',
                include_runtime=False,
            )

            errors = self.check_preflight(root)

        self.assertEqual(errors, [])

    def test_later_runtime_edge_is_not_hidden_by_type_only_edge(self) -> None:
        source = (
            f'import type {{ Chat }} from "{DOMAIN_IMPORT}";\n'
            f'const model = require("{DOMAIN_IMPORT}");\n'
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(
                root,
                mobile_source=source,
                include_runtime=False,
            )

            errors = self.check_preflight(root)

        self.has(errors, "FE-EXPORT-6", "missing built ProductClient runtime target")

    def test_missing_declaration_target_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_valid_repo(root, include_declaration=False)

            errors = self.check_preflight(root)

        self.has(errors, "FE-EXPORT-7", "missing adjacent ProductClient declaration target")

    def test_composed_map_with_product_client_domain_source_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            export_dir = Path(directory)
            self.write_json(
                export_dir,
                "bundle.js.map",
                {
                    "version": 3,
                    "sections": [
                        {
                            "offset": {"line": 0, "column": 0},
                            "map": {
                                "version": 3,
                                "sourceRoot": ("file:///repo/apps/packages/product-client/"),
                                "sources": ["src/domain/chats/model.ts"],
                                "names": [],
                                "mappings": "",
                            },
                        }
                    ],
                },
            )

            errors = check_module.check_export_maps(export_dir)

        self.assertEqual(errors, [])

    def test_forbidden_product_client_source_in_map_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            export_dir = Path(directory)
            self.write_json(
                export_dir,
                "bundle.js.map",
                {
                    "version": 3,
                    "sources": [
                        "../../node_modules/@proliferate/product-client/src/domain/chats/model.ts",
                        "../../node_modules/@proliferate/product-client/src/components/Chat.tsx",
                        "../../node_modules/@proliferate/product-client/"
                        "src/domain/../hooks/use-chat.ts",
                    ],
                    "names": [],
                    "mappings": "",
                },
            )

            errors = check_module.check_export_maps(export_dir)

        self.assertEqual(
            len(self.matching(errors, "FE-EXPORT-9", "forbidden ProductClient source")),
            2,
        )

    def test_export_with_no_product_client_source_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            export_dir = Path(directory)
            self.write_json(
                export_dir,
                "bundle.js.map",
                {
                    "version": 3,
                    "sources": ["../../apps/mobile/src/example.ts"],
                    "names": [],
                    "mappings": "",
                },
            )

            errors = check_module.check_export_maps(export_dir)

        self.has(errors, "FE-EXPORT-9", "contain no ProductClient module")


if __name__ == "__main__":
    unittest.main()
