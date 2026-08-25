from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_manifests as check_module

SERVER_RELATIVE = "server/proliferate/server"
PACKAGE_RELATIVE = "server/proliferate"

VALID_MANIFEST = '''
name = "alpha"
spec = "specs/alpha.md"
owns = "The alpha system."
public_surface = ["proliferate.server.alpha.service"]
allowed_importers = [{importers}]
'''


class ManifestTestCase(unittest.TestCase):
    """Runs the real engine over a fabricated server tree."""

    def scan(self, files: dict[str, str]) -> list[check_module.Violation]:
        """`files` keys are repo-relative paths."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            return check_module.collect_violations(root=root)

    def sites(
        self, violations: list[check_module.Violation], rule_id: str
    ) -> set[str]:
        return {v.site for v in violations if v.rule_id == rule_id}


class SchemaTest(ManifestTestCase):
    def test_valid_manifest_with_exact_importers_is_clean(self) -> None:
        violations = self.scan(
            {
                "specs/alpha.md": "# Alpha\n",
                f"{SERVER_RELATIVE}/alpha/MANIFEST.toml": VALID_MANIFEST.format(
                    importers='"beta"'
                ),
                f"{SERVER_RELATIVE}/alpha/service.py": "x = 1\n",
                f"{SERVER_RELATIVE}/beta/MANIFEST.toml": (
                    'name = "beta"\nspec = "specs/alpha.md"\nowns = "Beta."\n'
                    "public_surface = []\nallowed_importers = []\n"
                ),
                f"{SERVER_RELATIVE}/beta/service.py": (
                    "from proliferate.server.alpha.service import x\n"
                ),
            }
        )
        self.assertEqual([v.format() for v in violations], [])

    def test_missing_manifest_fails(self) -> None:
        violations = self.scan(
            {
                f"{SERVER_RELATIVE}/alpha/service.py": "x = 1\n",
            }
        )
        self.assertEqual(
            self.sites(violations, check_module.SCHEMA_RULE), {"missing-manifest"}
        )

    def test_missing_field_and_dead_spec_fail(self) -> None:
        violations = self.scan(
            {
                f"{SERVER_RELATIVE}/alpha/MANIFEST.toml": (
                    'name = "alpha"\nspec = "specs/gone.md"\nowns = "A."\n'
                    "public_surface = []\nallowed_importers = []\n"
                ),
                f"{SERVER_RELATIVE}/beta/MANIFEST.toml": (
                    'name = "beta"\nowns = "B."\npublic_surface = []\n'
                    "allowed_importers = []\n"
                ),
            }
        )
        self.assertEqual(
            self.sites(violations, check_module.SCHEMA_RULE),
            {"spec::missing", "field::spec"},
        )

    def test_malformed_toml_fails(self) -> None:
        violations = self.scan(
            {f"{SERVER_RELATIVE}/alpha/MANIFEST.toml": 'name = "alpha\n'}
        )
        self.assertEqual(
            self.sites(violations, check_module.SCHEMA_RULE), {"malformed-toml"}
        )

    def test_cloud_megadomain_is_skipped_but_live_subsystem_is_required(self) -> None:
        violations = self.scan(
            {
                f"{SERVER_RELATIVE}/cloud/api.py": "x = 1\n",
                f"{SERVER_RELATIVE}/cloud/agent_gateway/service.py": "y = 1\n",
            }
        )
        sites = self.sites(violations, check_module.SCHEMA_RULE)
        self.assertEqual(sites, {"missing-manifest"})
        paths = {v.relative_path for v in violations}
        self.assertEqual(paths, {f"{SERVER_RELATIVE}/cloud/agent_gateway"})


class ImporterTruthTest(ManifestTestCase):
    def test_undeclared_importer_fails(self) -> None:
        violations = self.scan(
            {
                "specs/alpha.md": "# Alpha\n",
                f"{SERVER_RELATIVE}/alpha/MANIFEST.toml": VALID_MANIFEST.format(
                    importers=""
                ),
                f"{PACKAGE_RELATIVE}/background/tasks.py": (
                    "import proliferate.server.alpha.service\n"
                ),
            }
        )
        self.assertEqual(
            self.sites(violations, check_module.IMPORTERS_RULE),
            {"allowed_importers::missing::background"},
        )

    def test_stale_declared_importer_fails(self) -> None:
        violations = self.scan(
            {
                "specs/alpha.md": "# Alpha\n",
                f"{SERVER_RELATIVE}/alpha/MANIFEST.toml": VALID_MANIFEST.format(
                    importers='"background"'
                ),
            }
        )
        self.assertEqual(
            self.sites(violations, check_module.IMPORTERS_RULE),
            {"allowed_importers::stale::background"},
        )

    def test_self_import_is_not_an_importer(self) -> None:
        violations = self.scan(
            {
                "specs/alpha.md": "# Alpha\n",
                f"{SERVER_RELATIVE}/alpha/MANIFEST.toml": VALID_MANIFEST.format(
                    importers=""
                ),
                f"{SERVER_RELATIVE}/alpha/api.py": (
                    "from proliferate.server.alpha.service import x\n"
                ),
            }
        )
        self.assertEqual(self.sites(violations, check_module.IMPORTERS_RULE), set())

    def test_module_name_prefix_does_not_false_match(self) -> None:
        violations = self.scan(
            {
                "specs/alpha.md": "# Alpha\n",
                f"{SERVER_RELATIVE}/alpha/MANIFEST.toml": VALID_MANIFEST.format(
                    importers=""
                ),
                f"{PACKAGE_RELATIVE}/background/tasks.py": (
                    "import proliferate.server.alphabet.service\n"
                ),
            }
        )
        self.assertEqual(self.sites(violations, check_module.IMPORTERS_RULE), set())


class RealTreeTest(unittest.TestCase):
    def test_shipped_manifests_are_reality_exact(self) -> None:
        violations = check_module.collect_violations()
        self.assertEqual([v.format() for v in violations], [])


if __name__ == "__main__":
    unittest.main()
