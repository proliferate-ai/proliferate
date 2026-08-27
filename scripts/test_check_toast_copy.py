#!/usr/bin/env python3

"""The accept cases carry the weight here. Interpolation into a toast is normal
and good — `show(`Joined ${org.name}.`)` names the thing it is about, which is
the rule the rest of this system is built on. What is banned is narrower: the
exception in the line a person reads. A guard that flagged every template
literal would ban the good shape along with the bad one."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_toast_copy
from scripts.check_toast_copy import scan_file


def scanned(source: str, suffix: str = ".ts") -> list[check_toast_copy.Finding]:
    with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False) as handle:
        handle.write(source)
        path = Path(handle.name)
    try:
        return scan_file(path)
    finally:
        path.unlink()


def findings_for(source: str, suffix: str = ".ts") -> list[str]:
    return [finding.rule_id for finding in scanned(source, suffix)]


class RecordCoverageTest(unittest.TestCase):
    """Every rule this checker claims must have a record, and vice versa."""

    def test_checker_owns_exactly_the_prod_copy_records(self) -> None:
        self.assertEqual(
            check_toast_copy.OWNED_RULE_IDS,
            frozenset({"PROD-COPY-1", "PROD-COPY-2"}),
        )

    def test_every_pattern_names_an_owned_record(self) -> None:
        self.assertEqual(
            {rule_id for rule_id, _pattern in check_toast_copy.PATTERNS},
            set(check_toast_copy.OWNED_RULE_IDS),
        )

    def test_diagnostic_cites_the_rule_and_the_record(self) -> None:
        diagnostic = scanned("headline: `Failed to open ${name}`,")[0].format()
        self.assertIn("PROD-COPY-1", diagnostic)
        self.assertIn("lints/product/toast-copy.toml", diagnostic)
        self.assertIn("instead: A headline is a written line, not a built", diagnostic)


class HeadlineRejected(unittest.TestCase):
    def test_interpolated_template(self) -> None:
        self.assertIn(
            "PROD-COPY-1",
            findings_for("headline: `Failed to open ${name}`,"),
        )

    def test_concatenated_literal(self) -> None:
        self.assertIn(
            "PROD-COPY-1",
            findings_for('headline: "Failed to open " + name,'),
        )

    def test_concatenated_binding_first(self) -> None:
        self.assertIn(
            "PROD-COPY-1",
            findings_for("headline: prefix + reason,"),
        )


class WrappedCallsAreNotAnEscapeHatch(unittest.TestCase):
    """Prettier wraps a long call, so the banned shape arrives split across lines
    at least as often as it arrives on one. A line-by-line scan sees only
    fragments — neither line holds both the call and the interpolation — which
    made the wrapped form a silent way around an otherwise absolute ban."""

    def test_wrapped_toast_call(self) -> None:
        self.assertIn(
            "PROD-COPY-2",
            findings_for(
                "showToast(\n  `Couldn't save the workspace: ${errorMessage(error)}`,\n);",
            ),
        )

    def test_wrapped_headline_value(self) -> None:
        self.assertIn(
            "PROD-COPY-1",
            findings_for(
                'toastError({\n  headline:\n    "Couldn\'t save "\n    + target,\n});',
            ),
        )

    def test_a_wrapped_property_does_not_reach_into_the_next_one(self) -> None:
        """The comma that ends a property is what bounds the concatenation arms,
        so a clean headline followed by a legitimately built `consequence` still
        passes. Without this the widened pattern would flag the good shape."""
        self.assertEqual(
            [],
            findings_for(
                "toastError({\n"
                '  headline: "Message not sent",\n'
                "  consequence:\n"
                '    "Still in the composer, unsent on "\n'
                "    + target.label,\n"
                "});",
            ),
        )


class ErrorInMessageRejected(unittest.TestCase):
    def test_the_original_failure(self) -> None:
        """The exact line the sweep was written to delete."""
        self.assertIn(
            "PROD-COPY-2",
            findings_for(
                "showToast(`Failed to send queued message next: ${errorMessage(error)}`);",
            ),
        )

    def test_bare_error_binding(self) -> None:
        self.assertIn(
            "PROD-COPY-2",
            findings_for("showToast(`Failed to start work: ${error}`);"),
        )

    def test_concatenated_form(self) -> None:
        self.assertIn(
            "PROD-COPY-2",
            findings_for('showToast("Failed to start work: " + err);'),
        )

    def test_every_toast_entry_point(self) -> None:
        for call in (
            "showToast",
            "toastError",
            "showProductToast",
            "showProductErrorToast",
            "showError",
        ):
            with self.subTest(call=call):
                self.assertIn(
                    "PROD-COPY-2",
                    findings_for(f"{call}(`Could not save: ${{message}}`);"),
                )


class Accepted(unittest.TestCase):
    def test_written_headline(self) -> None:
        self.assertEqual([], findings_for('headline: "Message not sent",'))

    def test_interpolated_consequence(self) -> None:
        """`consequence` is where the specific model/target/repo belongs, so
        interpolation there is the rule being followed, not broken."""
        self.assertEqual(
            [],
            findings_for("consequence: `${target.label} did not open this workspace.`,"),
        )

    def test_exception_in_cause(self) -> None:
        self.assertEqual(
            [],
            findings_for("cause: error instanceof Error ? error.message : String(error),"),
        )

    def test_ordinary_interpolated_status_line(self) -> None:
        self.assertEqual([], findings_for("showToast(`Joined ${org.name}.`);"))

    def test_status_line_naming_a_command(self) -> None:
        self.assertEqual([], findings_for("showToast(`Running ${runCommand}.`);"))

    def test_non_toast_error_interpolation(self) -> None:
        """Logs and thrown errors are allowed to interpolate exceptions; only the
        toast surface is constrained."""
        self.assertEqual(
            [],
            findings_for("logLatency(`send failed: ${errorMessage(error)}`);"),
        )

    def test_structured_error_call(self) -> None:
        self.assertEqual(
            [],
            findings_for(
                'showErrorToast({ headline: "Message not sent", cause: errorMessage(error) });',
            ),
        )


if __name__ == "__main__":
    unittest.main()
