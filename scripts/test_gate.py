"""Unit tests for scripts/gate — the pre-push gate's scoping logic.

Pins: path→plane classification, crate derivation, domain→test mapping, the
services-unreachable skip branch, and the MIRROR RULE (every gate command
string appears verbatim, modulo whitespace folding, in the workflow that runs
it in CI — the one documented divergence being the mypy ratchet's local
`--compare-ref origin/main` vs CI's event-specific `--github-event-base`).
"""

from __future__ import annotations

import importlib.util
import re
import sys
import tempfile
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def _load_gate():
    # `scripts/gate` has no .py suffix, so name the loader explicitly.
    loader = SourceFileLoader("gate", str(REPO / "scripts" / "gate"))
    spec = importlib.util.spec_from_loader("gate", loader)
    module = importlib.util.module_from_spec(spec)
    sys.modules["gate"] = module  # dataclasses resolve annotations via sys.modules
    loader.exec_module(module)
    return module


gate = _load_gate()


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", text)


class ClassifyTests(unittest.TestCase):
    def test_server_domain_extraction(self):
        scope = gate.classify(
            [
                "server/proliferate/server/billing/service.py",
                "server/proliferate/server/cloud/gateway/routes.py",
                "server/proliferate/lib/email.py",
            ]
        )
        self.assertTrue(scope.server)
        self.assertEqual(scope.server_domains, {"billing", "gateway"})

    def test_server_root_file_is_no_domain(self):
        scope = gate.classify(["server/proliferate/server/main.py"])
        self.assertTrue(scope.server)
        self.assertEqual(scope.server_domains, set())

    def test_rust_paths_and_workspace(self):
        scope = gate.classify(
            [
                "anyharness/crates/anyharness-lib/src/domains/sessions/mod.rs",
                "Cargo.lock",
                "apps/desktop/src-tauri/src/main.rs",
            ]
        )
        self.assertEqual(len(scope.rust_paths), 2)
        self.assertTrue(scope.rust_workspace)

    def test_src_tauri_is_rust_not_desktop_frontend(self):
        scope = gate.classify(["apps/desktop/src-tauri/src/main.rs"])
        self.assertFalse(scope.desktop)
        self.assertTrue(scope.rust_paths)

    def test_frontend_flags(self):
        scope = gate.classify(
            [
                "apps/packages/product-client/src/domain/x.ts",
                "apps/packages/design/src/tokens.ts",
                "apps/web/src/App.tsx",
                "apps/desktop/src/main.tsx",
                "apps/mobile/App.tsx",
                "anyharness/sdk/src/index.ts",
                "anyharness/sdk-react/src/hooks.ts",
                "cloud/sdk/src/client.ts",
            ]
        )
        self.assertTrue(scope.shared_frontend)
        self.assertEqual(
            scope.product_client_srcs, ["apps/packages/product-client/src/domain/x.ts"]
        )
        self.assertTrue(scope.design)
        self.assertTrue(scope.web)
        self.assertTrue(scope.desktop)
        self.assertTrue(scope.mobile)
        self.assertTrue(scope.sdk)
        self.assertTrue(scope.sdk_react)

    def test_docs_and_scripts(self):
        scope = gate.classify(["specs/engineering/testing/README.md", "scripts/check_docs.py"])
        self.assertTrue(scope.docs)
        self.assertTrue(scope.scripts)

    def test_md_anywhere_is_docs(self):
        self.assertTrue(gate.classify(["anyharness/README.md"]).docs)

    def test_cicd_mjs_and_root_manifests_have_planes(self):
        scope = gate.classify(["scripts/ci-cd/pr-metadata.mjs", "package.json", "pnpm-lock.yaml"])
        self.assertTrue(scope.cicd)
        self.assertTrue(scope.shared_frontend)
        self.assertEqual(scope.unmapped, [])

    def test_changed_server_tests_are_collected(self):
        scope = gate.classify(["server/tests/unit/test_billing_domain.py"])
        self.assertEqual(scope.server_changed_tests, ["tests/unit/test_billing_domain.py"])

    def test_unknown_paths_are_reported_unmapped(self):
        scope = gate.classify(["random/thing.xyz", "scripts/git-hooks/pre-push"])
        self.assertEqual(scope.unmapped, ["random/thing.xyz", "scripts/git-hooks/pre-push"])


