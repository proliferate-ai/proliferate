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
        gate_baseline: set[str] | None = None,
    ) -> check_module.ScanResult:
        """`files` keys are paths relative to product-client/src."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name, content in files.items():
                path = root / SRC_RELATIVE / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            return check_module.collect_violations(
                root=root,
                baseline=baseline,
                gate_baseline=gate_baseline if gate_baseline is not None else set(),
            )


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

    def test_build_output_directory_is_not_a_top(self) -> None:
        """src/generated/ exists only on a built checkout; it must never
        become a fence target, or the graph would differ between a developer
        machine and CI."""
        result = self.scan(
            {
                "lib/domain/agents/registry.ts": (
                    'import registry from "../../../generated/agent-registry.json?raw";\n'
                ),
                "generated/agent-registry.json": "{}\n",
            },
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.edges_seen, set())


class SelfPackageExportTest(FenceTestCase):
    def test_host_export_subpath_counts_as_an_edge(self) -> None:
        result = self.scan(
            {
                "stores/updater.ts": (
                    'import { bridge } from "@proliferate/product-client/host/desktop-updater-bridge";\n'
                ),
                "host/desktop-updater-bridge.ts": "export const bridge = 1;\n",
            },
            baseline=set(),
        )
        self.assertEqual(result.edges_seen, {("stores", "host")})
        self.assertEqual(len(result.violations), 1)

    def test_infra_export_resolves_to_lib(self) -> None:
        result = self.scan(
            {
                "hooks/use-measure.ts": (
                    'import { port } from "@proliferate/product-client/infra/measurement";\n'
                ),
                "lib/infra.ts": "export const port = 1;\n",
            },
            baseline={("hooks", "lib")},
        )
        self.assertEqual(result.edges_seen, {("hooks", "lib")})
        self.assertEqual(result.violations, [])

    def test_internal_subpath_still_resolves(self) -> None:
        result = self.scan(
            {
                "hooks/use-thing.ts": (
                    'import { y } from "@proliferate/product-client/internal/stores/thing";\n'
                ),
                "stores/thing.ts": "export const y = 1;\n",
            },
            baseline={("hooks", "stores")},
        )
        self.assertEqual(result.edges_seen, {("hooks", "stores")})
        self.assertEqual(result.violations, [])


class CloudGateBaselineTest(FenceTestCase):
    def test_undeclared_gate_consumer_fails(self) -> None:
        result = self.scan(
            {
                "hooks/use-thing.ts": (
                    "export function useThing(cloudActive: boolean) {\n"
                    "  return cloudActive;\n"
                    "}\n"
                ),
            },
            baseline=set(),
        )
        gate = [v for v in result.violations if v.rule_id == check_module.GATE_RULE]
        self.assertEqual(len(gate), 1)
        self.assertEqual(
            gate[0].relative_path, f"{SRC_RELATIVE}/hooks/use-thing.ts"
        )
        self.assertIn("undeclared cloud-gate consumer", gate[0].detail)
        self.assertIn("record:", gate[0].format())

    def test_declared_gate_consumer_is_clean(self) -> None:
        result = self.scan(
            {
                "hooks/use-thing.ts": "export const x = cloudComputeEnabled;\n",
            },
            baseline=set(),
            gate_baseline={"hooks/use-thing.ts"},
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.gate_consumers_seen, {"hooks/use-thing.ts"})
        self.assertEqual(result.stale_gate_consumers, set())

    def test_comment_and_string_mentions_do_not_count(self) -> None:
        result = self.scan(
            {
                "hooks/use-thing.ts": (
                    "// the old cloudActive coupling was removed here\n"
                    "/* cloudComputeEnabled folds in the kill switch */\n"
                    'const key = "cloudActive";\n'
                    "export const x = key;\n"
                ),
            },
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.gate_consumers_seen, set())

    def test_test_files_are_exempt(self) -> None:
        result = self.scan(
            {
                "hooks/use-thing.test.ts": "export const x = cloudActive;\n",
                "hooks/__tests__/fixture.ts": "export const y = cloudActive;\n",
            },
            baseline=set(),
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.gate_consumers_seen, set())

    def test_stale_gate_row_is_reported(self) -> None:
        result = self.scan(
            {
                "hooks/use-thing.ts": "export const x = 1;\n",
            },
            baseline=set(),
            gate_baseline={"hooks/use-thing.ts"},
        )
        self.assertEqual(result.violations, [])
        self.assertEqual(result.stale_gate_consumers, {"hooks/use-thing.ts"})

    def test_one_violation_per_undeclared_file(self) -> None:
        result = self.scan(
            {
                "hooks/use-thing.ts": (
                    "export const a = cloudActive;\n"
                    "export const b = cloudComputeEnabled;\n"
                ),
            },
            baseline=set(),
        )
        gate = [v for v in result.violations if v.rule_id == check_module.GATE_RULE]
        self.assertEqual(len(gate), 1)


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
