"""Pinning tests for the lints/ record loader and diagnostic renderer.

These tests are constitution-backed: they pin that records validate strictly,
that exception ledgers are fine-grained sites (never counts), and that
diagnostics always carry the rule, the alternative, and the record path.
Deleting or weakening them is an amendment requiring founder approval.
"""

from __future__ import annotations

import textwrap
import unittest
from contextlib import redirect_stdout
from io import StringIO
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
            self._load_with("server", {"a.toml": VALID_RULE, "b.toml": VALID_RULE})
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
            self._load_with("server", {"test.toml": VALID_RULE, "exceptions.toml": counted})
        self.assertIn("missing fields", str(ctx.exception))

    def test_dangling_exception_rule_fails(self) -> None:
        dangling = VALID_EXCEPTION.replace("SRV-TEST-1", "SRV-GONE-9")
        with self.assertRaises(SystemExit) as ctx:
            self._load_with("server", {"test.toml": VALID_RULE, "exceptions.toml": dangling})
        self.assertIn("unknown rule ids", str(ctx.exception))

    def test_enforced_by_missing_file_fails(self) -> None:
        # A rule that claims a checker but names no real file is a green light
        # nobody can trust: `status = "law"` would pass with zero enforcement.
        broken = VALID_RULE.replace(
            'enforced_by = "scripts/check_server_boundaries.py"',
            'enforced_by = "scripts/does_not_exist.py"',
        )
        with self.assertRaises(SystemExit) as ctx:
            self._load_with("server", {"test.toml": broken})
        message = str(ctx.exception)
        self.assertIn("SRV-TEST-1", message)
        self.assertIn("scripts/does_not_exist.py", message)
        self.assertIn("is not a file", message)

    def test_enforced_by_existing_script_loads(self) -> None:
        ruleset = self._load_with("server", {"test.toml": VALID_RULE})
        self.assertEqual(
            ruleset.rule("SRV-TEST-1").enforced_by,
            "scripts/check_server_boundaries.py",
        )

    def test_review_mode_exempts_enforced_by_from_the_file_check(self) -> None:
        # `mode = "review"` is the documented escape hatch (lints/server/gaps.toml):
        # no checker exists yet, so `enforced_by = "review"` is a sentinel, not
        # a path, and must not be required to resolve to a file.
        reviewed = VALID_RULE.replace(
            'enforced_by = "scripts/check_server_boundaries.py"', 'enforced_by = "review"'
        ).replace('mode = "lint"', 'mode = "review"')
        ruleset = self._load_with("server", {"test.toml": reviewed})
        self.assertEqual(ruleset.rule("SRV-TEST-1").enforced_by, "review")

    def test_unknown_rule_lookup_fails(self) -> None:
        ruleset = self._load_with("server", {"test.toml": VALID_RULE})
        with self.assertRaises(SystemExit):
            ruleset.rule("SRV-NOPE-1")

    def test_law_rule_with_a_ledger_entry_fails(self) -> None:
        # `law` is a claim of zero exceptions; a ledger entry makes it a lie.
        law = VALID_RULE.replace('status = "holds"', 'status = "law"')
        with self.assertRaises(SystemExit) as ctx:
            self._load_with("server", {"test.toml": law, "exceptions.toml": VALID_EXCEPTION})
        message = str(ctx.exception)
        self.assertIn("SRV-TEST-1", message)
        self.assertIn("status 'law' means zero exceptions", message)
        self.assertIn("(server/thing.py, handler::forbidden)", message)

    def test_leaks_rule_without_a_gap_fails(self) -> None:
        # `leaks` is a claim that the hole is tracked; no gap means it is not.
        leaks = VALID_RULE.replace('status = "holds"', 'status = "leaks"')
        with self.assertRaises(SystemExit) as ctx:
            self._load_with("server", {"test.toml": leaks})
        message = str(ctx.exception)
        self.assertIn("SRV-TEST-1", message)
        self.assertIn("must carry a gap", message)

    def test_leaks_rule_with_a_gap_loads(self) -> None:
        leaks = VALID_RULE.replace('status = "holds"', 'status = "leaks"').replace(
            'mode = "lint"', 'mode = "lint"\ngap = "#1234"'
        )
        ruleset = self._load_with("server", {"test.toml": leaks})
        self.assertEqual(ruleset.rule("SRV-TEST-1").gap, "#1234")

    def test_prose_gap_fails(self) -> None:
        # A gap is an issue reference, not a paragraph; prose belongs in `why`.
        prose = VALID_RULE.replace('mode = "lint"', 'mode = "lint"\ngap = "the checker misses X"')
        with self.assertRaises(SystemExit) as ctx:
            self._load_with("server", {"test.toml": prose})
        message = str(ctx.exception)
        self.assertIn("SRV-TEST-1", message)
        self.assertIn("issue reference", message)

    def test_malformed_toml_fails_with_the_record_path(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            self._load_with("server", {"test.toml": "[[rule]\nid = "})
        message = str(ctx.exception)
        self.assertIn("test.toml", message)
        self.assertIn("malformed TOML", message)


class MainFloorTests(unittest.TestCase):
    """`main()` must not be able to report success on an empty constitution."""

    def _lints_root(self, owners: dict[str, str]) -> Path:
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for owner, content in owners.items():
            owner_dir = root / owner
            owner_dir.mkdir(parents=True)
            (owner_dir / "test.toml").write_text(content, encoding="utf-8")
        return root

    def _rule_for(self, owner: str, rule_id: str) -> str:
        return VALID_RULE.replace('owner = "server"', f'owner = "{owner}"').replace(
            'id = "SRV-TEST-1"', f'id = "{rule_id}"'
        )

    def test_missing_lints_tree_fails(self) -> None:
        root = self._lints_root({})
        with mock.patch.object(lint_records, "LINTS_ROOT", root / "gone"):
            with self.assertRaises(SystemExit) as ctx:
                lint_records.main()
        self.assertIn("no rule records found", str(ctx.exception))

    def test_owner_with_zero_records_fails(self) -> None:
        root = self._lints_root(
            {
                "anyharness": self._rule_for("anyharness", "AH-TEST-1"),
                "server": self._rule_for("server", "SRV-TEST-1"),
                "frontend": self._rule_for("frontend", "FE-TEST-1"),
            }
        )
        with mock.patch.object(lint_records, "LINTS_ROOT", root):
            with self.assertRaises(SystemExit) as ctx:
                lint_records.main()
        self.assertIn("owners with zero rule records: product", str(ctx.exception))

    def test_all_four_owners_present_passes(self) -> None:
        root = self._lints_root(
            {
                "anyharness": self._rule_for("anyharness", "AH-TEST-1"),
                "server": self._rule_for("server", "SRV-TEST-1"),
                "frontend": self._rule_for("frontend", "FE-TEST-1"),
                "product": self._rule_for("product", "PROD-TEST-1"),
            }
        )
        with (
            mock.patch.object(lint_records, "LINTS_ROOT", root),
            redirect_stdout(StringIO()) as output,
        ):
            self.assertEqual(lint_records.main(), 0)
        self.assertIn("4 rules", output.getvalue())


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
