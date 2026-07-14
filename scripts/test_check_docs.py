from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import check_docs


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

    def test_platform_and_system_indexes_are_required(self) -> None:
        required_indexes = {
            "specs/codebase/platforms/README.md",
            "specs/codebase/platforms/product/agent-features/README.md",
            "specs/codebase/platforms/engineering/README.md",
            "specs/codebase/platforms/internal/README.md",
            "specs/codebase/systems/README.md",
            "specs/codebase/systems/product/agents/README.md",
            "specs/codebase/systems/product/automations/README.md",
            "specs/codebase/systems/product/chat/README.md",
            "specs/codebase/systems/product/clients/README.md",
            "specs/codebase/systems/product/organizations/README.md",
            "specs/codebase/systems/product/settings/README.md",
            "specs/codebase/systems/product/workflows/README.md",
            "specs/codebase/systems/product/workspaces/README.md",
            "specs/codebase/systems/product/clients/web-desktop-unification/migration/README.md",
            "specs/codebase/systems/product/engagement/README.md",
            "specs/codebase/systems/engineering/README.md",
            "specs/codebase/systems/engineering/analytics/README.md",
            "specs/codebase/systems/engineering/delivery/README.md",
            "specs/codebase/systems/engineering/issue-lifecycle/README.md",
            "specs/codebase/systems/engineering/observability/README.md",
            "specs/developing/operating/README.md",
            "specs/developing/operating/analytics/README.md",
            "specs/developing/testing/manual-release-qa.md",
        }

        self.assertLessEqual(required_indexes, set(check_docs.REQUIRED_READMES))
        legacy_capability_root = "specs/codebase/" + "primitives/README.md"
        legacy_workflow_root = "specs/codebase/" + "features/README.md"
        self.assertNotIn(legacy_capability_root, check_docs.REQUIRED_READMES)
        self.assertNotIn(legacy_workflow_root, check_docs.REQUIRED_READMES)
        self.assertNotIn(
            "specs/developing/analytics/README.md", check_docs.REQUIRED_READMES
        )
        legacy_qa_root = "specs/developing/" + "qa/" + "README.md"
        self.assertNotIn(legacy_qa_root, check_docs.REQUIRED_READMES)

    def test_developing_root_indexes_are_required(self) -> None:
        expected_roots = {
            "process",
            "local",
            "testing",
            "debugging",
            "deploying",
            "operating",
            "reference",
        }
        expected_indexes = {
            f"specs/developing/{root}/README.md" for root in expected_roots
        }

        self.assertEqual(check_docs.DEVELOPING_ROOTS, expected_roots)
        self.assertLessEqual(expected_indexes, set(check_docs.REQUIRED_READMES))
        legacy_runbook_index = (
            "specs/developing/" + "runbooks/" + "README.md"
        )
        self.assertNotIn(legacy_runbook_index, check_docs.REQUIRED_READMES)

    def test_developing_root_check_allows_root_readme_and_allowed_root(self) -> None:
        paths = [
            Path("specs/developing/README.md"),
            Path("specs/developing/operating/example.md"),
        ]

        with patch.object(check_docs, "tracked_paths", return_value=paths):
            errors = check_docs.check_developing_roots()

        self.assertEqual(errors, [])

    def test_developing_root_check_rejects_unexpected_tracked_root(self) -> None:
        paths = [
            Path("specs/developing/README.md"),
            Path("specs/developing/notes/example.md"),
        ]

        with patch.object(check_docs, "tracked_paths", return_value=paths):
            errors = check_docs.check_developing_roots()

        self.assertEqual(len(errors), 1)
        self.assertIn(
            "unexpected Developing documentation root: specs/developing/notes",
            errors[0],
        )

    def markdown_errors(self, files: dict[str, str]) -> list[str]:
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
        self.assertTrue(any("missing-inline.md" in error for error in errors))
        self.assertTrue(any("missing-reference.md" in error for error in errors))

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
        self.assertTrue(any("missing Markdown anchor" in error for error in errors))
        self.assertTrue(any("leaves repository" in error for error in errors))

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
        self.assertIn("invalid JSON", errors[0])

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
        self.assertIn("invalid YAML", errors[0])

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
        self.assertIn("invalid YAML", errors[0])


if __name__ == "__main__":
    unittest.main()
