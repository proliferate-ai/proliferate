"""HTTP routes for cloud secrets."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.api_errors import CloudApiError
from proliferate.server.cloud.secrets import access, service
from proliferate.server.cloud.secrets.models import (
    CloudSecretsResponse,
    DeleteCloudSecretFileRequest,
    PutCloudSecretEnvVarRequest,
    PutCloudSecretFileRequest,
    cloud_secrets_payload,
)

router = APIRouter(tags=["cloud-secrets"])


async def _read_uploaded_secret_file(file: UploadFile) -> str:
    content = await file.read()
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise CloudApiError(
            "invalid_secret_file_upload",
            "Secret files must be UTF-8 text.",
            status_code=400,
        ) from error
    finally:
        await file.close()


async def _organization_secret_upload_access(
    organization_id: UUID,
    path: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> tuple[str, str, access.OrganizationSecretsAccess]:
    content = await _read_uploaded_secret_file(file)
    member_access = await access.organization_secrets_member_access(
        organization_id,
        user=user,
        db=db,
    )
    admin_access = await access.organization_secrets_admin_access(member_access)
    return path, content, admin_access


async def _workspace_secret_upload_access(
    git_owner: str,
    git_repo_name: str,
    path: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> tuple[str, str, access.WorkspaceSecretsAccess]:
    content = await _read_uploaded_secret_file(file)
    workspace_access = await access.workspace_secrets_access(
        git_owner,
        git_repo_name,
        user=user,
        db=db,
    )
    return path, content, workspace_access


@router.get("/secrets/personal", response_model=CloudSecretsResponse)
async def get_personal_secrets_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    value, materialization = await service.get_personal_secrets(db, user_id=user.id)
    return cloud_secrets_payload(value, materialization=materialization)


@router.put("/secrets/personal/env-vars/{name}", response_model=CloudSecretsResponse)
async def put_personal_secret_env_var_endpoint(
    name: str,
    body: PutCloudSecretEnvVarRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    value, materialization = await service.set_personal_secret_env_var(
        db,
        user_id=user.id,
        name=name,
        value=body.value,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete("/secrets/personal/env-vars/{name}", response_model=CloudSecretsResponse)
async def delete_personal_secret_env_var_endpoint(
    name: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    value, materialization = await service.delete_personal_secret_env_var(
        db,
        user_id=user.id,
        name=name,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.put("/secrets/personal/files", response_model=CloudSecretsResponse)
async def put_personal_secret_file_endpoint(
    body: PutCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    value, materialization = await service.set_personal_secret_file(
        db,
        user_id=user.id,
        path=body.path,
        content=body.content,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.put("/secrets/personal/files/upload", response_model=CloudSecretsResponse)
async def upload_personal_secret_file_endpoint(
    path: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    value, materialization = await service.set_personal_secret_file(
        db,
        user_id=user.id,
        path=path,
        content=await _read_uploaded_secret_file(file),
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete("/secrets/personal/files", response_model=CloudSecretsResponse)
async def delete_personal_secret_file_endpoint(
    body: DeleteCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    value, materialization = await service.delete_personal_secret_file(
        db,
        user_id=user.id,
        path=body.path,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.get("/organizations/{organization_id}/secrets", response_model=CloudSecretsResponse)
async def get_organization_secrets_endpoint(
    db: AsyncSession = Depends(get_async_session),
    organization_access: access.OrganizationSecretsAccess = Depends(
        access.organization_secrets_member_access
    ),
) -> CloudSecretsResponse:
    value, materialization = await service.get_organization_secrets(
        db,
        user_id=organization_access.actor_user_id,
        organization_id=organization_access.organization_id,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/organizations/{organization_id}/secrets/env-vars/{name}",
    response_model=CloudSecretsResponse,
)
async def put_organization_secret_env_var_endpoint(
    name: str,
    body: PutCloudSecretEnvVarRequest,
    db: AsyncSession = Depends(get_async_session),
    organization_access: access.OrganizationSecretsAccess = Depends(
        access.organization_secrets_admin_access
    ),
) -> CloudSecretsResponse:
    value, materialization = await service.set_organization_secret_env_var(
        db,
        user_id=organization_access.actor_user_id,
        organization_id=organization_access.organization_id,
        name=name,
        value=body.value,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete(
    "/organizations/{organization_id}/secrets/env-vars/{name}",
    response_model=CloudSecretsResponse,
)
async def delete_organization_secret_env_var_endpoint(
    name: str,
    db: AsyncSession = Depends(get_async_session),
    organization_access: access.OrganizationSecretsAccess = Depends(
        access.organization_secrets_admin_access
    ),
) -> CloudSecretsResponse:
    value, materialization = await service.delete_organization_secret_env_var(
        db,
        user_id=organization_access.actor_user_id,
        organization_id=organization_access.organization_id,
        name=name,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/organizations/{organization_id}/secrets/files",
    response_model=CloudSecretsResponse,
)
async def put_organization_secret_file_endpoint(
    body: PutCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    organization_access: access.OrganizationSecretsAccess = Depends(
        access.organization_secrets_admin_access
    ),
) -> CloudSecretsResponse:
    value, materialization = await service.set_organization_secret_file(
        db,
        user_id=organization_access.actor_user_id,
        organization_id=organization_access.organization_id,
        path=body.path,
        content=body.content,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/organizations/{organization_id}/secrets/files/upload",
    response_model=CloudSecretsResponse,
)
async def upload_organization_secret_file_endpoint(
    upload: Annotated[
        tuple[str, str, access.OrganizationSecretsAccess],
        Depends(_organization_secret_upload_access),
    ],
    db: AsyncSession = Depends(get_async_session),
) -> CloudSecretsResponse:
    path, content, organization_access = upload
    value, materialization = await service.set_organization_secret_file(
        db,
        user_id=organization_access.actor_user_id,
        organization_id=organization_access.organization_id,
        path=path,
        content=content,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete(
    "/organizations/{organization_id}/secrets/files",
    response_model=CloudSecretsResponse,
)
async def delete_organization_secret_file_endpoint(
    body: DeleteCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    organization_access: access.OrganizationSecretsAccess = Depends(
        access.organization_secrets_admin_access
    ),
) -> CloudSecretsResponse:
    value, materialization = await service.delete_organization_secret_file(
        db,
        user_id=organization_access.actor_user_id,
        organization_id=organization_access.organization_id,
        path=body.path,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.get(
    "/repos/{git_owner}/{git_repo_name}/secrets",
    response_model=CloudSecretsResponse,
)
async def get_workspace_secrets_endpoint(
    db: AsyncSession = Depends(get_async_session),
    workspace_access: access.WorkspaceSecretsAccess = Depends(access.workspace_secrets_access),
) -> CloudSecretsResponse:
    value, materialization = await service.get_workspace_secrets(
        db,
        user_id=workspace_access.actor_user_id,
        repo_environment_id=workspace_access.repo_environment_id,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/repos/{git_owner}/{git_repo_name}/secrets/env-vars/{name}",
    response_model=CloudSecretsResponse,
)
async def put_workspace_secret_env_var_endpoint(
    name: str,
    body: PutCloudSecretEnvVarRequest,
    db: AsyncSession = Depends(get_async_session),
    workspace_access: access.WorkspaceSecretsAccess = Depends(access.workspace_secrets_access),
) -> CloudSecretsResponse:
    value, materialization = await service.set_workspace_secret_env_var(
        db,
        user_id=workspace_access.actor_user_id,
        repo_environment_id=workspace_access.repo_environment_id,
        name=name,
        value=body.value,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete(
    "/repos/{git_owner}/{git_repo_name}/secrets/env-vars/{name}",
    response_model=CloudSecretsResponse,
)
async def delete_workspace_secret_env_var_endpoint(
    name: str,
    db: AsyncSession = Depends(get_async_session),
    workspace_access: access.WorkspaceSecretsAccess = Depends(access.workspace_secrets_access),
) -> CloudSecretsResponse:
    value, materialization = await service.delete_workspace_secret_env_var(
        db,
        user_id=workspace_access.actor_user_id,
        repo_environment_id=workspace_access.repo_environment_id,
        name=name,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/repos/{git_owner}/{git_repo_name}/secrets/files",
    response_model=CloudSecretsResponse,
)
async def put_workspace_secret_file_endpoint(
    body: PutCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    workspace_access: access.WorkspaceSecretsAccess = Depends(access.workspace_secrets_access),
) -> CloudSecretsResponse:
    value, materialization = await service.set_workspace_secret_file(
        db,
        user_id=workspace_access.actor_user_id,
        repo_environment_id=workspace_access.repo_environment_id,
        path=body.path,
        content=body.content,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/repos/{git_owner}/{git_repo_name}/secrets/files/upload",
    response_model=CloudSecretsResponse,
)
async def upload_workspace_secret_file_endpoint(
    upload: Annotated[
        tuple[str, str, access.WorkspaceSecretsAccess],
        Depends(_workspace_secret_upload_access),
    ],
    db: AsyncSession = Depends(get_async_session),
) -> CloudSecretsResponse:
    path, content, workspace_access = upload
    value, materialization = await service.set_workspace_secret_file(
        db,
        user_id=workspace_access.actor_user_id,
        repo_environment_id=workspace_access.repo_environment_id,
        path=path,
        content=content,
    )
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete(
    "/repos/{git_owner}/{git_repo_name}/secrets/files",
    response_model=CloudSecretsResponse,
)
async def delete_workspace_secret_file_endpoint(
    body: DeleteCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    workspace_access: access.WorkspaceSecretsAccess = Depends(access.workspace_secrets_access),
) -> CloudSecretsResponse:
    value, materialization = await service.delete_workspace_secret_file(
        db,
        user_id=workspace_access.actor_user_id,
        repo_environment_id=workspace_access.repo_environment_id,
        path=body.path,
    )
    return cloud_secrets_payload(value, materialization=materialization)
