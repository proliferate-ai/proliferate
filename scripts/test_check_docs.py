from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import check_docs


def rendered(findings: list[check_docs.Finding]) -> list[str]:
    """The record-generated diagnostics, which is what CI actually prints."""
    return [finding.format() for finding in findings]


class RecordCoverageTest(unittest.TestCase):
    """Every rule this checker claims must have a record, and vice versa."""

    def test_checker_owns_exactly_the_prod_docs_records(self) -> None:
        self.assertEqual(
            check_docs.OWNED_RULE_IDS,
            frozenset(f"PROD-DOCS-{index}" for index in range(1, 10)),
        )

    def test_every_owned_rule_renders_a_diagnostic_naming_its_record(self) -> None:
        for rule_id in sorted(check_docs.OWNED_RULE_IDS):
            diagnostic = check_docs.Finding(rule_id, "somewhere.md:1", "detail").format()
            self.assertIn(rule_id, diagnostic)
            self.assertIn("lints/product/docs.toml", diagnostic)
            self.assertIn("  instead:", diagnostic)


class DocumentationIntegrityTest(unittest.TestCase):
    def valid_env_var_entry(self, **overrides: object) -> dict[str, object]:
        entry: dict[str, object] = {
            "name": "API_BASE_URL",
            "secret": False,
            "default": "",
            "description": "Canonical public API base URL.",
            "tags": ["local-dev", "self-hosted", "production"],
        }
        entry.update(overrides)
        return entry

    def test_system_and_engineering_indexes_are_required(self) -> None:
        required_indexes = {
            "specs/README.md",
            "specs/ARCHITECTURE.md",
            "specs/areas/server.md",
            "specs/areas/anyharness.md",
            "specs/areas/frontend.md",
            "specs/areas/infra.md",
            "specs/systems/chat/README.md",
            "specs/systems/identity/README.md",
            "specs/systems/settings/README.md",
            "specs/systems/automations/README.md",
            "specs/systems/workspace-surface/README.md",
            "specs/systems/workspaces/README.md",
            "specs/engineering/testing/README.md",
            "specs/engineering/observability/README.md",
            "specs/engineering/ci-cd/README.md",
            "specs/engineering/security/README.md",
            "specs/engineering/customer-loop/README.md",
            "guides/operating/README.md",
            "guides/operating/analytics/README.md",
            "guides/deploying/manual-release-qa.md",
        }

        self.assertLessEqual(required_indexes, set(check_docs.REQUIRED_READMES))
        legacy_codebase_root = "specs/" + "codebase/" + "README.md"
        legacy_feature_docs_root = "specs/" + "FEATURE_DOCS/" + "README.md"
        self.assertNotIn(legacy_codebase_root, check_docs.REQUIRED_READMES)
        self.assertNotIn(legacy_feature_docs_root, check_docs.REQUIRED_READMES)
        legacy_reference_root = "specs/" + "developing/" + "reference/" + "README.md"
        self.assertNotIn(legacy_reference_root, check_docs.REQUIRED_READMES)
        legacy_testing_root = "specs/" + "TESTING/" + "manual-release-qa.md"
        self.assertNotIn(legacy_testing_root, check_docs.REQUIRED_READMES)

    def test_specs_roots_are_closed(self) -> None:
        self.assertEqual(
            check_docs.SPECS_ROOTS, {"areas", "systems", "engineering"}
        )
        self.assertEqual(
            check_docs.SPECS_ROOT_FILES,
            {
                "README.md",
                "ARCHITECTURE.md",
                "DESIGN_SYSTEM.md",
                "BUILDING.md",
                "product-sense.md",
                "authoring.md",
            },
        )
        self.assertIn("specs/engineering/testing/README.md", check_docs.REQUIRED_READMES)
        legacy_testing_standard = "specs/" + "TESTING.md"
        self.assertNotIn(legacy_testing_standard, check_docs.REQUIRED_READMES)

    def test_specs_root_check_allows_root_docs_and_allowed_roots(self) -> None:
        paths = [
            Path("specs/README.md"),
            Path("specs/ARCHITECTURE.md"),
            Path("specs/systems/chat/README.md"),
            Path("specs/areas/server.md"),
            Path("specs/engineering/testing/README.md"),
        ]

        with patch.object(check_docs, "tracked_paths", return_value=paths):
            errors = check_docs.check_specs_roots()

        self.assertEqual(errors, [])

    def test_specs_root_check_rejects_unexpected_tracked_root(self) -> None:
        paths = [
            Path("specs/README.md"),
            Path("specs/notes/example.md"),
        ]

        with patch.object(check_docs, "tracked_paths", return_value=paths):
            errors = check_docs.check_specs_roots()

        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0].rule_id, "PROD-DOCS-2")
        diagnostic = errors[0].format()
        self.assertIn("specs/notes: PROD-DOCS-2", diagnostic)
        self.assertIn("unexpected specs/ root", diagnostic)
        self.assertIn("lints/product/docs.toml", diagnostic)

    def markdown_errors(self, files: dict[str, str]) -> list[check_docs.Finding]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            paths: list[Path] = []
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
                paths.append(path)

            with patch.object(check_docs, "ROOT", root), patch.object(
                check_docs, "tracked_files", return_value=paths
            ):
                return check_docs.check_markdown()

    def test_valid_inline_reference_fence_and_balanced_parentheses(self) -> None:
        errors = self.markdown_errors(
            {
                "README.md": """
[balanced](guide_(v2).md)
[reference][guide]

[guide]: guide_(v2).md

```md
[example only](missing.md)
```

`[inline code](also-missing.md)`
""",
                "guide_(v2).md": "# Guide\n",
            }
        )
        self.assertEqual(errors, [])

    def test_missing_inline_and_reference_targets_fail(self) -> None:
        errors = self.markdown_errors(
            {
                "README.md": """
[inline](missing-inline.md)
[reference][missing]
[missing]: missing-reference.md
"""
            }
        )
        self.assertEqual({error.rule_id for error in errors}, {"PROD-DOCS-5"})
        diagnostics = rendered(errors)
        self.assertTrue(any("missing-inline.md" in error for error in diagnostics))
        self.assertTrue(any("missing-reference.md" in error for error in diagnostics))
        self.assertTrue(all("lints/product/docs.toml" in error for error in diagnostics))

    def test_absolute_repository_link_fails(self) -> None:
        errors = self.markdown_errors(
            {
                "nested/README.md": "[absolute](/nested/guide.md)\n",
                "nested/guide.md": "# Guide\n",
            }
        )
        self.assertEqual([error.rule_id for error in errors], ["PROD-DOCS-3"])
        self.assertIn("/nested/guide.md", errors[0].format())

    def test_atx_setext_and_duplicate_anchors(self) -> None:
        errors = self.markdown_errors(
            {
                "README.md": """
[first](guide.md#heading)
[second](guide.md#heading-1)
[setext](guide.md#setext-heading)
""",
                "guide.md": """
# Heading
# Heading

Setext Heading
==============
""",
            }
        )
        self.assertEqual(errors, [])

    def test_missing_anchor_and_repository_escape_fail(self) -> None:
        errors = self.markdown_errors(
            {
                "nested/README.md": """
[anchor](guide.md#missing)
[escape](../../outside.md)
""",
                "nested/guide.md": "# Present\n",
            }
        )
        self.assertEqual(
            {error.rule_id for error in errors}, {"PROD-DOCS-6", "PROD-DOCS-4"}
        )
        diagnostics = rendered(errors)
        self.assertTrue(any("missing heading anchor" in error for error in diagnostics))
        self.assertTrue(
            any("leaves the repository" in error for error in diagnostics)
        )

    def test_structured_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            valid_json = root / "valid.json"
            invalid_json = root / "invalid.json"
            valid_yaml = root / "valid.yaml"
            valid_json.write_text(json.dumps({"ok": True}), encoding="utf-8")
            invalid_json.write_text("{", encoding="utf-8")
            valid_yaml.write_text("ok: true\n", encoding="utf-8")

            def files(*patterns: str) -> list[Path]:
                if any(pattern.endswith(".json") for pattern in patterns):
                    return [valid_json, invalid_json]
                if any(pattern.endswith((".yaml", ".yml")) for pattern in patterns):
                    return [valid_yaml]
                return []

            with patch.object(check_docs, "ROOT", root), patch.object(
                check_docs, "tracked_files", side_effect=files
            ):
                errors = check_docs.check_structured_data()

        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0].rule_id, "PROD-DOCS-7")
        self.assertIn("invalid JSON", errors[0].format())

    def test_valid_env_var_catalog(self) -> None:
        self.assertEqual(
            check_docs.validate_env_var_catalog([self.valid_env_var_entry()]),
            [],
        )

    def test_env_var_catalog_requires_top_level_list(self) -> None:
        self.assertEqual(
            check_docs.validate_env_var_catalog({"name": "API_BASE_URL"}),
            ["environment variable catalog must be a top-level list"],
        )

    def test_env_var_catalog_rejects_duplicate_names(self) -> None:
        errors = check_docs.validate_env_var_catalog(
            [self.valid_env_var_entry(), self.valid_env_var_entry()]
        )

        self.assertTrue(any("duplicate name: API_BASE_URL" in error for error in errors))

    def test_env_var_catalog_rejects_unknown_and_missing_fields(self) -> None:
        entry = self.valid_env_var_entry(workflow="release-desktop")
        del entry["default"]

        errors = check_docs.validate_env_var_catalog([entry])

        self.assertTrue(any("missing fields: default" in error for error in errors))
        self.assertTrue(any("unknown fields: workflow" in error for error in errors))

    def test_env_var_catalog_rejects_invalid_names_and_types(self) -> None:
        errors = check_docs.validate_env_var_catalog(
            [
                self.valid_env_var_entry(
                    name="lowercase",
                    secret="false",
                    default=1,
                    description=" ",
                    tags="production",
                )
            ]
        )

        self.assertTrue(any("invalid name" in error for error in errors))
        self.assertTrue(any("secret must be a Boolean" in error for error in errors))
        self.assertTrue(any("default must be a string" in error for error in errors))
        self.assertTrue(any("description must be a nonempty string" in error for error in errors))
        self.assertTrue(any("tags must be a nonempty list" in error for error in errors))

    def test_env_var_catalog_rejects_duplicate_and_unknown_tags(self) -> None:
        errors = check_docs.validate_env_var_catalog(
            [self.valid_env_var_entry(tags=["web", "web", "workflow"])]
        )

        self.assertTrue(any("duplicate tag: web" in error for error in errors))
        self.assertTrue(any("unknown tag: 'workflow'" in error for error in errors))

    @unittest.skipUnless(shutil.which("ruby"), "Ruby is required for YAML validation")
    def test_invalid_yaml_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            invalid_yaml = root / "invalid.yaml"
            invalid_yaml.write_text("value: bad: yaml\n", encoding="utf-8")

            def files(*patterns: str) -> list[Path]:
                if any(pattern.endswith((".yaml", ".yml")) for pattern in patterns):
                    return [invalid_yaml]
                return []

            with patch.object(check_docs, "ROOT", root), patch.object(
                check_docs, "tracked_files", side_effect=files
            ):
                errors = check_docs.check_structured_data()

        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0].rule_id, "PROD-DOCS-8")
        self.assertIn("invalid YAML", errors[0].format())

    @unittest.skipUnless(shutil.which("ruby"), "Ruby is required for YAML validation")
    def test_ruby_object_yaml_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            catalog = root / check_docs.ENV_VAR_CATALOG
            catalog.parent.mkdir(parents=True)
            catalog.write_text(
                "--- !ruby/object:Object {}\n",
                encoding="utf-8",
            )

            def files(*patterns: str) -> list[Path]:
                if any(pattern.endswith((".yaml", ".yml")) for pattern in patterns):
                    return [catalog]
                return []

            with patch.object(check_docs, "ROOT", root), patch.object(
                check_docs, "tracked_files", side_effect=files
            ):
                errors = check_docs.check_structured_data()

        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0].rule_id, "PROD-DOCS-8")
        self.assertIn("invalid YAML", errors[0].format())


if __name__ == "__main__":
    unittest.main()
