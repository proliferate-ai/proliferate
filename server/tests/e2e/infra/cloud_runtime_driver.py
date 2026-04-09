"""Provision and destroy AnyHarness runtimes through the cloud control plane."""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from contextlib import suppress
from typing import Any

from tests.e2e.infra.cloud_workspace_harness import (
    CloudProviderKind,
    CloudWorkspaceHarness,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_runtime = subparsers.add_parser("create-runtime")
    create_runtime.add_argument("--provider", required=True, choices=("e2b", "daytona"))

    destroy_runtime = subparsers.add_parser("destroy-runtime")
    destroy_runtime.add_argument("--provider", required=True, choices=("e2b", "daytona"))
    destroy_runtime.add_argument("--cloud-workspace-id", required=True)

    return parser.parse_args()


async def _prepare_bridge_workspace(
    harness: CloudWorkspaceHarness,
    *,
    connection: dict[str, Any],
    runtime_workspace: dict[str, Any],
) -> tuple[str, str]:
    source_path = str(runtime_workspace["path"])
    source_workspace_id = str(runtime_workspace["id"])
    if not source_path.startswith("/root/"):
        return source_path, source_workspace_id

    bridge_path = f"/tmp/anyharness-cloud-source-{uuid.uuid4().hex[:8]}"
    copy_result = await harness.run_runtime_command(
        connection,
        workspace_id=source_workspace_id,
        command=[
            "python3",
            "-c",
            (
                "import pathlib, shutil, sys; "
                "src = pathlib.Path(sys.argv[1]); "
                "dst = pathlib.Path(sys.argv[2]); "
                "dst.parent.mkdir(parents=True, exist_ok=True); "
                "shutil.copytree(src, dst, symlinks=True)"
            ),
            source_path,
            bridge_path,
        ],
    )
    if copy_result.get("exitCode") != 0:
        raise RuntimeError(
            copy_result.get("stderr")
            or copy_result.get("stdout")
            or f"Failed to stage bridge workspace at {bridge_path}"
        )

    bridge_workspace = await harness.create_runtime_workspace(connection, path=bridge_path)
    return str(bridge_workspace["path"]), str(bridge_workspace["id"])


async def _create_runtime(provider: CloudProviderKind) -> dict[str, Any]:
    harness = await CloudWorkspaceHarness.from_env(provider)
    workspace_id: str | None = None
    try:
        workspace = await harness.create_workspace()
        workspace_id = str(workspace["id"])
        ready = await harness.wait_for_status(workspace["id"], "ready")
        connection = await harness.wait_for_connection(workspace["id"])
        runtime_workspace = await harness.get_runtime_workspace(connection)
        repo_path, bridge_workspace_id = await _prepare_bridge_workspace(
            harness,
            connection=connection,
            runtime_workspace=runtime_workspace,
        )
        return {
            "provider": provider,
            "cloudWorkspaceId": ready["id"],
            "runtimeUrl": connection["runtimeUrl"],
            "authToken": connection["accessToken"],
            "anyharnessWorkspaceId": bridge_workspace_id,
            "readyAgentKinds": connection.get("readyAgentKinds", []),
            "repoPath": repo_path,
        }
    except Exception:
        if workspace_id is not None:
            with suppress(Exception):
                await harness.delete_workspace(workspace_id)
        raise
    finally:
        await harness.close()


async def _destroy_runtime(provider: CloudProviderKind, cloud_workspace_id: str) -> None:
    harness = await CloudWorkspaceHarness.from_env(provider)
    try:
        await harness.delete_workspace(cloud_workspace_id)
    finally:
        await harness.close()


async def _main() -> None:
    args = _parse_args()
    if args.command == "create-runtime":
        print(json.dumps(await _create_runtime(args.provider)))
        return
    if args.command == "destroy-runtime":
        await _destroy_runtime(args.provider, args.cloud_workspace_id)
        return
    raise RuntimeError(f"Unknown command: {args.command}")


if __name__ == "__main__":
    asyncio.run(_main())
