"""Runtime bundle discovery: local binary path resolution for cloud provisioning.

Sandboxes always boot template-baked binaries now -- the staging functions
that once uploaded ``anyharness``/``proliferate-worker``/``proliferate-supervisor``
into a sandbox at connect time (``stage_runtime_bundle`` and friends) and their
preinstalled-binary hash-check counterparts had zero production callers and
were deleted (S5-B, 2026-07-26). Only the local-path resolvers survive, still
used by the e2e test harness (``tests/e2e/cloud/helpers/config.py``) to locate
the binaries it bakes into its own test template.
"""

from __future__ import annotations

import sys
from pathlib import Path

from proliferate.config import settings


def _resolve_local_component_binary_path(
    *,
    binary_name: str,
    source_binary_path: str,
    source_env_name: str,
) -> Path:
    candidates: list[Path] = []
    if source_binary_path:
        candidates.append(Path(source_binary_path).expanduser())
    repo_root = Path(__file__).resolve().parents[5]
    candidates.extend(
        [
            repo_root / "target" / "x86_64-unknown-linux-musl" / "release" / binary_name,
            repo_root / "target" / "x86_64-unknown-linux-gnu" / "release" / binary_name,
        ]
    )
    if sys.platform.startswith("linux"):
        candidates.append(repo_root / "target" / "release" / binary_name)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError(
        f"{binary_name} Linux binary was not found for cloud provisioning. "
        f"Build target/x86_64-unknown-linux-musl/release/{binary_name} "
        f"(or target/x86_64-unknown-linux-gnu/release/{binary_name}) or set "
        f"{source_env_name}."
    )


def resolve_local_runtime_binary_path() -> Path:
    return _resolve_local_component_binary_path(
        binary_name="anyharness",
        source_binary_path=settings.cloud_runtime_source_binary_path,
        source_env_name="CLOUD_RUNTIME_SOURCE_BINARY_PATH",
    )


def resolve_local_worker_binary_path() -> Path:
    return _resolve_local_component_binary_path(
        binary_name="proliferate-worker",
        source_binary_path=settings.cloud_worker_source_binary_path,
        source_env_name="CLOUD_WORKER_SOURCE_BINARY_PATH",
    )


def resolve_local_supervisor_binary_path() -> Path:
    return _resolve_local_component_binary_path(
        binary_name="proliferate-supervisor",
        source_binary_path=settings.cloud_supervisor_source_binary_path,
        source_env_name="CLOUD_SUPERVISOR_SOURCE_BINARY_PATH",
    )
