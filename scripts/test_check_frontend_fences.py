from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_frontend_fences as check_module

SRC_RELATIVE = "apps/packages/product-client/src"


class FenceTestCase(unittest.TestCase):
    """Runs the real engine over a fabricated product-client tree."""

    def scan(
        self,
        files: dict[str, str],
        baseline: set[tuple[str, str]],
    ) -> check_module.ScanResult:
        """`files` keys are paths relative to product-client/src."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name, content in files.items():
                path = root / SRC_RELATIVE / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            return check_module.collect_violations(root=root, baseline=baseline)


class EdgeBaselineTest(FenceTestCase):
    def test_declared_alias_edge_is_clean(self) -> None:
        result = self.scan(
            {
                "hooks/use-thing.ts": 'import { y } from "#product/stores/thing";\n',
                "stores/thing.ts": "export const y = 1;\n",
            },
            baseline={("hooks", "stores")},
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, {("hooks", "stores")})
        self.assertEqual(result.stale_edges, set())

    def test_undeclared_alias_edge_fails(self) -> None:
        result = self.scan(
            {
                "hooks/use-thing.ts": 'import { y } from "#product/stores/thing";\n',
                "stores/thing.ts": "export const y = 1;\n",
            },
            baseline=set(),
        )
        self.assertEqual(len(result.violations), 1)
        self.assertEqual(
            result.violations[0].relative_path, f"{SRC_RELATIVE}/hooks/use-thing.ts"
        )
        self.assertIn("hooks -> stores", result.violations[0].detail)
        self.assertIn("record:", result.violations[0].format())

    def test_relative_edge_counts(self) -> None:
        result = self.scan(
            {
                "hooks/nested/use-thing.ts": 'import { y } from "../../stores/thing";\n',
                "stores/thing.ts": "export const y = 1;\n",
            },
            baseline=set(),
        )
        self.assertEqual(result.edges_seen, {("hooks", "stores")})
        self.assertEqual(len(result.violations), 1)

    def test_reexport_counts_as_an_edge(self) -> None:
        result = self.scan(
            {
                "lib/barrel.ts": 'export { y } from "../stores/thing";\n',
                "stores/thing.ts": "export const y = 1;\n",
            },
            baseline=set(),
        )
        self.assertEqual(result.edges_seen, {("lib", "stores")})

    def test_within_directory_import_is_not_an_edge(self) -> None:
        result = self.scan(
            {
                "hooks/use-a.ts": 'import { b } from "./use-b";\n',
                "hooks/use-b.ts": "export const b = 1;\n",
            },
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, set())

    def test_stale_baseline_edge_is_reported(self) -> None:
        result = self.scan(
            {
                "hooks/use-a.ts": "export const a = 1;\n",
                "stores/thing.ts": "export const y = 1;\n",
            },
            baseline={("hooks", "stores")},
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.stale_edges, {("hooks", "stores")})

    def test_package_external_import_is_ignored(self) -> None:
        result = self.scan(
            {
                "hooks/use-a.ts": (
                    'import * as React from "react";\n'
                    'import { z } from "../../other-package/src/z";\n'
                ),
                "stores/thing.ts": "export const y = 1;\n",
            },
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, set())


class BaselineRealityTest(unittest.TestCase):
    def test_shipped_baseline_matches_reality_exactly(self) -> None:
        result = check_module.collect_violations()
        self.assertEqual([v.format() for v in result.violations], [])
        self.assertEqual(result.stale_edges, set())


if __name__ == "__main__":
    unittest.main()
