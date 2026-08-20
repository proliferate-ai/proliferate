"""Unit tests for scripts/check_copy_style.py."""

from __future__ import annotations

import unittest

from scripts import check_copy_style as mod


class StringLiteralSpans(unittest.TestCase):
    def _bodies(self, text: str) -> list[str]:
        return [text[s:e] for s, e in mod.string_literal_spans(text)]

    def test_double_and_single_and_template(self):
        self.assertEqual(self._bodies('a = "x"; b = \'y\'; c = `z`;'), ["x", "y", "z"])

    def test_line_comment_is_skipped(self):
        self.assertEqual(self._bodies('const a = 1; // not a — string\n'), [])

    def test_block_comment_is_skipped(self):
        self.assertEqual(self._bodies('/* a — b */ const s = "ok";'), ["ok"])

    def test_escaped_quote_does_not_end_literal(self):
        self.assertEqual(self._bodies(r'"a\"b"'), [r'a\"b'])

    def test_apostrophe_inside_double_quotes(self):
        self.assertEqual(self._bodies('"there\'s one"'), ["there's one"])


class ScanText(unittest.TestCase):
    def _hits(self, text: str) -> int:
        return len(mod.scan_text(mod.REPO_ROOT / "x.ts", text))

    def test_flags_em_dash_in_string(self):
        self.assertEqual(self._hits('const s = "a — b";'), 1)

    def test_ignores_em_dash_in_line_comment(self):
        self.assertEqual(self._hits('// a — b\nconst s = "ok";'), 0)

    def test_ignores_em_dash_in_block_comment(self):
        self.assertEqual(self._hits('/* a — b */\nconst s = "ok";'), 0)

    def test_flags_em_dash_in_template_literal(self):
        self.assertEqual(self._hits('const s = `Step ${n} — ${t}`;'), 1)

    def test_hyphen_and_en_dash_are_allowed(self):
        self.assertEqual(self._hits('const s = "a-b"; const t = "1–2";'), 0)

    def test_clean_string_passes(self):
        self.assertEqual(self._hits('const s = "a. b: c, d";'), 0)

    def test_reports_line_number(self):
        findings = mod.scan_text(mod.REPO_ROOT / "x.ts", '\n\nconst s = "a — b";')
        self.assertEqual(findings[0].lineno, 3)


class RecordWiring(unittest.TestCase):
    def test_rule_record_is_owned_by_this_checker(self):
        self.assertIn(mod.RULE_ID, mod.OWNED_RULE_IDS)


if __name__ == "__main__":
    unittest.main()
