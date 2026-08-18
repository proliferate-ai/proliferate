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
            frozenset(f"PROD-DOCS-{index}" for index in range(1, 13)),
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

    def test_platform_and_system_indexes_are_required(self) -> None:
        required_indexes = {
            "specs/codebase/platforms/README.md",
            "specs/codebase/platforms/product/agent-features/README.md",
            "specs/codebase/systems/README.md",
            "specs/codebase/systems/product/agents/README.md",
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
            "guides/operating/README.md",
            "guides/operating/analytics/README.md",
            "specs/TESTING/manual-release-qa.md",
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
            f"guides/{root}/README.md"
            for root in expected_roots - {"testing", "reference"}
        } | {
            "specs/TESTING.md",
            "specs/developing/reference/README.md",
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
        self.assertEqual(errors[0].rule_id, "PROD-DOCS-2")
        diagnostic = errors[0].format()
        self.assertIn("specs/developing/notes: PROD-DOCS-2", diagnostic)
        self.assertIn("unexpected Developing documentation root", diagnostic)
        self.assertIn("lints/product/docs.toml", diagnostic)

    def test_python_version_guard_accepts_312_and_rejects_older_python(self) -> None:
        self.assertIsNone(check_docs.python_version_diagnostic((3, 12, 0)))
        diagnostic = check_docs.python_version_diagnostic((3, 11, 9))
        self.assertEqual(
            diagnostic,
            "scripts/check_docs.py requires Python 3.12 or newer "
            "(found 3.11.9); rerun with a Python 3.12 interpreter.",
        )

    def test_router_targets_are_derived_only_from_named_tables(self) -> None:
        targets = check_docs.router_targets(
            """
# Repository

[orientation](ignored.md)

## Source router

| Source area | Start here |
| --- | --- |
| `server/**` | [Server](specs/server/) |

## Cross-plane systems

| System | Touching | Read |
| --- | --- | --- |
| Billing | money | [Billing](specs/BILLING.md) |

## Other

| Link |
| --- |
| [ignored](other.md) |
"""
        )

        self.assertEqual(
            [(section, target) for section, _, target in targets],
            [
                ("Source router", "specs/server/"),
                ("Cross-plane systems", "specs/BILLING.md"),
            ],
        )

    def test_directory_router_target_resolves_to_readme(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            owner = root / "specs/server"
            owner.mkdir(parents=True)
            readme = owner / "README.md"
            readme.write_text("# Server\n", encoding="utf-8")
            (owner / "details.md").write_text("# Details\n", encoding="utf-8")

            self.assertEqual(
                check_docs.resolve_router_target(root, "specs/server/"),
                [readme],
            )

    def test_current_target_and_superseded_authority_classification(self) -> None:
        self.assertEqual(check_docs.document_authority("# Current\n"), "current")
        self.assertEqual(
            check_docs.document_authority("# Target\n\nStatus: target.\n"),
            "target",
        )
        self.assertEqual(
            check_docs.document_authority(
                "# Old\n\n> **SUPERSEDED.** Read the replacement.\n"
            ),
            "superseded",
        )
        self.assertTrue(
            check_docs.exposes_current_gaps(
                "# Target\n\nStatus: target.\n\n## Current gaps\n\n- Missing.\n"
            )
        )

    def canonical_route_findings(self, owner_text: str) -> list[check_docs.Finding]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            owner = root / "specs/owner.md"
            owner.parent.mkdir(parents=True)
            owner.write_text(owner_text, encoding="utf-8")
            (root / "AGENTS.md").write_text(
                """# Repository

## Source router

| Source area | Start here |
| --- | --- |
| `src/**` | [Owner](specs/owner.md) |

## Cross-plane systems

| System | Touching | Read |
| --- | --- | --- |
""",
                encoding="utf-8",
            )
            with patch.object(check_docs, "ROOT", root):
                return check_docs.check_canonical_routes()

    def test_canonical_current_and_declared_target_routes_pass(self) -> None:
        self.assertEqual(self.canonical_route_findings("# Current owner\n"), [])
        self.assertEqual(
            self.canonical_route_findings(
                "# Target owner\n\nStatus: target.\n\n## Current gaps\n\n- Gap.\n"
            ),
            [],
        )

    def test_canonical_superseded_route_fails(self) -> None:
        errors = self.canonical_route_findings(
            "# Retired\n\n> **SUPERSEDED.** Read another owner.\n"
        )

        self.assertEqual([error.rule_id for error in errors], ["PROD-DOCS-10"])
        self.assertIn("superseded document", errors[0].format())

    def test_canonical_target_without_current_gaps_fails(self) -> None:
        errors = self.canonical_route_findings("# Future\n\nStatus: target.\n")

        self.assertEqual([error.rule_id for error in errors], ["PROD-DOCS-10"])
        self.assertIn("does not expose current gaps", errors[0].format())

    def entry_page_findings(
        self, overrides: dict[str, str] | None = None
    ) -> list[check_docs.Finding]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            contents = {
                "README.md": "# Product\n\n[Route](AGENTS.md)\n",
                "CONTRIBUTING.md": "# Contributing\n\n[Route](AGENTS.md)\n",
                "specs/README.md": "# Specs\n\n[Route](../AGENTS.md)\n",
                "ARCHITECTURE.md": "# Architecture\n\n[Route](AGENTS.md)\n",
                "CLAUDE.md": "# Claude\n\n[Route](AGENTS.md)\n",
            }
            contents.update(overrides or {})
            for relative, content in contents.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            (root / "AGENTS.md").write_text("# Router\n", encoding="utf-8")

            with patch.object(check_docs, "ROOT", root), patch.object(
                check_docs,
                "tracked_paths",
                return_value=[Path("CLAUDE.md")],
            ):
                return check_docs.check_entry_page_deference()

    def test_entry_pages_defer_to_agents_without_competing_map(self) -> None:
        self.assertEqual(self.entry_page_findings(), [])

    def test_competing_entry_page_source_map_fails(self) -> None:
        errors = self.entry_page_findings(
            {
                "README.md": """# Product

[Route](AGENTS.md)

## Source map

| Source area | Start here |
| --- | --- |
| Server | specs/server |
"""
            }
        )

        self.assertEqual([error.rule_id for error in errors], ["PROD-DOCS-11"])
        self.assertIn("competing source map", errors[0].format())

    def test_broken_claude_loader_fails(self) -> None:
        errors = self.entry_page_findings(
            {"CLAUDE.md": "# Claude\n\nUse repository instructions.\n"}
        )

        self.assertEqual([error.rule_id for error in errors], ["PROD-DOCS-12"])
        self.assertIn("does not link to AGENTS.md", errors[0].format())

    def test_untracked_claude_loader_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for relative, content in {
                "README.md": "[Route](AGENTS.md)\n",
                "CONTRIBUTING.md": "[Route](AGENTS.md)\n",
                "specs/README.md": "[Route](../AGENTS.md)\n",
                "ARCHITECTURE.md": "[Route](AGENTS.md)\n",
                "CLAUDE.md": "[Route](AGENTS.md)\n",
            }.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")

            with patch.object(check_docs, "ROOT", root), patch.object(
                check_docs, "tracked_paths", return_value=[]
            ):
                errors = check_docs.check_entry_page_deference()

        self.assertEqual([error.rule_id for error in errors], ["PROD-DOCS-12"])
        self.assertIn("harness loader is not tracked", errors[0].format())

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
