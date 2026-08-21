"""Unit tests for scripts/check_copy_style.py."""

from __future__ import annotations

import unittest

from scripts import check_copy_style as mod


class EmDashLines(unittest.TestCase):
    def hits(self, text: str) -> list[int]:
        return mod.em_dash_lines(text)

    def test_flags_em_dash_in_double_quoted_string(self):
        self.assertEqual(self.hits('const s = "a — b";'), [1])

    def test_flags_em_dash_in_single_quoted_string(self):
        self.assertEqual(self.hits("const s = 'a — b';"), [1])

    def test_flags_em_dash_in_template_literal(self):
        self.assertEqual(self.hits("const s = `Step ${n} — ${t}`;"), [1])

    def test_ignores_em_dash_in_line_comment(self):
        self.assertEqual(self.hits("// a — b\nconst s = \"ok\";"), [])

    def test_ignores_em_dash_in_block_comment(self):
        self.assertEqual(self.hits("/* a — b\n c — d */\nconst s = \"ok\";"), [])

    def test_slashes_inside_string_are_not_a_comment(self):
        # the // is inside the string, so the em dash after it is still copy
        self.assertEqual(self.hits('const s = "http:// — x";'), [1])

    def test_nested_template_does_not_end_outer_early(self):
        # em dash sits in the OUTER template, after a nested `${`...`}` template.
        # The pre-fix scanner ended the outer template at the inner backtick and
        # missed this. It must be caught.
        self.assertEqual(self.hits("const s = `a ${`inner`} — b`;"), [1])

    def test_em_dash_inside_nested_template_is_caught(self):
        self.assertEqual(self.hits("const s = `a ${`in — ner`} b`;"), [1])

    def test_hyphen_and_en_dash_allowed(self):
        self.assertEqual(self.hits('const s = "a-b"; const t = "1–2";'), [])

    def test_clean_copy_passes(self):
        self.assertEqual(self.hits('const s = "a. b: c, d";'), [])

    def test_reports_correct_line_number(self):
        self.assertEqual(self.hits('\n\nconst s = "a — b";'), [3])

    def test_multiple_hits_across_lines(self):
        self.assertEqual(self.hits('const a = "x — y";\nconst b = "p — q";'), [1, 2])

    def test_escaped_quote_does_not_end_string(self):
        self.assertEqual(self.hits(r'const s = "a\" — b";'), [1])


class RecordWiring(unittest.TestCase):
    def test_rule_record_owned_by_this_checker(self):
        self.assertIn(mod.RULE_ID, mod.OWNED_RULE_IDS)

    def test_example_is_populated_from_record(self):
        # Guards Greptile's finding: examples must load from [rule.example].
        rule = mod.RULES.rules[mod.RULE_ID]
        self.assertTrue(rule.example_good)
        self.assertNotIn(mod.EM_DASH, rule.example_good)


if __name__ == "__main__":
    unittest.main()
