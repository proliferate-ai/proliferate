from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_server_old_paths


class ServerOldPathsTest(unittest.TestCase):
    def test_passes_without_blocked_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(
                check_server_old_paths.existing_blocked_paths(Path(directory)),
                [],
            )

    def test_rejects_resurrected_logging_compatibility_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            blocked_path = root / "server/proliferate/utils/logging.py"
            blocked_path.parent.mkdir(parents=True)
            blocked_path.write_text("from proliferate.middleware.logging import *\n")

            self.assertEqual(
                check_server_old_paths.existing_blocked_paths(root),
                ["server/proliferate/utils/logging.py"],
            )
