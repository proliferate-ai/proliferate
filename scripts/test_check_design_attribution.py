#!/usr/bin/env python3

"""The guard's whole difficulty is that these names are also real product
vocabulary, so the accept cases matter as much as the reject cases: a guard
that flags `harnessKind === "codex"` would be turned off within a day."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_design_attribution
from scripts.check_design_attribution import scan_file


def scanned(source: str, suffix: str = ".tsx") -> list[check_design_attribution.Finding]:
    with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False) as handle:
        handle.write(source)
        path = Path(handle.name)
    try:
        return scan_file(path)
    finally:
        path.unlink()


def findings_for(source: str, suffix: str = ".tsx") -> list[str]:
    return [finding.rule_id for finding in scanned(source, suffix)]


class RecordCoverageTest(unittest.TestCase):
    """Every rule this checker claims must have a record, and vice versa."""

    def test_checker_owns_exactly_the_prod_attr_records(self) -> None:
        self.assertEqual(
            check_design_attribution.OWNED_RULE_IDS,
            frozenset(f"PROD-ATTR-{index}" for index in range(1, 6)),
        )

    def test_every_pattern_names_an_owned_record(self) -> None:
        self.assertEqual(
            {rule_id for rule_id, _pattern in check_design_attribution.PATTERNS},
            set(check_design_attribution.OWNED_RULE_IDS),
        )

    def test_diagnostic_cites_the_rule_and_the_record(self) -> None:
        diagnostic = scanned("/* Codex-style dot */")[0].format()
        self.assertIn("PROD-ATTR-1", diagnostic)
        self.assertIn("Codex-style", diagnostic)
        self.assertIn("lints/product/attribution.toml", diagnostic)
        self.assertIn("  instead:", diagnostic)


class AttributionRejected(unittest.TestCase):
    def test_style_suffix(self) -> None:
        self.assertIn("PROD-ATTR-1", findings_for("/* Codex-style dot */"))

    def test_possessive_style(self) -> None:
        self.assertIn("PROD-ATTR-1", findings_for("// codex's style here"))

    def test_recipe_language(self) -> None:
        self.assertIn("PROD-ATTR-2", findings_for("/* codex popover recipe */"))

    def test_anatomy_language(self) -> None:
        self.assertIn("PROD-ATTR-2", findings_for("// Codex anatomy has no footer"))

    def test_reference_dump_path(self) -> None:
        self.assertIn(
            "PROD-ATTR-3",
            findings_for("/* see reference/codex/status/card.html */"),
        )

    def test_shipped_identifier(self) -> None:
        self.assertIn(
            "PROD-ATTR-5",
            findings_for('className="codex-thread-find-match"'),
        )

    def test_bare_product_plus_design_noun(self) -> None:
        self.assertIn(
            "PROD-ATTR-4",
            findings_for("/* for codex avatar-group clusters */"),
        )

    def test_other_products(self) -> None:
        self.assertIn("PROD-ATTR-1", findings_for("/* Conductor-style list */"))
        self.assertIn("PROD-ATTR-4", findings_for("/* cursor gutter */"))

    def test_css_files_are_scanned(self) -> None:
        self.assertIn(
            "PROD-ATTR-5",
            findings_for("mark.codex-thread-find-match { color: red; }", suffix=".css"),
        )


class ProductVocabularyAccepted(unittest.TestCase):
    """These are wire contracts and real identifiers, not design attribution."""

    def test_harness_kind_literal(self) -> None:
        self.assertEqual([], findings_for('if (harnessKind === "codex") {}'))

    def test_model_ids(self) -> None:
        self.assertEqual([], findings_for('const ids = ["codex-mini", "codex-max"];'))

    def test_auth_discovery_ids(self) -> None:
        self.assertEqual([], findings_for('discovery: "codex-keychain"'))

    def test_sidecar_package(self) -> None:
        self.assertEqual([], findings_for('import x from "codex-acp";'))

    def test_css_cursor_property(self) -> None:
        self.assertEqual([], findings_for("cursor: pointer;", suffix=".css"))
        self.assertEqual([], findings_for('className="cursor-pointer"'))

    def test_xterm_cursor_option(self) -> None:
        self.assertEqual([], findings_for("term.options.cursorStyle = 'bar';"))

    def test_editor_target_id(self) -> None:
        self.assertEqual(
            [],
            findings_for('type EditorIconId = "cursor" | "vscode" | "zed";'),
        )

    def test_data_row_for_a_harness(self) -> None:
        """`row` is data vocabulary, not a design noun: this is an auth row for
        a harness kind. The identifier form is still rejected above."""
        self.assertEqual(
            [],
            findings_for('it("wires a cursor api_key row", () => {});'),
        )

    def test_prose_about_the_harness(self) -> None:
        self.assertEqual(
            [],
            findings_for("// codex pauses through its goal engine; claude does not"),
        )


if __name__ == "__main__":
    unittest.main()
