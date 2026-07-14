from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import check_docs


class DocumentationIntegrityTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
