"""Secret desired-state materialization for managed sandboxes."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.store import cloud_secrets as secret_store
from proliferate.db.store.cloud_repo_config import CloudRepoConfigValue
from proliferate.db.store.managed_sandbox_secrets import (
    begin_global_secret_materialization,
    begin_workspace_secret_materialization,
    mark_secret_materialization_error,
    mark_secret_materialization_ready,
)
from proliferate.db.store.managed_sandboxes import ManagedSandboxValue
from proliferate.server.cloud.event_logging import format_exception_message
from proliferate.server.cloud.managed_sandboxes.materialization.commands import (
    MaterializationTarget,
    connect_materialization_target,
    reconcile_owned_files,
    write_private_file,
)
from proliferate.server.cloud.managed_sandboxes.materialization.manifests import (
    MaterializedSecretManifest,
    file_paths_from_manifest,
    render_env_file,
    render_manifest_json,
)
from proliferate.server.cloud.managed_sandboxes.materialization.paths import (
    global_secret_env_path,
    global_secret_manifest_path,
    repo_relative_path,
    workspace_secret_env_path,
    workspace_secret_manifest_path,
)


def _payload_key(payload: secret_store.CloudSecretSetPayload) -> str:
    if payload.scope_kind == "personal" and payload.user_id is not None:
        return f"personal:{payload.user_id}"
    if payload.scope_kind == "organization" and payload.organization_id is not None:
        return f"organization:{payload.organization_id}"
    if payload.scope_kind == "workspace" and payload.repo_environment_id is not None:
        return f"workspace:{payload.repo_environment_id}"
    return f"{payload.scope_kind}:{payload.id}"


def _merge_env_payloads(
    payloads: list[secret_store.CloudSecretSetPayload],
    *,
    base_env: dict[str, str] | None = None,
) -> dict[str, str]:
    merged: dict[str, str] = dict(base_env or {})
    for payload in payloads:
        for item in payload.env_vars:
            merged[item.name] = item.value
    return merged


def _merge_file_payloads(
    payloads: list[secret_store.CloudSecretSetPayload],
) -> dict[str, str]:
    merged: dict[str, str] = {}
    for payload in payloads:
        for item in payload.files:
            merged[item.path] = item.content
    return merged


def _versions(payloads: list[secret_store.CloudSecretSetPayload]) -> dict[str, int]:
    return {_payload_key(payload): payload.version for payload in payloads}


def _applied_version(versions: dict[str, int]) -> int:
    return sum(versions.values())


async def materialize_global_secrets(
    db: AsyncSession,
    *,
    sandbox: ManagedSandboxValue,
    target: MaterializationTarget | None = None,
) -> None:
    if sandbox.owner_user_id is None:
        return
    materialization = await begin_global_secret_materialization(
        db,
        managed_sandbox_id=sandbox.id,
        sandbox_generation=sandbox.runtime_generation,
    )
    await db_engine.commit_session(db)
    try:
        target = target or await connect_materialization_target(sandbox)
        organization_payloads = list(
            await secret_store.list_organization_secret_payloads_for_user(
                db,
                user_id=sandbox.owner_user_id,
            )
        )
        organization_payloads.sort(key=_payload_key)
        personal_payload = await secret_store.load_personal_secret_payload(
            db,
            user_id=sandbox.owner_user_id,
        )
        payloads = organization_payloads + ([personal_payload] if personal_payload else [])
        versions = _versions(payloads)
        env_path = global_secret_env_path(target.runtime_context)
        manifest_path = global_secret_manifest_path(target.runtime_context)
        desired_files = _merge_file_payloads(payloads)
        manifest = MaterializedSecretManifest(
            kind="global",
            env_path=env_path,
            manifest_path=manifest_path,
            file_paths=tuple(sorted(desired_files)),
        )
        await write_private_file(
            target,
            sandbox_id=sandbox.id,
            path=env_path,
            content=render_env_file(_merge_env_payloads(payloads)),
        )
        await reconcile_owned_files(
            target,
            sandbox_id=sandbox.id,
            previous_paths=file_paths_from_manifest(materialization.applied_manifest),
            desired_files=desired_files,
        )
        await write_private_file(
            target,
            sandbox_id=sandbox.id,
            path=manifest_path,
            content=render_manifest_json(manifest, versions=versions),
        )
        await mark_secret_materialization_ready(
            db,
            materialization.id,
            applied_version=_applied_version(versions),
            applied_versions=versions,
            applied_manifest=manifest.to_json_dict(),
        )
        await db_engine.commit_session(db)
    except Exception as exc:
        await mark_secret_materialization_error(
            db,
            materialization.id,
            last_error=format_exception_message(exc),
        )
        await db_engine.commit_session(db)
        raise


async def workspace_secret_relative_paths(
    db: AsyncSession,
    *,
    repo_environment_id: UUID,
) -> tuple[str, ...]:
    payload = await secret_store.load_workspace_secret_payload(
        db,
        repo_environment_id=repo_environment_id,
    )
    if payload is None:
        return ()
    return tuple(sorted(item.path for item in payload.files))


async def materialize_workspace_secrets(
    db: AsyncSession,
    *,
    sandbox: ManagedSandboxValue,
    repo_config: CloudRepoConfigValue,
    repo_environment_id: UUID | None = None,
    repo_path: str,
    target: MaterializationTarget | None = None,
    base_env: dict[str, str] | None = None,
    base_files: dict[str, str] | None = None,
) -> None:
    resolved_repo_environment_id = repo_environment_id or repo_config.id
    payload = await secret_store.load_workspace_secret_payload(
        db,
        repo_environment_id=resolved_repo_environment_id,
    )
    materialization = await begin_workspace_secret_materialization(
        db,
        managed_sandbox_id=sandbox.id,
        repo_environment_id=resolved_repo_environment_id,
        cloud_secret_set_id=payload.id if payload is not None else None,
        sandbox_generation=sandbox.runtime_generation,
    )
    await db_engine.commit_session(db)
    try:
        target = target or await connect_materialization_target(sandbox)
        payloads = [payload] if payload is not None else []
        versions = _versions(payloads)
        if base_env:
            versions[f"cloud-repo-config:{repo_config.id}:env"] = repo_config.env_vars_version
        if base_files:
            versions[f"cloud-repo-config:{repo_config.id}:files"] = repo_config.files_version
        env_path = workspace_secret_env_path(repo_path)
        manifest_path = workspace_secret_manifest_path(repo_path)
        desired_files = dict(base_files or {})
        desired_files.update(
            {
                repo_relative_path(repo_path, item.path): item.content
                for item in (payload.files if payload is not None else ())
            }
        )
        manifest = MaterializedSecretManifest(
            kind="workspace",
            env_path=env_path,
            manifest_path=manifest_path,
            file_paths=tuple(sorted(desired_files)),
        )
        await write_private_file(
            target,
            sandbox_id=sandbox.id,
            path=env_path,
            content=render_env_file(_merge_env_payloads(payloads, base_env=base_env)),
            allowed_root=repo_path,
        )
        await reconcile_owned_files(
            target,
            sandbox_id=sandbox.id,
            previous_paths=file_paths_from_manifest(materialization.applied_manifest),
            desired_files=desired_files,
            allowed_root=repo_path,
        )
        await write_private_file(
            target,
            sandbox_id=sandbox.id,
            path=manifest_path,
            content=render_manifest_json(manifest, versions=versions),
            allowed_root=repo_path,
        )
        await mark_secret_materialization_ready(
            db,
            materialization.id,
            applied_version=_applied_version(versions),
            applied_versions=versions,
            applied_manifest=manifest.to_json_dict(),
        )
        await db_engine.commit_session(db)
    except Exception as exc:
        await mark_secret_materialization_error(
            db,
            materialization.id,
            last_error=format_exception_message(exc),
        )
        await db_engine.commit_session(db)
        raise
