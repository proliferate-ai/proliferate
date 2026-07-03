"""Spawn and drive a real *local* macOS AnyHarness runtime for the move E2E.

The workspace-move round-trip test acts as the Desktop executor: it owns the
local side of a move and reaches the cloud side only through the server API.
That local side is a genuine ``anyharness serve`` process on this machine,
built from the worktree so it carries this branch's ``installMode`` /
re-adopt engine semantics.

Runtime spawning is ported from the black-box vitest driver
(``anyharness/tests/src/scenarios/workspaces/mobility-roundtrip.test.ts``):
build the binary once, ``install-agents --agent claude`` into a throwaway
``--runtime-home``, then ``serve --require-bearer-auth`` with an explicit
``ANYHARNESS_WORKTREES_ROOT`` (which otherwise defaults to a *sibling* of the
runtime home that this test would not own and clean up). Agent + node bytes are
seeded from the machine's warm caches
(``~/.proliferate-local/anyharness/agents`` and ``~/.proliferate/anyharness/node``)
first so ``install-agents`` reconciles offline; native Claude auth comes from
this machine's ``~/.claude`` exactly as the black-box suite relies on.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

import httpx

from tests.e2e.cloud.helpers.shared import REPO_ROOT, CloudE2ETestError

_LOCAL_ANYHARNESS_BINARY: Path | None = None

_AGENT_CACHE = Path.home() / ".proliferate-local" / "anyharness" / "agents"
_NODE_CACHE = Path.home() / ".proliferate" / "anyharness" / "node"
_CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"
# The machine's already-built + already-authed Claude agent launcher. Pointing
# the runtime at it (the black-box "override" agent source) is the reliable way
# to run Claude locally -- see _claude_override_agent_env.
_CLAUDE_CACHE_LAUNCHER = _AGENT_CACHE / "claude" / "agent_process" / "claude-launcher"

_BUILD_TIMEOUT_SECONDS = 1800
_INSTALL_AGENTS_TIMEOUT_SECONDS = 900
_HEALTH_ATTEMPTS = 90
_HEALTH_INTERVAL_SECONDS = 1.0


def ensure_local_anyharness_binary() -> Path:
    """Build ``anyharness`` (debug) from the worktree once; return its path.

    Honors ``CARGO_TARGET_DIR`` (set it to the main checkout's ``target`` to
    reuse its compile cache); otherwise builds into the worktree's own
    ``target``. Either way the *sources* are this worktree's, so the binary
    has the engine changes under test.
    """
    global _LOCAL_ANYHARNESS_BINARY
    if _LOCAL_ANYHARNESS_BINARY is not None:
        return _LOCAL_ANYHARNESS_BINARY

    target_dir = os.environ.get("CARGO_TARGET_DIR", "").strip() or str(REPO_ROOT / "target")
    env = {**os.environ, "CARGO_TARGET_DIR": target_dir}
    try:
        subprocess.run(
            ["cargo", "build", "-p", "anyharness"],
            cwd=str(REPO_ROOT),
            check=True,
            env=env,
            timeout=_BUILD_TIMEOUT_SECONDS,
        )
    except subprocess.CalledProcessError as exc:
        raise CloudE2ETestError(
            f"Failed to build the local anyharness binary (exit {exc.returncode})."
        ) from exc

    binary = Path(target_dir) / "debug" / "anyharness"
    if not binary.is_file():
        raise CloudE2ETestError(f"Built anyharness binary is missing at {binary}.")
    _LOCAL_ANYHARNESS_BINARY = binary
    return binary


@dataclass
class LocalRuntime:
    """A running local ``anyharness serve`` process and its access details."""

    base_url: str
    access_token: str
    runtime_home: Path
    worktrees_root: Path
    process: subprocess.Popen[bytes]
    stderr_path: Path
    markers: list[str] = field(default_factory=list)

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                with _suppress():
                    self.process.wait(timeout=15)
        for path in (self.runtime_home, self.worktrees_root):
            shutil.rmtree(path, ignore_errors=True)


class _suppress:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *_exc: object) -> bool:
        return True


def _seed_runtime_home(binary: Path, runtime_home: Path) -> None:
    """Warm the runtime home from local caches, then reconcile launchers.

    Copying the cached ``claude`` agent + node bundle lets ``install-agents``
    run offline; the ``install-agents`` pass still runs so the launcher scripts
    are regenerated to point at *this* runtime home's node.
    """
    claude_src = _AGENT_CACHE / "claude"
    if claude_src.is_dir():
        dest = runtime_home / "agents" / "claude"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(claude_src, dest, dirs_exist_ok=True)
    if _NODE_CACHE.is_dir():
        shutil.copytree(_NODE_CACHE, runtime_home / "node", dirs_exist_ok=True)

    try:
        subprocess.run(
            [
                str(binary),
                "install-agents",
                "--runtime-home",
                str(runtime_home),
                "--agent",
                "claude",
            ],
            cwd=str(REPO_ROOT),
            check=True,
            env=dict(os.environ),
            timeout=_INSTALL_AGENTS_TIMEOUT_SECONDS,
        )
    except subprocess.CalledProcessError as exc:
        raise CloudE2ETestError(
            f"install-agents failed for the local runtime (exit {exc.returncode})."
        ) from exc


def _claude_override_agent_env() -> dict[str, str] | None:
    """Reliable local Claude via the black-box "override" agent source.

    Pointing ``ANYHARNESS_CLAUDE_AGENT_PROGRAM`` at the machine's already-built,
    already-authed Claude launcher (``claude-launcher`` puts the native ``claude``
    sidecar on PATH and disables the auto-updater) lets the runtime skip the
    managed npm-from-git reinstall entirely. That per-spawn reinstall is the
    source of the intermittent ``AnyHarness sidecar is not available for target
    ...`` and ``install-agents`` exit-1 flakes: it refetches the ACP package + its
    platform sidecar over the network every spawn. With no agent seeded into the
    runtime home, the startup installed-only reconcile has nothing to reinstall,
    and the session spawn resolves this override (anyharness
    ``domains/agents/readiness/overrides.rs``). Returns ``None`` when the launcher
    cache is absent, so the managed seed path stays as a fallback.
    """
    if not _CLAUDE_CACHE_LAUNCHER.is_file():
        return None
    return {
        "ANYHARNESS_CLAUDE_AGENT_PROGRAM": str(_CLAUDE_CACHE_LAUNCHER),
        "ANYHARNESS_CLAUDE_AGENT_ARGS_JSON": "[]",
        "ANYHARNESS_CLAUDE_AGENT_CWD": str(_CLAUDE_CACHE_LAUNCHER.parent),
    }


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


_SPAWN_ATTEMPTS = 3


def spawn_local_runtime(label: str, *, scratch_root: Path) -> LocalRuntime:
    """Build (once), seed, and start a bearer-authed local runtime; wait health.

    Retries a few times because the serve-time agent reconcile reinstalls the
    Claude ACP package from git and its platform sidecar is intermittently
    unavailable (``AnyHarness sidecar is not available for target ...`` -> the
    process exits during startup). Each attempt gets a fresh runtime home + port,
    so a retry is clean; a genuinely-broken toolchain still surfaces after the
    last attempt.
    """
    binary = ensure_local_anyharness_binary()
    last_error: Exception | None = None
    for attempt in range(_SPAWN_ATTEMPTS):
        try:
            return _spawn_local_runtime_once(binary, label, scratch_root=scratch_root)
        except CloudE2ETestError as exc:
            last_error = exc
            if attempt + 1 >= _SPAWN_ATTEMPTS:
                break
    assert last_error is not None
    raise last_error


def _spawn_local_runtime_once(
    binary: Path, label: str, *, scratch_root: Path
) -> LocalRuntime:
    runtime_home = Path(
        _mkdir(scratch_root / f"rt-{label}-{uuid4().hex[:8]}")
    )
    worktrees_root = Path(
        _mkdir(scratch_root / f"wt-{label}-{uuid4().hex[:8]}")
    )
    override_env = _claude_override_agent_env()
    if override_env is None:
        # No prebuilt launcher cache -> fall back to seeding + managed install.
        _seed_runtime_home(binary, runtime_home)

    access_token = uuid4().hex
    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    stderr_path = scratch_root / f"rt-{label}-stderr.log"

    stderr_file = stderr_path.open("wb")
    process = subprocess.Popen(
        [
            str(binary),
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--runtime-home",
            str(runtime_home),
            "--require-bearer-auth",
        ],
        cwd=str(REPO_ROOT),
        env={
            **os.environ,
            "ANYHARNESS_BEARER_TOKEN": access_token,
            "ANYHARNESS_WORKTREES_ROOT": str(worktrees_root),
            **(override_env or {}),
        },
        stdout=subprocess.DEVNULL,
        stderr=stderr_file,
    )

    runtime = LocalRuntime(
        base_url=base_url,
        access_token=access_token,
        runtime_home=runtime_home,
        worktrees_root=worktrees_root,
        process=process,
        stderr_path=stderr_path,
        markers=[runtime_home.name, worktrees_root.name],
    )
    try:
        _wait_for_health(runtime)
    except Exception:
        runtime.close()
        raise
    finally:
        stderr_file.close()
    return runtime


def _wait_for_health(runtime: LocalRuntime) -> None:
    for _attempt in range(_HEALTH_ATTEMPTS):
        if runtime.process.poll() is not None:
            raise CloudE2ETestError(
                "Local anyharness exited during startup: "
                + _tail(runtime.stderr_path)
            )
        try:
            response = httpx.get(
                f"{runtime.base_url}/health",
                headers={"Authorization": f"Bearer {runtime.access_token}"},
                timeout=5.0,
            )
            if response.status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(_HEALTH_INTERVAL_SECONDS)
    raise CloudE2ETestError(
        "Timed out waiting for local anyharness health: " + _tail(runtime.stderr_path)
    )


def _tail(path: Path, *, limit: int = 4000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[-limit:]
    except OSError:
        return "<no stderr captured>"


# --- git fixture helpers -----------------------------------------------------


def _git(cwd: Path, args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _authed_remote_url(owner: str, repo: str, token: str) -> str:
    return f"https://x-access-token:{token}@github.com/{owner}/{repo}.git"


def clone_repo_on_new_branch(
    *,
    owner: str,
    repo: str,
    base_branch: str,
    branch: str,
    token: str,
    dest: Path,
) -> str:
    """Shallow-clone ``base_branch`` into ``dest``, cut ``branch`` at its HEAD,
    push ``branch`` to origin, and return the base commit sha.

    Shallow keeps even a large default repo cheap; the pushed branch pins the
    exact sha the move materializes on the cloud side.
    """
    remote = _authed_remote_url(owner, repo, token)
    dest.parent.mkdir(parents=True, exist_ok=True)
    _git(
        dest.parent,
        ["clone", "--depth", "1", "--single-branch", "--branch", base_branch, remote, str(dest)],
    )
    _git(dest, ["config", "user.email", "workspace-move-e2e@proliferate.test"])
    _git(dest, ["config", "user.name", "Workspace Move E2E"])
    _git(dest, ["checkout", "-B", branch])
    _git(dest, ["push", "origin", branch])
    return _git(dest, ["rev-parse", "HEAD"])


def delete_remote_branch(*, owner: str, repo: str, branch: str, token: str, cwd: Path) -> None:
    remote = _authed_remote_url(owner, repo, token)
    with _suppress():
        subprocess.run(
            ["git", "push", remote, "--delete", branch],
            cwd=str(cwd),
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )


def cleanup_claude_project_slugs(markers: list[str]) -> None:
    """Remove ``~/.claude/projects`` slug dirs created by this run.

    Claude Code slugs a workspace's absolute path into its project dir name, so
    any dir whose name embeds one of this run's temp-path markers belongs to us
    (mirrors the black-box driver's ``cleanupClaudeProjectSlugs``).
    """
    if not markers or not _CLAUDE_PROJECTS_DIR.is_dir():
        return
    for entry in _CLAUDE_PROJECTS_DIR.iterdir():
        if entry.is_dir() and any(marker in entry.name for marker in markers):
            shutil.rmtree(entry, ignore_errors=True)


def _mkdir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path
