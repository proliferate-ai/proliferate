from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_anyharness_fences as check_module

DOMAINS_RELATIVE = "anyharness/crates/anyharness-lib/src/domains"


class FenceTestCase(unittest.TestCase):
    """Runs the real engine over a fabricated anyharness-lib domain tree."""

    def scan(
        self,
        files: dict[str, str],
        baseline: set[tuple[str, str]],
    ) -> check_module.ScanResult:
        """`files` keys are paths relative to domains/."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name, content in files.items():
                path = root / DOMAINS_RELATIVE / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            return check_module.collect_violations(root=root, baseline=baseline)

    def for_rule(
        self, result: check_module.ScanResult, rule_id: str
    ) -> list[check_module.Violation]:
        return [v for v in result.violations if v.rule_id == rule_id]


class EdgeBaselineTest(FenceTestCase):
    def test_declared_edge_is_clean(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": "use crate::domains::beta::model::Thing;\n",
                "beta/model.rs": "pub struct Thing;\n",
            },
            baseline={("alpha", "beta")},
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, {("alpha", "beta")})
        self.assertEqual(result.stale_edges, set())

    def test_undeclared_edge_fails(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": "fn go() {\n    use crate::domains::beta::model::Thing;\n}\n",
                "beta/model.rs": "pub struct Thing;\n",
            },
            baseline=set(),
        )
        matches = self.for_rule(result, check_module.EDGE_RULE)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].relative_path, f"{DOMAINS_RELATIVE}/alpha/service.rs")
        self.assertEqual(matches[0].site, "fn go::crate::domains::beta")
        self.assertIn("alpha -> beta", matches[0].detail)

    def test_inline_qualified_path_counts(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": (
                    "pub fn f() -> crate::domains::beta::model::Thing { todo!() }\n"
                ),
                "beta/model.rs": "pub struct Thing;\n",
            },
            baseline=set(),
        )
        self.assertEqual(len(self.for_rule(result, check_module.EDGE_RULE)), 1)

    def test_stale_baseline_edge_is_reported(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": "pub fn f() {}\n",
                "beta/model.rs": "pub struct Thing;\n",
            },
            baseline={("alpha", "beta")},
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.stale_edges, {("alpha", "beta")})

    def test_comment_reference_is_ignored(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": "// use crate::domains::beta::model::Thing;\n",
                "beta/model.rs": "pub struct Thing;\n",
            },
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, set())

    def test_self_reference_is_not_an_edge(self) -> None:
        result = self.scan(
            {"alpha/service.rs": "use crate::domains::alpha::model::Own;\n"},
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, set())

    def test_grouped_import_at_domains_level_is_reported(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": "use crate::domains::{beta, gamma};\n",
                "beta/model.rs": "pub struct Thing;\n",
                "gamma/model.rs": "pub struct Other;\n",
            },
            baseline={("alpha", "beta"), ("alpha", "gamma")},
        )
        matches = self.for_rule(result, check_module.EDGE_RULE)
        self.assertEqual(len(matches), 1)
        self.assertIn("grouped import", matches[0].detail)


class StoreReachTest(FenceTestCase):
    def test_cross_domain_store_import_fails(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": "use crate::domains::beta::store::BetaStore;\n",
                "beta/store.rs": "pub struct BetaStore;\n",
            },
            baseline={("alpha", "beta")},
        )
        matches = self.for_rule(result, check_module.STORE_RULE)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].site, "crate::domains::beta::store::BetaStore")
        self.assertIn("record:", matches[0].format())

    def test_own_store_is_legal(self) -> None:
        result = self.scan(
            {"alpha/service.rs": "use crate::domains::alpha::store::OwnStore;\n"},
            baseline=set(),
        )
        self.assertEqual(self.for_rule(result, check_module.STORE_RULE), [])

    def test_cross_domain_service_is_not_a_store_reach(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": "use crate::domains::beta::service::BetaService;\n",
                "beta/service.rs": "pub struct BetaService;\n",
            },
            baseline={("alpha", "beta")},
        )
        self.assertEqual(self.for_rule(result, check_module.STORE_RULE), [])


class GroupedFormsTest(FenceTestCase):
    def test_crate_level_group_edge_is_seen(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": (
                    "use crate::{\n"
                    "    domains::beta::model::Thing,\n"
                    "    live::sessions::Handle,\n"
                    "};\n"
                ),
                "beta/model.rs": "pub struct Thing;\n",
            },
            baseline=set(),
        )
        self.assertEqual(result.edges_seen, {("alpha", "beta")})
        self.assertEqual(len(self.for_rule(result, check_module.EDGE_RULE)), 1)

    def test_crate_level_group_store_is_seen(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": ("use crate::{domains::beta::store::BetaStore};\n"),
                "beta/store.rs": "pub struct BetaStore;\n",
            },
            baseline={("alpha", "beta")},
        )
        self.assertEqual(len(self.for_rule(result, check_module.STORE_RULE)), 1)

    def test_store_inside_domain_group_is_seen(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": (
                    "use crate::domains::beta::{\n"
                    "    service::BetaService,\n"
                    "    store::BetaStore,\n"
                    "};\n"
                ),
                "beta/store.rs": "pub struct BetaStore;\n",
            },
            baseline={("alpha", "beta")},
        )
        matches = self.for_rule(result, check_module.STORE_RULE)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].site, "crate::domains::beta::{store}")

    def test_domain_group_without_store_is_clean(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": (
                    "use crate::domains::beta::{service::BetaService, model::M};\n"
                ),
                "beta/service.rs": "pub struct BetaService;\n",
            },
            baseline={("alpha", "beta")},
        )
        self.assertEqual(self.for_rule(result, check_module.STORE_RULE), [])


class FingerprintTest(FenceTestCase):
    def test_distinct_store_paths_get_distinct_fingerprints(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": (
                    "use crate::domains::beta::store::completions::State;\n"
                    "use crate::domains::beta::store::BetaStore;\n"
                ),
                "beta/store.rs": "pub struct BetaStore;\n",
            },
            baseline={("alpha", "beta")},
        )
        sites = [v.site for v in self.for_rule(result, check_module.STORE_RULE)]
        self.assertEqual(len(sites), 2)
        self.assertEqual(len(set(sites)), 2)

    def test_identical_repeated_sites_get_occurrence_ordinals(self) -> None:
        result = self.scan(
            {
                "alpha/service.rs": (
                    "use crate::domains::beta::store::BetaStore;\n"
                    "use crate::domains::beta::store::BetaStore;\n"
                ),
                "beta/store.rs": "pub struct BetaStore;\n",
            },
            baseline={("alpha", "beta")},
        )
        sites = sorted(v.site for v in self.for_rule(result, check_module.STORE_RULE))
        self.assertEqual(
            sites,
            [
                "crate::domains::beta::store::BetaStore",
                "crate::domains::beta::store::BetaStore#2",
            ],
        )


class WarnModeTest(unittest.TestCase):
    def test_warn_mode_exits_zero_on_the_real_tree(self) -> None:
        """CI smoke: warn mode never blocks. The enforce-mode exactness pin
        deliberately does NOT run here while the checker ships in warn mode —
        it would make every measured drift fail CI through the unittest step,
        which is exactly what warn mode exists to prevent. Restore a real-tree
        enforce assertion when the --warn flag is dropped from ci.yml."""
        import contextlib
        import io

        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(check_module.main(["--warn"]), 0)


if __name__ == "__main__":
    unittest.main()
