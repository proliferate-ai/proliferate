from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_frontend_old_paths

PRODUCT_CLIENT = "apps/packages/product-client/src"
EVIDENCE_MODULE = f"{PRODUCT_CLIENT}/lib/domain/settings/agent-auth-evidence.ts"
STATUS_BADGE = (
    f"{PRODUCT_CLIENT}/components/settings/panes/agents/harness/HarnessAuthStatusBadge.tsx"
)
ROTATION_MODULE = f"{PRODUCT_CLIENT}/lib/domain/settings/agent-auth-rotation.ts"
FEATURE_FLAGS = f"{PRODUCT_CLIENT}/config/feature-flags.ts"
TIMED_ONBOARDING_STEP = (
    f"{PRODUCT_CLIENT}/hooks/agents/lifecycle/use-auth-setup-onboarding-step.ts"
)


def _write(root: Path, relative: str, body: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)


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
            _write(root, EVIDENCE_MODULE, "export function isEvidenceGreen() {}\n")

            self.assertEqual(
                check_frontend_old_paths.existing_blocked_paths(root),
                [EVIDENCE_MODULE],
            )

    def test_rejects_the_resurrected_status_badge_and_its_ladder(self) -> None:
        # The file that actually held deriveAuthStatus/deriveProvidersStatus and
        # the readiness + cliAuthState fallback ladder this slice exists to kill.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _write(root, STATUS_BADGE, "export function deriveAuthStatus() {}\n")

            self.assertEqual(
                check_frontend_old_paths.existing_blocked_paths(root),
                [STATUS_BADGE],
            )

    def test_rejects_every_other_path_the_deletion_closed(self) -> None:
        # A rotation projection, a flag module that can switch the derivation back
        # on, and the grace-window timer are the same second source by other
        # routes — each must fail on its own.
        for blocked in (ROTATION_MODULE, FEATURE_FLAGS, TIMED_ONBOARDING_STEP):
            with (
                self.subTest(blocked=blocked),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                _write(root, blocked, "export const resurrected = true;\n")

                self.assertEqual(
                    check_frontend_old_paths.existing_blocked_paths(root),
                    [blocked],
                )

    def test_reports_every_resurrected_path_not_just_the_first(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _write(root, EVIDENCE_MODULE, "export const back = true;\n")
            _write(root, STATUS_BADGE, "export const back = true;\n")

            self.assertEqual(
                sorted(check_frontend_old_paths.existing_blocked_paths(root)),
                sorted([EVIDENCE_MODULE, STATUS_BADGE]),
            )

    def test_every_blocked_path_lives_under_the_product_client(self) -> None:
        # A typo'd path silently blocks nothing, which is how this rule shipped
        # fencing one of the five files it claims to hold deleted.
        for blocked in check_frontend_old_paths.BLOCKED_PATHS:
            with self.subTest(blocked=blocked):
                self.assertTrue(blocked.startswith(f"{PRODUCT_CLIENT}/"))

    def test_blocks_the_whole_slice_3_deletion_set(self) -> None:
        self.assertEqual(
            sorted(check_frontend_old_paths.BLOCKED_PATHS),
            sorted(
                [
                    EVIDENCE_MODULE,
                    STATUS_BADGE,
                    ROTATION_MODULE,
                    FEATURE_FLAGS,
                    TIMED_ONBOARDING_STEP,
                ]
            ),
        )

    def test_repo_is_clean(self) -> None:
        # The deletions this rule guards have landed: the checker must pass
        # against the real tree, not only against fixtures.
        self.assertEqual(check_frontend_old_paths.existing_blocked_paths(), [])
