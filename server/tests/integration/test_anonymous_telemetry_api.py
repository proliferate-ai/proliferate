from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.anonymous_telemetry import (
    AnonymousTelemetryEventRecord,
    AnonymousTelemetryInstall,
)


@pytest.mark.asyncio
async def test_anonymous_telemetry_endpoint_records_version_payload(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    install_uuid = uuid.uuid4()

    response = await client.post(
        "/v1/telemetry/anonymous",
        json={
            "installUuid": str(install_uuid),
            "surface": "desktop",
            "telemetryMode": "self_managed",
            "recordType": "VERSION",
            "payload": {
                "appVersion": "0.1.11",
                "platform": "darwin",
                "arch": "arm64",
            },
        },
    )

    assert response.status_code == 202
    assert response.json() == {"accepted": True}

    install_row = (
        await db_session.execute(
            select(AnonymousTelemetryInstall).where(
                AnonymousTelemetryInstall.install_uuid == install_uuid,
                AnonymousTelemetryInstall.surface == "desktop",
            )
        )
    ).scalar_one()
    assert install_row.last_telemetry_mode == "self_managed"
    assert install_row.last_app_version == "0.1.11"
    assert install_row.last_platform == "darwin"
    assert install_row.last_arch == "arm64"

    event_row = (
        await db_session.execute(
            select(AnonymousTelemetryEventRecord).where(
                AnonymousTelemetryEventRecord.install_uuid == install_uuid,
                AnonymousTelemetryEventRecord.record_type == "VERSION",
            )
        )
    ).scalar_one()
    assert event_row.surface == "desktop"
    assert event_row.telemetry_mode == "self_managed"
    assert event_row.payload_json == {
        "app_version": "0.1.11",
        "platform": "darwin",
        "arch": "arm64",
    }


@pytest.mark.asyncio
async def test_anonymous_telemetry_endpoint_records_usage_payload(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    install_uuid = uuid.uuid4()

    response = await client.post(
        "/v1/telemetry/anonymous",
        json={
            "installUuid": str(install_uuid),
            "surface": "desktop",
            "telemetryMode": "local_dev",
            "recordType": "USAGE",
            "payload": {
                "sessionsStarted": 2,
                "promptsSubmitted": 5,
                "workspacesCreatedLocal": 1,
                "workspacesCreatedCloud": 0,
                "credentialsSynced": 1,
                "connectorsInstalled": 3,
            },
        },
    )

    assert response.status_code == 202

    install_row = (
        await db_session.execute(
            select(AnonymousTelemetryInstall).where(
                AnonymousTelemetryInstall.install_uuid == install_uuid,
                AnonymousTelemetryInstall.surface == "desktop",
            )
        )
    ).scalar_one()
    assert install_row.last_telemetry_mode == "local_dev"
    assert install_row.last_app_version is None
    assert install_row.last_platform is None
    assert install_row.last_arch is None

    event_row = (
        await db_session.execute(
            select(AnonymousTelemetryEventRecord).where(
                AnonymousTelemetryEventRecord.install_uuid == install_uuid,
                AnonymousTelemetryEventRecord.record_type == "USAGE",
            )
        )
    ).scalar_one()
    assert event_row.payload_json == {
        "sessions_started": 2,
        "prompts_submitted": 5,
        "workspaces_created_local": 1,
        "workspaces_created_cloud": 0,
        "credentials_synced": 1,
        "connectors_installed": 3,
    }


@pytest.mark.asyncio
async def test_anonymous_telemetry_endpoint_records_activation_payload(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    install_uuid = uuid.uuid4()

    response = await client.post(
        "/v1/telemetry/anonymous",
        json={
            "installUuid": str(install_uuid),
            "surface": "desktop",
            "telemetryMode": "hosted_product",
            "recordType": "ACTIVATION",
            "payload": {
                "milestone": "first_prompt_submitted",
            },
        },
    )

    assert response.status_code == 202
    assert response.json() == {"accepted": True}

    install_row = (
        await db_session.execute(
            select(AnonymousTelemetryInstall).where(
                AnonymousTelemetryInstall.install_uuid == install_uuid,
                AnonymousTelemetryInstall.surface == "desktop",
            )
        )
    ).scalar_one()
    assert install_row.last_telemetry_mode == "hosted_product"
    assert install_row.last_app_version is None

    event_row = (
        await db_session.execute(
            select(AnonymousTelemetryEventRecord).where(
                AnonymousTelemetryEventRecord.install_uuid == install_uuid,
                AnonymousTelemetryEventRecord.record_type == "ACTIVATION",
            )
        )
    ).scalar_one()
    assert event_row.payload_json == {
        "milestone": "first_prompt_submitted",
    }
