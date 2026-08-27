from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_server_fences as check_module

PACKAGE_RELATIVE = "server/proliferate"
SYSTEMS = ("agent_auth", "ai_gateway")


class FenceTestCase(unittest.TestCase):
    """Runs the real engine over a fabricated server/proliferate package."""

    def scan(
        self,
        files: dict[str, str],
        baseline: set[tuple[str, str]],
        systems: tuple[str, ...] = SYSTEMS,
    ) -> check_module.ScanResult:
        """`files` keys are paths relative to server/proliferate/."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name, content in files.items():
                path = root / PACKAGE_RELATIVE / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            return check_module.collect_violations(
                root=root, baseline=baseline, systems=systems
            )


class EdgeBaselineTest(FenceTestCase):
    def test_declared_edge_is_clean(self) -> None:
        result = self.scan(
            {
                "server/billing/foo.py": (
                    "from proliferate.server.ai_gateway.signup_hook import hook\n"
                ),
            },
            baseline={("billing", "ai_gateway")},
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, {("billing", "ai_gateway")})
        self.assertEqual(result.stale_edges, set())

    def test_undeclared_edge_fails_naming_from_and_to(self) -> None:
        result = self.scan(
            {
                "server/billing/foo.py": (
                    "from proliferate.server.agent_auth.service import mint\n"
                ),
            },
            baseline=set(),
        )
        self.assertEqual(len(result.violations), 1)
        violation = result.violations[0]
        self.assertEqual(violation.rule_id, check_module.EDGE_RULE)
        self.assertEqual(
            violation.relative_path, f"{PACKAGE_RELATIVE}/server/billing/foo.py"
        )
        self.assertEqual(
            violation.site,
            f"{PACKAGE_RELATIVE}/server/billing/foo.py"
            "::proliferate.server.agent_auth.service",
        )
        self.assertIn("billing -> agent_auth", violation.detail)
        self.assertIn("record:", violation.format())

    def test_plain_import_statement_counts(self) -> None:
        result = self.scan(
            {
                "server/billing/foo.py": "import proliferate.server.ai_gateway.budget\n",
            },
            baseline=set(),
        )
        self.assertEqual(len(result.violations), 1)
        self.assertEqual(result.edges_seen, {("billing", "ai_gateway")})

    def test_from_server_import_system_form_counts(self) -> None:
        result = self.scan(
            {
                "server/billing/foo.py": "from proliferate.server import agent_auth\n",
            },
            baseline=set(),
        )
        self.assertEqual(len(result.violations), 1)
        self.assertEqual(result.edges_seen, {("billing", "agent_auth")})
        self.assertEqual(
            result.violations[0].site,
            f"{PACKAGE_RELATIVE}/server/billing/foo.py"
            "::proliferate.server.agent_auth",
        )

    def test_stale_baseline_edge_is_reported(self) -> None:
        result = self.scan(
            {
                "server/billing/foo.py": "def f() -> None: ...\n",
            },
            baseline={("billing", "ai_gateway")},
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.stale_edges, {("billing", "ai_gateway")})

    def test_self_import_is_not_an_edge(self) -> None:
        result = self.scan(
            {
                "server/agent_auth/service.py": (
                    "from proliferate.server.agent_auth.models import Snapshot\n"
                ),
            },
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, set())

    def test_unfenced_system_import_is_ignored(self) -> None:
        result = self.scan(
            {
                "server/billing/foo.py": (
                    "from proliferate.server.organizations.service import add_member\n"
                ),
            },
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, set())

    def test_string_dotted_reference_is_not_an_import(self) -> None:
        result = self.scan(
            {
                "server/billing/foo.py": (
                    "def patch(monkeypatch) -> None:\n"
                    "    monkeypatch.setattr(\n"
                    '        "proliferate.server.agent_auth.service.mint", None\n'
                    "    )\n"
                ),
            },
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, set())


class ImporterLabelTest(FenceTestCase):
    def test_package_root_module_label_is_the_filename(self) -> None:
        result = self.scan(
            {
                "main.py": "from proliferate.server.agent_auth.api import router\n",
            },
            baseline={("main.py", "agent_auth")},
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, {("main.py", "agent_auth")})

    def test_code_outside_server_is_labeled_by_first_segment(self) -> None:
        result = self.scan(
            {
                "background/tasks.py": (
                    "from proliferate.server.ai_gateway.worker import loop\n"
                ),
            },
            baseline=set(),
        )
        self.assertEqual(len(result.violations), 1)
        self.assertIn("background -> ai_gateway", result.violations[0].detail)

    def test_cloud_subsystem_carries_the_cloud_label(self) -> None:
        result = self.scan(
            {
                "server/cloud/gateway/service.py": (
                    "from proliferate.server.ai_gateway.budget import remaining\n"
                ),
            },
            baseline=set(),
        )
        self.assertEqual(len(result.violations), 1)
        self.assertIn("cloud/gateway -> ai_gateway", result.violations[0].detail)


class FingerprintTest(FenceTestCase):
    def test_identical_repeated_sites_get_occurrence_ordinals(self) -> None:
        result = self.scan(
            {
                "server/billing/foo.py": (
                    "from proliferate.server.agent_auth.service import mint\n"
                    "from proliferate.server.agent_auth.service import revoke\n"
                ),
            },
            baseline=set(),
        )
        sites = sorted(violation.site for violation in result.violations)
        prefix = (
            f"{PACKAGE_RELATIVE}/server/billing/foo.py"
            "::proliferate.server.agent_auth.service"
        )
        self.assertEqual(sites, [prefix, f"{prefix}#2"])

    def test_comment_reference_is_ignored(self) -> None:
        result = self.scan(
            {
                "server/billing/foo.py": (
                    "# from proliferate.server.agent_auth.service import mint\n"
                ),
            },
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, set())


class RealTreeTest(unittest.TestCase):
    def test_shipped_baseline_equals_reality(self) -> None:
        """The delivery spec's proof bar: the [[edge]] baseline in
        lints/server/fences.toml equals the measured import graph exactly —
        zero undeclared edges and zero stale rows on the actual repo."""
        result = check_module.collect_violations()
        self.assertEqual(
            [violation.format() for violation in result.violations], []
        )
        self.assertEqual(result.stale_edges, set())
        self.assertNotEqual(result.edges_seen, set())

    def test_enforce_mode_exits_zero_on_the_real_tree(self) -> None:
        import contextlib
        import io

        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_module.main([]), 0)


if __name__ == "__main__":
    unittest.main()
