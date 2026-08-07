"""Pinning tests for the lints/ record loader and diagnostic renderer.

These tests are constitution-backed: they pin that records validate strictly,
that exception ledgers are fine-grained sites (never counts), and that
diagnostics always carry the rule, the alternative, and the record path.
Deleting or weakening them is an amendment requiring founder approval.
"""

from __future__ import annotations

import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from scripts import lint_records

VALID_RULE = textwrap.dedent(
    """
    [[rule]]
    id = "SRV-TEST-1"
    title = "Test rule"
    owner = "server"
    status = "holds"
    enforced_by = "scripts/check_server_boundaries.py"
    mode = "lint"
    rule = "Do not do the forbidden thing."
    alternative = "Do the legal thing."
    why = "Because of the 2026-01-01 incident."

    [rule.example]
    bad = "forbidden()"
    good = "legal()"
    """
)

VALID_EXCEPTION = textwrap.dedent(
    """
    [[exception]]
    rule = "SRV-TEST-1"
    path = "server/thing.py"
    site = "handler::forbidden"
    reason = "grandfathered during migration"
    """
)


class LoaderTests(unittest.TestCase):
    def _load_with(self, owner: str, files: dict[str, str]) -> lint_records.RuleSet:
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        owner_dir = root / owner
        owner_dir.mkdir(parents=True)
        for name, content in files.items():
            (owner_dir / name).write_text(content, encoding="utf-8")
        with mock.patch.object(lint_records, "LINTS_ROOT", root):
            return lint_records.load()

    def test_valid_rule_and_exception_load(self) -> None:
        ruleset = self._load_with(
            "server", {"test.toml": VALID_RULE, "exceptions.toml": VALID_EXCEPTION}
        )
        rule = ruleset.rule("SRV-TEST-1")
        self.assertEqual(rule.title, "Test rule")
        self.assertEqual(
            ruleset.exception_sites("SRV-TEST-1"),
            {("server/thing.py", "handler::forbidden")},
        )

    def test_missing_required_field_fails(self) -> None:
        broken = VALID_RULE.replace('why = "Because of the 2026-01-01 incident."\n', "")
        with self.assertRaises(SystemExit) as ctx:
            self._load_with("server", {"test.toml": broken})
        self.assertIn("missing fields: why", str(ctx.exception))

    def test_unknown_status_fails(self) -> None:
        broken = VALID_RULE.replace('status = "holds"', 'status = "target"')
        with self.assertRaises(SystemExit) as ctx:
            self._load_with("server", {"test.toml": broken})
        self.assertIn("status", str(ctx.exception))

    def test_duplicate_rule_id_fails(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            self._load_with(
                "server", {"a.toml": VALID_RULE, "b.toml": VALID_RULE}
            )
        self.assertIn("duplicate rule id", str(ctx.exception))

    def test_exception_without_site_fails(self) -> None:
        counted = textwrap.dedent(
            """
            [[exception]]
            rule = "SRV-TEST-1"
            path = "server/thing.py"
            reason = "a count, not a site"
            """
        )
        with self.assertRaises(SystemExit) as ctx:
            self._load_with(
                "server", {"test.toml": VALID_RULE, "exceptions.toml": counted}
            )
        self.assertIn("missing fields", str(ctx.exception))

    def test_dangling_exception_rule_fails(self) -> None:
        dangling = VALID_EXCEPTION.replace("SRV-TEST-1", "SRV-GONE-9")
        with self.assertRaises(SystemExit) as ctx:
            self._load_with(
                "server", {"test.toml": VALID_RULE, "exceptions.toml": dangling}
            )
        self.assertIn("unknown rule ids", str(ctx.exception))

    def test_unknown_rule_lookup_fails(self) -> None:
        ruleset = self._load_with("server", {"test.toml": VALID_RULE})
        with self.assertRaises(SystemExit):
            ruleset.rule("SRV-NOPE-1")


class DiagnosticTests(unittest.TestCase):
    def _rule(self) -> lint_records.Rule:
        return lint_records.Rule(
            id="SRV-TEST-1",
            title="Test rule",
            owner="server",
            status="holds",
            enforced_by="scripts/check_server_boundaries.py",
            mode="lint",
            rule="Do not do the forbidden thing.",
            alternative="Do the legal thing.",
            why="Because.",
            example_good="legal()",
            source="lints/server/test.toml",
        )

    def test_diagnostic_is_a_remediation_prompt(self) -> None:
        text = lint_records.render_diagnostic(
            self._rule(), "server/thing.py:12", detail="forbidden()"
        )
        self.assertIn("SRV-TEST-1", text)
        self.assertIn("Do not do the forbidden thing.", text)
        self.assertIn("instead: Do the legal thing.", text)
        self.assertIn("lints/server/test.toml", text)
        self.assertIn("founder approval", text)


if __name__ == "__main__":
    unittest.main()
