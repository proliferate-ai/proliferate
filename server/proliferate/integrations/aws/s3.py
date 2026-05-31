from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from typing import Any

import boto3
from botocore.client import BaseClient
from botocore.exceptions import BotoCoreError, ClientError

from proliferate.integrations.aws.errors import AwsIntegrationError


def _client(*, region_name: str | None = None) -> BaseClient:
    kwargs: dict[str, str] = {}
    if region_name:
        kwargs["region_name"] = region_name
    return boto3.client("s3", **kwargs)


async def presign_put_object(
    *,
    bucket: str,
    key: str,
    content_type: str,
    expires_seconds: int,
    region_name: str | None = None,
) -> str:
    def run() -> str:
        try:
            return str(
                _client(region_name=region_name).generate_presigned_url(
                    "put_object",
                    Params={
                        "Bucket": bucket,
                        "Key": key,
                        "ContentType": content_type,
                        "ServerSideEncryption": "AES256",
                    },
                    ExpiresIn=expires_seconds,
                    HttpMethod="PUT",
                )
            )
        except (BotoCoreError, ClientError) as exc:
            raise AwsIntegrationError(f"Failed to presign S3 PUT: {exc}") from exc

    return await asyncio.to_thread(run)


async def put_json_object(
    *,
    bucket: str,
    key: str,
    value: Mapping[str, Any],
    region_name: str | None = None,
) -> None:
    body = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    def run() -> None:
        try:
            _client(region_name=region_name).put_object(
                Bucket=bucket,
                Key=key,
                Body=body,
                ContentType="application/json",
                ServerSideEncryption="AES256",
            )
        except (BotoCoreError, ClientError) as exc:
            raise AwsIntegrationError(f"Failed to write S3 JSON object: {exc}") from exc

    await asyncio.to_thread(run)


async def get_json_object(
    *,
    bucket: str,
    key: str,
    region_name: str | None = None,
) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        try:
            response = _client(region_name=region_name).get_object(Bucket=bucket, Key=key)
            payload = response["Body"].read().decode("utf-8")
            parsed = json.loads(payload)
        except (
            BotoCoreError,
            ClientError,
            OSError,
            UnicodeDecodeError,
            json.JSONDecodeError,
        ) as exc:
            raise AwsIntegrationError(f"Failed to read S3 JSON object: {exc}") from exc
        if not isinstance(parsed, dict):
            raise AwsIntegrationError("S3 JSON object was not an object.")
        return parsed

    return await asyncio.to_thread(run)


async def head_object(
    *,
    bucket: str,
    key: str,
    region_name: str | None = None,
) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        try:
            return dict(_client(region_name=region_name).head_object(Bucket=bucket, Key=key))
        except (BotoCoreError, ClientError) as exc:
            raise AwsIntegrationError(f"Failed to inspect S3 object: {exc}") from exc

    return await asyncio.to_thread(run)
