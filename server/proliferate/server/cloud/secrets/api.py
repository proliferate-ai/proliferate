"""HTTP routes for cloud secrets."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.secrets import service
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
    try:
        value, materialization = await service.set_personal_secret_env_var(
            db,
            user_id=user.id,
            name=name,
            value=body.value,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete("/secrets/personal/env-vars/{name}", response_model=CloudSecretsResponse)
async def delete_personal_secret_env_var_endpoint(
    name: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.delete_personal_secret_env_var(
            db,
            user_id=user.id,
            name=name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.put("/secrets/personal/files", response_model=CloudSecretsResponse)
async def put_personal_secret_file_endpoint(
    body: PutCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.set_personal_secret_file(
            db,
            user_id=user.id,
            path=body.path,
            content=body.content,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.put("/secrets/personal/files/upload", response_model=CloudSecretsResponse)
async def upload_personal_secret_file_endpoint(
    path: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.set_personal_secret_file(
            db,
            user_id=user.id,
            path=path,
            content=await _read_uploaded_secret_file(file),
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete("/secrets/personal/files", response_model=CloudSecretsResponse)
async def delete_personal_secret_file_endpoint(
    body: DeleteCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.delete_personal_secret_file(
            db,
            user_id=user.id,
            path=body.path,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.get("/organizations/{organization_id}/secrets", response_model=CloudSecretsResponse)
async def get_organization_secrets_endpoint(
    organization_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.get_organization_secrets(
            db,
            user_id=user.id,
            organization_id=organization_id,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/organizations/{organization_id}/secrets/env-vars/{name}",
    response_model=CloudSecretsResponse,
)
async def put_organization_secret_env_var_endpoint(
    organization_id: UUID,
    name: str,
    body: PutCloudSecretEnvVarRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.set_organization_secret_env_var(
            db,
            user_id=user.id,
            organization_id=organization_id,
            name=name,
            value=body.value,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete(
    "/organizations/{organization_id}/secrets/env-vars/{name}",
    response_model=CloudSecretsResponse,
)
async def delete_organization_secret_env_var_endpoint(
    organization_id: UUID,
    name: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.delete_organization_secret_env_var(
            db,
            user_id=user.id,
            organization_id=organization_id,
            name=name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/organizations/{organization_id}/secrets/files",
    response_model=CloudSecretsResponse,
)
async def put_organization_secret_file_endpoint(
    organization_id: UUID,
    body: PutCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.set_organization_secret_file(
            db,
            user_id=user.id,
            organization_id=organization_id,
            path=body.path,
            content=body.content,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/organizations/{organization_id}/secrets/files/upload",
    response_model=CloudSecretsResponse,
)
async def upload_organization_secret_file_endpoint(
    organization_id: UUID,
    path: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.set_organization_secret_file(
            db,
            user_id=user.id,
            organization_id=organization_id,
            path=path,
            content=await _read_uploaded_secret_file(file),
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete(
    "/organizations/{organization_id}/secrets/files",
    response_model=CloudSecretsResponse,
)
async def delete_organization_secret_file_endpoint(
    organization_id: UUID,
    body: DeleteCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.delete_organization_secret_file(
            db,
            user_id=user.id,
            organization_id=organization_id,
            path=body.path,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.get(
    "/repos/{git_owner}/{git_repo_name}/secrets",
    response_model=CloudSecretsResponse,
)
async def get_workspace_secrets_endpoint(
    git_owner: str,
    git_repo_name: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.get_workspace_secrets(
            db,
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/repos/{git_owner}/{git_repo_name}/secrets/env-vars/{name}",
    response_model=CloudSecretsResponse,
)
async def put_workspace_secret_env_var_endpoint(
    git_owner: str,
    git_repo_name: str,
    name: str,
    body: PutCloudSecretEnvVarRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.set_workspace_secret_env_var(
            db,
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            name=name,
            value=body.value,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete(
    "/repos/{git_owner}/{git_repo_name}/secrets/env-vars/{name}",
    response_model=CloudSecretsResponse,
)
async def delete_workspace_secret_env_var_endpoint(
    git_owner: str,
    git_repo_name: str,
    name: str,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.delete_workspace_secret_env_var(
            db,
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            name=name,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/repos/{git_owner}/{git_repo_name}/secrets/files",
    response_model=CloudSecretsResponse,
)
async def put_workspace_secret_file_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: PutCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.set_workspace_secret_file(
            db,
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            path=body.path,
            content=body.content,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.put(
    "/repos/{git_owner}/{git_repo_name}/secrets/files/upload",
    response_model=CloudSecretsResponse,
)
async def upload_workspace_secret_file_endpoint(
    git_owner: str,
    git_repo_name: str,
    path: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.set_workspace_secret_file(
            db,
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            path=path,
            content=await _read_uploaded_secret_file(file),
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)


@router.delete(
    "/repos/{git_owner}/{git_repo_name}/secrets/files",
    response_model=CloudSecretsResponse,
)
async def delete_workspace_secret_file_endpoint(
    git_owner: str,
    git_repo_name: str,
    body: DeleteCloudSecretFileRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> CloudSecretsResponse:
    try:
        value, materialization = await service.delete_workspace_secret_file(
            db,
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            path=body.path,
        )
    except CloudApiError as error:
        raise_cloud_error(error)
    return cloud_secrets_payload(value, materialization=materialization)
