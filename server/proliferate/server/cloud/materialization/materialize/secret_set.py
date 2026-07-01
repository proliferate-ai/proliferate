"""Cloud secret-set materialization into sandboxes."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_sandbox_secrets as sandbox_secret_store
from proliferate.db.store import cloud_secrets as cloud_secrets_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store import repositories as repositories_store
from proliferate.db.store.cloud_secrets import CloudSecretSetPayload
from proliferate.db.store.repositories import RepoEnvironmentValue
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.cloud.materialization import manifests, operation, paths, sandbox_io


async def materialize_secret_set(db: AsyncSession, *, secret_set_id: UUID) -> None:
    secret_set = await cloud_secrets_store.load_secret_set_payload(
        db,
        secret_set_id=secret_set_id,
    )
    if secret_set is None:
        return

    if _scope_kind(secret_set) == "personal" and secret_set.user_id is not None:
        await _materialize_global_for_user(db, user_id=secret_set.user_id)
        return
    if _scope_kind(secret_set) == "organization" and secret_set.organization_id is not None:
        members = await organization_store.list_organization_members(
            db,
            secret_set.organization_id,
        )
        for member in members:
            await _materialize_global_for_user(db, user_id=member.membership.user_id)
        return
    if _scope_kind(secret_set) == "workspace" and secret_set.repo_environment_id is not None:
        repo_environment = await repositories_store.get_repo_environment_by_id(
            db,
            secret_set.repo_environment_id,
        )
        if repo_environment is None or repo_environment.environment_kind != "cloud":
            return
        sandbox = await cloud_sandboxes_service.ensure_personal_cloud_sandbox_exists(
            db,
            user_id=repo_environment.user_id,
        )
        await operation.run_cloud_sandbox_operation(
            db,
            sandbox=sandbox,
            operation_key=f"secrets:workspace:{repo_environment.id}",
            run=lambda ctx: materialize_workspace_secrets_for_repo_environment(
                db,
                ctx=ctx,
                repo_environment=repo_environment,
            ),
        )


async def materialize_global_secrets_for_user(
    db: AsyncSession,
    *,
    ctx: operation.MaterializationContext,
    user_id: UUID,
) -> None:
    materialization = await sandbox_secret_store.begin_global_secret_materialization(
        db,
        cloud_sandbox_id=ctx.sandbox.id,
        sandbox_generation=0,
    )
    await db.commit()
    try:
        payloads = list(
            await cloud_secrets_store.list_organization_secret_payloads_for_user(
                db,
                user_id=user_id,
            )
        )
        personal = await cloud_secrets_store.load_personal_secret_payload(db, user_id=user_id)
        if personal is not None:
            payloads.append(personal)

        env, env_sha256, files, files_sha256, versions = _merge_payloads(payloads)
        previous = manifests.owned_secret_file_paths(materialization.applied_manifest)
        await sandbox_io.write_private_file_atomic(
            ctx.target,
            operation_id=materialization.id,
            path=paths.global_env_path(),
            content=manifests.render_env_file(env),
            mode="600",
        )
        await _reconcile_secret_files(
            ctx.target,
            operation_id=materialization.id,
            desired_files=files,
            previous_paths=previous,
            allowed_root=None,
        )
        manifest = manifests.secret_manifest(
            env_sha256=env_sha256,
            files_sha256=files_sha256,
            versions=versions,
        )
        await sandbox_io.write_private_file_atomic(
            ctx.target,
            operation_id=materialization.id,
            path=paths.global_secret_manifest_path(),
            content=manifests.render_manifest(manifest),
            mode="600",
        )
        await sandbox_secret_store.mark_secret_materialization_ready(
            db,
            materialization.id,
            applied_version=max(versions.values(), default=0),
            applied_versions=versions,
            applied_manifest=manifest,
        )
        await db.commit()
    except Exception as exc:
        await sandbox_secret_store.mark_secret_materialization_error(
            db,
            materialization.id,
            last_error=str(exc)[:2000],
        )
        await db.commit()
        raise


async def materialize_workspace_secrets_for_repo_environment(
    db: AsyncSession,
    *,
    ctx: operation.MaterializationContext,
    repo_environment: RepoEnvironmentValue,
) -> None:
    payload = await cloud_secrets_store.load_workspace_secret_payload(
        db,
        repo_environment_id=repo_environment.id,
    )
    materialization = await sandbox_secret_store.begin_workspace_secret_materialization(
        db,
        cloud_sandbox_id=ctx.sandbox.id,
        repo_environment_id=repo_environment.id,
        cloud_secret_set_id=payload.id if payload is not None else None,
        sandbox_generation=0,
    )
    await db.commit()
    try:
        payloads = [payload] if payload is not None else []
        env, env_sha256, files, files_sha256, versions = _merge_workspace_payloads(
            repo_environment,
            payloads,
        )
        previous = manifests.owned_secret_file_paths(materialization.applied_manifest)
        repo_root = paths.repo_path(repo_environment)
        await sandbox_io.write_private_file_atomic(
            ctx.target,
            operation_id=materialization.id,
            path=paths.workspace_env_path(repo_environment),
            content=manifests.render_env_file(env),
            mode="600",
            allowed_root=repo_root,
        )
        await _reconcile_secret_files(
            ctx.target,
            operation_id=materialization.id,
            desired_files=files,
            previous_paths=previous,
            allowed_root=repo_root,
        )
        manifest = manifests.secret_manifest(
            env_sha256=env_sha256,
            files_sha256=files_sha256,
            versions=versions,
        )
        await sandbox_io.write_private_file_atomic(
            ctx.target,
            operation_id=materialization.id,
            path=paths.workspace_secret_manifest_path(repo_environment),
            content=manifests.render_manifest(manifest),
            mode="600",
            allowed_root=repo_root,
        )
        await sandbox_secret_store.mark_secret_materialization_ready(
            db,
            materialization.id,
            applied_version=max(versions.values(), default=0),
            applied_versions=versions,
            applied_manifest=manifest,
        )
        await db.commit()
    except Exception as exc:
        await sandbox_secret_store.mark_secret_materialization_error(
            db,
            materialization.id,
            last_error=str(exc)[:2000],
        )
        await db.commit()
        raise


async def _materialize_global_for_user(db: AsyncSession, *, user_id: UUID) -> None:
    sandbox = await cloud_sandboxes_service.ensure_personal_cloud_sandbox_exists(
        db,
        user_id=user_id,
    )
    await operation.run_cloud_sandbox_operation(
        db,
        sandbox=sandbox,
        operation_key="secrets:global",
        run=lambda ctx: materialize_global_secrets_for_user(db, ctx=ctx, user_id=user_id),
    )


def _scope_kind(secret_set: CloudSecretSetPayload) -> str:
    value = secret_set.scope_kind
    return value.value if hasattr(value, "value") else str(value)


def _secret_version_key(payload: CloudSecretSetPayload) -> str:
    scope = _scope_kind(payload)
    if scope == "personal" and payload.user_id is not None:
        return f"personal:{payload.user_id}"
    if scope == "organization" and payload.organization_id is not None:
        return f"organization:{payload.organization_id}"
    if scope == "workspace" and payload.repo_environment_id is not None:
        return f"workspace:{payload.repo_environment_id}"
    return f"{scope}:{payload.id}"


def _merge_payloads(
    payloads: list[CloudSecretSetPayload],
) -> tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, int]]:
    env: dict[str, str] = {}
    env_sha256: dict[str, str] = {}
    files: dict[str, str] = {}
    files_sha256: dict[str, str] = {}
    versions: dict[str, int] = {}
    for payload in payloads:
        versions[_secret_version_key(payload)] = payload.version
        for item in payload.env_vars:
            env[item.name] = item.value
            env_sha256[item.name] = item.value_sha256
        for item in payload.files:
            files[item.path] = item.content
            files_sha256[item.path] = item.content_sha256
    return env, env_sha256, files, files_sha256, versions


def _merge_workspace_payloads(
    repo_environment: RepoEnvironmentValue,
    payloads: list[CloudSecretSetPayload],
) -> tuple[dict[str, str], dict[str, str], dict[str, str], dict[str, str], dict[str, int]]:
    env, env_sha256, files, files_sha256, versions = _merge_payloads(payloads)
    absolute_files = {
        paths.repo_relative_secret_path(repo_environment, relative_path): content
        for relative_path, content in files.items()
    }
    absolute_files_sha256 = {
        paths.repo_relative_secret_path(repo_environment, relative_path): checksum
        for relative_path, checksum in files_sha256.items()
    }
    return env, env_sha256, absolute_files, absolute_files_sha256, versions


async def _reconcile_secret_files(
    target: sandbox_io.SandboxIOTarget,
    *,
    operation_id: UUID,
    desired_files: dict[str, str],
    previous_paths: set[str],
    allowed_root: str | None,
) -> None:
    for path, content in sorted(desired_files.items()):
        await sandbox_io.write_private_file_atomic(
            target,
            operation_id=operation_id,
            path=path,
            content=content,
            mode="600",
            allowed_root=allowed_root,
        )
    await sandbox_io.remove_owned_files(
        target,
        operation_id=operation_id,
        paths=previous_paths - set(desired_files.keys()),
        allowed_root=allowed_root,
    )
