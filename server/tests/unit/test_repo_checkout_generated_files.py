"""Retry after transient materialization failure is generated-file-safe (T1).

Regression: a failed materialization left Proliferate-generated files
(``.proliferate/env/workspace.env`` + ``workspace.manifest.json``) in the shared
checkout. The next attempt's ``git status --porcelain`` guard saw those
untracked files and refused to reset a "dirty" checkout (exit 43). The checkout
script now registers ``.proliferate/`` as locally ignored, so generated files no
longer trip the guard — while genuine user work still does.

The first test asserts the script wires the exclusion before the guard; the
second proves the underlying git mechanism against a real repository.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from proliferate.server.cloud.materialization.materialize.repo_environment import (
    PROLIFERATE_CHECKOUT_IGNORE_ENTRY,
    _build_repo_checkout_script,
)


def test_checkout_script_ignores_generated_files_before_dirty_guard() -> None:
    script = _build_repo_checkout_script(
        git_owner="acme",
        git_repo_name="widgets",
        repo_path="/home/user/workspace/repos/acme/widgets",
        requested_branch="main",
    )
    # The generated dir is registered in the repo's local exclude file...
    assert ".git/info/exclude" in script
    assert PROLIFERATE_CHECKOUT_IGNORE_ENTRY in script
    # ...before the dirty-check guard, so ignored files are omitted from it.
    exclude_pos = script.index(PROLIFERATE_CHECKOUT_IGNORE_ENTRY)
    guard_pos = script.index("status --porcelain")
    assert exclude_pos < guard_pos
    # The safety guard itself is preserved.
    assert "Refusing to reset dirty cloud repo checkout" in script


@pytest.mark.skipif(shutil.which("git") is None, reason="git not available")
def test_generated_files_do_not_count_as_dirty_but_user_work_does(tmp_path: Path) -> None:
    def git(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", "-C", str(tmp_path), *args],
            check=True,
            capture_output=True,
            text=True,
        )

    def porcelain() -> str:
        return git("status", "--porcelain").stdout

    git("init", "-q")
    git("config", "user.email", "test@example.com")
    git("config", "user.name", "Test")
    (tmp_path / "README.md").write_text("hi\n")
    git("add", "README.md")
    git("commit", "-qm", "init")

    # Register .proliferate/ exactly as the checkout script does.
    exclude_file = tmp_path / ".git" / "info" / "exclude"
    exclude_file.parent.mkdir(parents=True, exist_ok=True)
    with exclude_file.open("a") as handle:
        handle.write(f"{PROLIFERATE_CHECKOUT_IGNORE_ENTRY}\n")

    # Proliferate-generated files under .proliferate/ (env + manifest).
    generated = tmp_path / ".proliferate" / "env"
    generated.mkdir(parents=True)
    (generated / "workspace.env").write_text("SECRET=1\n")
    (generated / "workspace.manifest.json").write_text("{}\n")

    # Generated files must NOT make the checkout look dirty.
    assert porcelain() == ""

    # Genuine user work still trips the dirty guard.
    (tmp_path / "user_change.txt").write_text("edited\n")
    assert "user_change.txt" in porcelain()
