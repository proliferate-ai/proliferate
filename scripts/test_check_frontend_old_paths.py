from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_frontend_old_paths

EVIDENCE_MODULE = (
    "apps/packages/product-client/src/lib/domain/settings/agent-auth-evidence.ts"
)


class FrontendOldPathsTest(unittest.TestCase):
    def test_passes_without_blocked_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(
                check_frontend_old_paths.existing_blocked_paths(Path(directory)),
                [],
            )

    def test_ignores_empty_deleted_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / EVIDENCE_MODULE).mkdir(parents=True)

            self.assertEqual(check_frontend_old_paths.existing_blocked_paths(root), [])

    def test_rejects_resurrected_evidence_derivation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            blocked_path = root / EVIDENCE_MODULE
            blocked_path.parent.mkdir(parents=True)
            blocked_path.write_text("export function isEvidenceGreen() {}\n")

            self.assertEqual(
                check_frontend_old_paths.existing_blocked_paths(root),
                [EVIDENCE_MODULE],
            )

    def test_repo_is_clean(self) -> None:
        # The deletion this rule guards has landed: the checker must pass against
        # the real tree, not only against fixtures.
        self.assertEqual(check_frontend_old_paths.existing_blocked_paths(), [])