class CrateTests(unittest.TestCase):
    def test_crate_name_parses_package_section_only(self):
        text = '[workspace]\nmembers = ["a"]\n\n[package]\nname = "my-crate"\nversion = "0.1.0"\n'
        self.assertEqual(gate.crate_name(text), "my-crate")

    def test_crate_name_ignores_dependency_names(self):
        text = '[dependencies]\nname_like = "1"\n'
        self.assertIsNone(gate.crate_name(text))

    def test_crates_for_paths_walks_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            crate = repo / "anyharness" / "crates" / "demo"
            (crate / "src").mkdir(parents=True)
            (crate / "Cargo.toml").write_text('[package]\nname = "demo-crate"\n')
            (crate / "src" / "lib.rs").write_text("")
            names = gate.crates_for_paths(["anyharness/crates/demo/src/lib.rs"], repo)
            self.assertEqual(names, {"demo-crate"})

    def test_crates_for_paths_missing_manifest_is_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            (repo / "x").mkdir()
            (repo / "x" / "a.rs").write_text("")
            self.assertEqual(gate.crates_for_paths(["x/a.rs"], repo), set())


class ServerTestMappingTests(unittest.TestCase):
    def _make_repo(self, tmp: str) -> Path:
        repo = Path(tmp)
        for tier in ("unit", "integration"):
            (repo / "server" / "tests" / tier).mkdir(parents=True)
        (repo / "server" / "tests" / "unit" / "test_billing_usage_api.py").write_text("")
        (repo / "server" / "tests" / "integration" / "test_billing_flow.py").write_text("")
        (repo / "server" / "tests" / "unit" / "test_github_webhooks.py").write_text("")
        return repo

    def test_domain_maps_to_matching_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_repo(tmp)
            files = gate.server_test_files({"billing"}, repo)
            self.assertEqual(
                files,
                [
                    "tests/integration/test_billing_flow.py",
                    "tests/unit/test_billing_usage_api.py",
                ],
            )

    def test_empty_mapping_for_unknown_domain(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self._make_repo(tmp)
            self.assertEqual(gate.server_test_files({"workflows"}, repo), [])


class BuildChecksTests(unittest.TestCase):
    def _base_kwargs(self, **overrides):
        kwargs = dict(
            repo=REPO,
            postgres_up=True,
            redis_up=True,
            have_uv=True,
            have_pnpm=True,
            have_cargo=True,
        )
        kwargs.update(overrides)
        return kwargs

    def test_docs_only_diff_runs_exactly_the_always_set(self):
        scope = gate.classify(["specs/engineering/testing/README.md"])
        checks = gate.build_checks(scope, **self._base_kwargs())
        self.assertEqual(len(checks), len(gate.ALWAYS_ENGINES))
        self.assertEqual({c.name for c in checks}, {n for n, _ in gate.ALWAYS_ENGINES})

    def test_services_down_skips_tests_loudly_and_keeps_lint(self):
        scope = gate.classify(["server/proliferate/server/billing/service.py"])
        checks = gate.build_checks(scope, **self._base_kwargs(postgres_up=False))
        skips = [c for c in checks if c.cmd is None]
        self.assertTrue(any("postgres:5432" in (c.skip_reason or "") for c in skips))
        self.assertTrue(all(c.loud for c in skips))
        names = {c.name for c in checks}
        self.assertIn("server: ruff check", names)
        self.assertIn("server: mypy ratchet", names)
        self.assertFalse(any("pytest" in (c.cmd or "") for c in checks))

    def test_services_up_runs_domain_tests_at_n2_with_ci_env(self):
        scope = gate.classify(["server/proliferate/server/billing/service.py"])
        checks = gate.build_checks(scope, **self._base_kwargs())
        pytest_checks = [c for c in checks if c.cmd and " pytest " in f" {c.cmd} "]
        self.assertTrue(pytest_checks, "the real repo has billing tests")
        self.assertIn("-n 2", pytest_checks[0].cmd)
        self.assertEqual(pytest_checks[0].cwd, "server")
        self.assertEqual(pytest_checks[0].env_defaults, gate.SERVER_TEST_ENV)

    def test_missing_uv_is_one_loud_skip(self):
        scope = gate.classify(["server/proliferate/server/billing/service.py"])
        checks = gate.build_checks(scope, **self._base_kwargs(have_uv=False))
        server_checks = [c for c in checks if c.name.startswith("server:")]
        self.assertEqual(len(server_checks), 1)
        self.assertIsNone(server_checks[0].cmd)
        self.assertTrue(server_checks[0].loud)

    def test_workspace_change_widens_rust_target(self):
        scope = gate.classify(["Cargo.lock"])
        checks = gate.build_checks(scope, **self._base_kwargs())
        clippy = next(c for c in checks if c.name.startswith("rust: clippy"))
        self.assertIn("--workspace", clippy.cmd)
        # Gating since lint-wiring: same -D warnings semantics as the
        # rust-lint CI job, under the workspace allow-list.
        self.assertIn("-D warnings", clippy.cmd)

    def test_rust_fmt_gates_alongside_its_ci_job(self):
        # The two flips landed together (lint-wiring): the gate's fmt check
        # and ci.yml's rust-lint fmt step are the same command, both gating.
        scope = gate.classify(["anyharness/crates/anyharness-lib/src/lib.rs"])
        checks = gate.build_checks(scope, **self._base_kwargs())
        fmt = next(c for c in checks if c.name.startswith("rust: fmt"))
        self.assertFalse(fmt.advisory)

    def test_empty_domain_server_diff_is_a_loud_no_test_note(self):
        scope = gate.classify(["server/proliferate/lib/email.py"])
        checks = gate.build_checks(scope, **self._base_kwargs())
        note = next(c for c in checks if c.name == "server: tests")
        self.assertIsNone(note.cmd)
        self.assertTrue(note.loud)
        self.assertIn("CI runs the full suite", note.skip_reason)

    def test_changed_test_files_run_even_without_a_domain(self):
        scope = gate.classify(["server/tests/unit/test_billing_domain.py"])
        checks = gate.build_checks(scope, **self._base_kwargs())
        pytest_check = next(c for c in checks if c.cmd and " pytest " in f" {c.cmd} ")
        self.assertIn("tests/unit/test_billing_domain.py", pytest_check.cmd)

    def test_no_engine_python_turns_engine_checks_into_loud_skips(self):
        scope = gate.classify(["specs/x.md"])
        checks = gate.build_checks(scope, **self._base_kwargs())
        adjusted = gate.apply_engine_availability(checks, None)
        engine_checks = [c for c in adjusted if c.name in {n for n, _ in gate.ALWAYS_ENGINES}]
        self.assertTrue(engine_checks)
        self.assertTrue(all(c.cmd is None and c.loud for c in engine_checks))
        untouched = gate.apply_engine_availability(checks, "/opt/py312")
        self.assertIs(untouched, checks)

    def test_missing_nextest_is_a_loud_skip_not_a_fail(self):
        scope = gate.classify(["anyharness/crates/anyharness-lib/src/lib.rs"])
        checks = gate.build_checks(scope, **self._base_kwargs(have_nextest=False))
        nextest = next(c for c in checks if c.name == "rust: nextest")
        self.assertIsNone(nextest.cmd)
        self.assertTrue(nextest.loud)
        self.assertTrue(any(c.name.startswith("rust: clippy") and c.cmd for c in checks))

    def test_scripts_diff_adds_checker_proofs(self):
        scope = gate.classify(["scripts/check_docs.py"])
        checks = gate.build_checks(scope, **self._base_kwargs())
        self.assertTrue(any(c.name.startswith("checker tests:") for c in checks))


class EnginePythonTests(unittest.TestCase):
    def test_prefers_first_candidate_with_tomllib(self):
        probed = []

        def prober(python):
            probed.append(python)
            return python.endswith("3.12")

        # sys.executable is probed first; our fake prober rejects it unless 3.12.
        result = gate.pick_engine_python(prober=prober)
        if result is not None:
            self.assertTrue(result.endswith("3.12"))
        self.assertGreaterEqual(len(probed), 1)

    def test_returns_none_when_nothing_has_tomllib(self):
        self.assertIsNone(gate.pick_engine_python(prober=lambda p: False))

    def test_engine_argv_rewrites_only_python3_prefix(self):
        self.assertEqual(
            gate.engine_argv("python3 scripts/check_docs.py", "/opt/py312")[0], "/opt/py312"
        )
        self.assertEqual(
            gate.engine_argv("python3 -m unittest scripts/test_gate.py", "/opt/py312")[:3],
            ["/opt/py312", "-m", "unittest"],
        )
        self.assertEqual(gate.engine_argv("cargo fmt --check", "/opt/py312")[0], "cargo")
        self.assertEqual(gate.engine_argv("python3 scripts/check_docs.py", None)[0], "python3")


class DarwinClippyCarveOutTests(unittest.TestCase):
    """Linux CI is the desktop crate's clippy authority: a macOS gate run
    excludes it LOUDLY (or skips loudly when there is nothing else to lint),
    and a Linux gate run stays byte-identical to CI — no platform residue."""

    def _base_kwargs(self, **overrides):
        kwargs = dict(
            repo=REPO,
            postgres_up=True,
            redis_up=True,
            have_uv=True,
            have_pnpm=True,
            have_cargo=True,
        )
        kwargs.update(overrides)
        return kwargs

    def _clippy(self, checks):
        matches = [c for c in checks if c.name.startswith("rust: clippy")]
        self.assertEqual(len(matches), 1, "exactly one clippy check per run")
        return matches[0]

    def test_linux_workspace_command_is_platform_unmarked(self):
        scope = gate.classify(["Cargo.toml"])
        checks = gate.build_checks(scope, **self._base_kwargs(platform="linux"))
        clippy = self._clippy(checks)
        self.assertEqual(clippy.name, "rust: clippy")
        self.assertIn("--workspace", clippy.cmd)
        self.assertNotIn("--exclude", clippy.cmd)

    def test_darwin_workspace_excludes_both_desktop_crates_with_the_note(self):
        scope = gate.classify(["Cargo.toml"])
        checks = gate.build_checks(scope, **self._base_kwargs(platform="darwin"))
        clippy = self._clippy(checks)
        self.assertIn("Linux CI is its clippy authority", clippy.name)
        self.assertIn("--exclude proliferate-debug", clippy.cmd)
        # The lib crate too, not just the debug shell (which would re-lint it
        # as a path dependency).
        self.assertIn("--exclude proliferate ", clippy.cmd + " ")

    def test_darwin_mixed_diff_keeps_touched_crates_and_drops_desktop(self):
        scope = gate.classify(
            [
                "anyharness/crates/anyharness-lib/src/lib.rs",
                "apps/desktop/src-tauri/src/lib.rs",
            ]
        )
        checks = gate.build_checks(scope, **self._base_kwargs(platform="darwin"))
        clippy = self._clippy(checks)
        self.assertIn("-p anyharness-lib", clippy.cmd)
        self.assertNotIn("-p proliferate", clippy.cmd)
        self.assertIn("Linux CI is its clippy authority", clippy.name)

    def test_darwin_desktop_only_diff_skips_loudly_instead_of_linting_the_rest(self):
        scope = gate.classify(["apps/desktop/src-tauri/src/lib.rs"])
        checks = gate.build_checks(scope, **self._base_kwargs(platform="darwin"))
        clippy = self._clippy(checks)
        self.assertIsNone(clippy.cmd)
        self.assertTrue(clippy.loud)
        self.assertIn("Linux CI is its clippy authority", clippy.skip_reason)


class MirrorRuleTests(unittest.TestCase):
    """Every gate command string appears in the CI workflow that runs it."""

    @classmethod
    def setUpClass(cls):
        cls.ci = _normalized((REPO / ".github" / "workflows" / "ci.yml").read_text())
        cls.server_ci = _normalized((REPO / ".github" / "workflows" / "server-ci.yml").read_text())

    @classmethod
    def _repo_shape_python3_lines(cls) -> set[str]:
        """Every python3 command line in ci.yml's Repo shape checks job."""
        raw = (REPO / ".github" / "workflows" / "ci.yml").read_text()
        start = raw.index("name: Repo shape checks")
        end = raw.index("\n  terraform-validate:", start)
        lines = set()
        for line in raw[start:end].splitlines():
            stripped = line.strip()
            if stripped.startswith("run: "):
                stripped = stripped[len("run: ") :]
            if stripped.startswith("python3 "):
                lines.add(stripped)
        return lines

    def test_python3_census_is_two_directional(self):
        """The gate runs exactly the repo-shape job's python3 commands.

        Both directions: a gate command CI doesn't run is a mirror violation;
        a repo-shape step the gate doesn't know is silent local under-coverage
        (a new checker must be added to ALWAYS_ENGINES/SCRIPTS_PROOFS in the
        same PR that adds its CI step — this test is what forces that).
        """
        ci_lines = self._repo_shape_python3_lines()
        gate_lines = {
            cmd
            for _, cmd in (*gate.ALWAYS_ENGINES, *gate.SCRIPTS_PROOFS)
            if cmd.startswith("python3 ")
        }
        self.assertEqual(gate_lines - ci_lines, set(), "gate runs commands CI does not")
        self.assertEqual(ci_lines - gate_lines, set(), "CI runs commands the gate does not")

    def test_uv_proof_mirrors_repo_shape(self):
        uv_cmds = [cmd for _, cmd in gate.SCRIPTS_PROOFS if cmd.startswith("uv ")]
        self.assertEqual(len(uv_cmds), 1)
        self.assertIn(_normalized(uv_cmds[0]), self.ci)

    def test_cicd_config_tests_mirror_ci(self):
        for name, cmd in gate.CICD_CONFIG_TESTS:
            with self.subTest(check=name):
                self.assertIn(_normalized(cmd), self.ci)

    def test_gate_unittest_is_wired_into_ci(self):
        self.assertIn("python3 -m unittest scripts/test_gate.py", self.ci)

    def test_server_ruff_commands_mirror_server_ci(self):
        self.assertIn(_normalized(gate.SERVER_RUFF_CHECK), self.server_ci)
        self.assertIn(_normalized(gate.SERVER_RUFF_FORMAT), self.server_ci)

    def test_server_test_env_mirrors_server_ci(self):
        for key, value in gate.SERVER_TEST_ENV.items():
            with self.subTest(var=key):
                self.assertIn(f"{key}: {value}", self.server_ci)

    def test_mypy_is_same_checker_documented_divergence(self):
        shared_prefix = (
            "uv run --python 3.12 --frozen --extra dev python scripts/check_mypy_baseline.py"
        )
        self.assertTrue(gate.SERVER_MYPY.startswith(shared_prefix))
        self.assertIn(shared_prefix, self.server_ci)
        self.assertIn("--compare-ref origin/main", gate.SERVER_MYPY)

    def test_frontend_commands_mirror_ci(self):
        for cmd in (
            gate.SHARED_TYPECHECK,
            gate.WEB_TYPECHECK,
            gate.MOBILE_TYPECHECK,
        ):
            with self.subTest(cmd=cmd):
                self.assertIn(_normalized(cmd), self.ci)


if __name__ == "__main__":
    unittest.main()
