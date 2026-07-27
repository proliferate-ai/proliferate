#!/usr/bin/env python3

"""The guard's whole difficulty is that these names are also real product
vocabulary, so the accept cases matter as much as the reject cases: a guard
that flags `harnessKind === "codex"` would be turned off within a day."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_design_attribution import scan_file


def findings_for(source: str, suffix: str = ".tsx") -> list[str]:
    with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False) as handle:
        handle.write(source)
        path = Path(handle.name)
    try:
        return [rule for _lineno, rule, _snippet, _hint in scan_file(path)]
    finally:
        path.unlink()


class AttributionRejected(unittest.TestCase):
    def test_style_suffix(self) -> None:
        self.assertIn("attributed-style", findings_for("/* Codex-style dot */"))

    def test_possessive_style(self) -> None:
        self.assertIn("attributed-style", findings_for("// codex's style here"))

    def test_recipe_language(self) -> None:
        self.assertIn("attributed-recipe", findings_for("/* codex popover recipe */"))

    def test_anatomy_language(self) -> None:
        self.assertIn("attributed-recipe", findings_for("// Codex anatomy has no footer"))

    def test_reference_dump_path(self) -> None:
        self.assertIn(
            "reference-dump-path",
            findings_for("/* see reference/codex/status/card.html */"),
        )

    def test_shipped_identifier(self) -> None:
        self.assertIn(
            "attributed-identifier",
            findings_for('className="codex-thread-find-match"'),
        )

    def test_bare_product_plus_design_noun(self) -> None:
        self.assertIn(
            "attributed-treatment",
            findings_for("/* for codex avatar-group clusters */"),
        )

    def test_other_products(self) -> None:
        self.assertIn("attributed-style", findings_for("/* Conductor-style list */"))
        self.assertIn("attributed-treatment", findings_for("/* cursor gutter */"))

    def test_css_files_are_scanned(self) -> None:
        self.assertIn(
            "attributed-identifier",
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

    def test_prose_about_the_harness(self) -> None:
        self.assertEqual(
            [],
            findings_for("// codex pauses through its goal engine; claude does not"),
        )


if __name__ == "__main__":
    unittest.main()
