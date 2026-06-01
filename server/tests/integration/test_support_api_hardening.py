import asyncio

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db import engine as engine_module
from proliferate.db.store import support_reports
from tests.integration.test_support_api import (
    _register_and_login,
    _seed_personal_cloud_workspace,
)


@pytest.mark.asyncio
async def test_support_report_create_includes_authorized_cloud_workspace_correlation(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = await _register_and_login(client, "support-report-cloud@example.com")
    workspace = await _seed_personal_cloud_workspace(
        db_session,
        user_id=session["user_id"],
        suffix="support",
    )
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")
    cloud_diagnostics_started = asyncio.Event()

    async def fake_put_json_object(
        *,
        bucket: str,
        key: str,
        value: dict[str, object],
        region_name: str | None = None,
    ) -> None:
        assert bucket == "support-bucket"
        assert key.endswith("/request.json")

    async def fake_collect_cloud_diagnostics_for_report(report_id: str) -> None:
        async with engine_module.async_session_factory() as session:
            report = await support_reports.get_report_by_id(session, report_id)
        assert report is not None
        assert report.request_object_written_at is not None
        cloud_diagnostics_started.set()

    monkeypatch.setattr(
        "proliferate.server.support.service.put_json_object",
        fake_put_json_object,
    )
    monkeypatch.setattr(
        "proliferate.server.support.jobs.collect_cloud_diagnostics_for_report",
        fake_collect_cloud_diagnostics_for_report,
    )

    response = await client.post(
        "/v1/support/reports",
        headers=headers,
        json={
            "clientJobId": "support-job-cloud",
            "message": "Cloud workspace failed.",
            "sourceSurface": "desktop",
            "scope": {
                "kind": "choose_workspace",
                "workspaceIds": [f"cloud:{workspace.id}"],
            },
            "workspaceRefs": [
                {
                    "id": f"cloud:{workspace.id}",
                    "location": "cloud",
                    "cloudWorkspaceId": str(workspace.id),
                    "anyharnessWorkspaceId": workspace.anyharness_workspace_id,
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["cloudDiagnosticsStatus"] == "pending"
    assert payload["serverCorrelation"]["cloudWorkspaceIds"] == [str(workspace.id)]
    await asyncio.wait_for(cloud_diagnostics_started.wait(), timeout=1)


@pytest.mark.asyncio
async def test_support_report_create_excludes_unverified_cloud_refs_from_correlation(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = await _register_and_login(client, "support-report-unverified@example.com")
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")
    records: list[dict[str, object]] = []

    async def fake_put_json_object(
        *,
        bucket: str,
        key: str,
        value: dict[str, object],
        region_name: str | None = None,
    ) -> None:
        assert bucket == "support-bucket"
        assert key.endswith("/request.json")
        records.append(value)

    monkeypatch.setattr(
        "proliferate.server.support.service.put_json_object",
        fake_put_json_object,
    )

    response = await client.post(
        "/v1/support/reports",
        headers=headers,
        json={
            "clientJobId": "support-job-unverified-cloud",
            "message": "Cloud workspace failed.",
            "sourceSurface": "desktop",
            "scope": {
                "kind": "choose_workspace",
                "workspaceIds": ["cloud:11111111-1111-1111-1111-111111111111"],
            },
            "workspaceRefs": [
                {
                    "id": "cloud:11111111-1111-1111-1111-111111111111",
                    "location": "cloud",
                    "cloudWorkspaceId": "11111111-1111-1111-1111-111111111111",
                    "cloudTargetId": "22222222-2222-2222-2222-222222222222",
                    "anyharnessWorkspaceId": "forged-workspace",
                    "sessionIds": ["forged-session"],
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["cloudDiagnosticsStatus"] == "not_applicable"
    assert payload["serverCorrelation"]["cloudWorkspaceIds"] == []
    assert payload["serverCorrelation"]["cloudTargetIds"] == []
    assert payload["serverCorrelation"]["anyharnessWorkspaceIds"] == []
    assert payload["serverCorrelation"]["sessionIds"] == []
    assert records[0]["workspaceRefs"] == [
        {
            "id": "cloud:[unverified]",
            "location": "cloud",
            "status": "unverified",
        }
    ]
    assert records[0]["scope"]["workspaceIds"] == ["cloud:[unverified]"]


@pytest.mark.asyncio
async def test_support_report_complete_requires_all_expected_uploads(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = await _register_and_login(client, "support-report-missing-upload@example.com")
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")

    async def fake_put_json_object(
        *,
        bucket: str,
        key: str,
        value: dict[str, object],
        region_name: str | None = None,
    ) -> None:
        assert bucket == "support-bucket"
        assert key.endswith("/request.json")

    async def fake_presign_put_object(
        *,
        bucket: str,
        key: str,
        content_type: str,
        expires_seconds: int,
        region_name: str | None = None,
    ) -> str:
        return f"https://s3.test/{key}"

    monkeypatch.setattr(
        "proliferate.server.support.service.put_json_object",
        fake_put_json_object,
    )
    monkeypatch.setattr(
        "proliferate.server.support.storage.presign_put_object",
        fake_presign_put_object,
    )

    create = await client.post(
        "/v1/support/reports",
        headers=headers,
        json={
            "clientJobId": "support-job-missing-upload",
            "message": "The app got stuck.",
            "sourceSurface": "desktop",
            "scope": {"kind": "app_only", "workspaceIds": []},
            "expectedClientUploads": {"diagnostics": True, "attachmentCount": 1},
        },
    )
    assert create.status_code == 200
    report_id = create.json()["reportId"]
    targets = await client.post(
        f"/v1/support/reports/{report_id}/upload-targets",
        headers=headers,
        json={
            "diagnostics": {
                "contentType": "application/json",
                "sizeBytes": 512,
                "sha256": "abc123",
            },
            "attachments": [
                {
                    "clientFileId": "file-1",
                    "fileName": "screen.png",
                    "contentType": "image/png",
                    "sizeBytes": 100,
                    "sha256": "def456",
                }
            ],
        },
    )
    assert targets.status_code == 200

    complete = await client.post(
        f"/v1/support/reports/{report_id}/complete",
        headers=headers,
        json={
            "diagnostics": {
                "objectKey": targets.json()["diagnostics"]["objectKey"],
                "sha256": "abc123",
                "sizeBytes": 512,
            },
            "attachments": [],
            "packageManifest": {"schemaVersion": 2},
        },
    )

    assert complete.status_code == 400
    assert complete.json()["detail"]["code"] == "support_report_upload_invalid"


@pytest.mark.asyncio
async def test_support_report_complete_rejects_changed_manifest_size_and_checksum(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = await _register_and_login(client, "support-report-changed-upload@example.com")
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")

    async def fake_put_json_object(
        *,
        bucket: str,
        key: str,
        value: dict[str, object],
        region_name: str | None = None,
    ) -> None:
        assert bucket == "support-bucket"
        assert key.endswith("/request.json")

    async def fake_presign_put_object(
        *,
        bucket: str,
        key: str,
        content_type: str,
        expires_seconds: int,
        region_name: str | None = None,
    ) -> str:
        return f"https://s3.test/{key}"

    async def fake_head_object(
        *,
        bucket: str,
        key: str,
        region_name: str | None = None,
    ) -> dict[str, object]:
        raise AssertionError("completion should fail before checking S3 metadata")

    monkeypatch.setattr(
        "proliferate.server.support.service.put_json_object",
        fake_put_json_object,
    )
    monkeypatch.setattr(
        "proliferate.server.support.storage.presign_put_object",
        fake_presign_put_object,
    )
    monkeypatch.setattr("proliferate.server.support.storage.head_object", fake_head_object)

    create = await client.post(
        "/v1/support/reports",
        headers=headers,
        json={
            "clientJobId": "support-job-changed-upload",
            "message": "The app got stuck.",
            "sourceSurface": "desktop",
            "scope": {"kind": "app_only", "workspaceIds": []},
            "expectedClientUploads": {"diagnostics": True, "attachmentCount": 0},
        },
    )
    assert create.status_code == 200
    report_id = create.json()["reportId"]
    targets = await client.post(
        f"/v1/support/reports/{report_id}/upload-targets",
        headers=headers,
        json={
            "diagnostics": {
                "contentType": "application/json",
                "sizeBytes": 512,
                "sha256": "abc123",
            },
            "attachments": [],
        },
    )
    assert targets.status_code == 200

    changed_size = await client.post(
        f"/v1/support/reports/{report_id}/complete",
        headers=headers,
        json={
            "diagnostics": {
                "objectKey": targets.json()["diagnostics"]["objectKey"],
                "sha256": "abc123",
                "sizeBytes": 513,
            },
            "attachments": [],
            "packageManifest": {"schemaVersion": 2},
        },
    )
    assert changed_size.status_code == 400
    assert changed_size.json()["detail"]["code"] == "support_report_upload_invalid"

    changed_checksum = await client.post(
        f"/v1/support/reports/{report_id}/complete",
        headers=headers,
        json={
            "diagnostics": {
                "objectKey": targets.json()["diagnostics"]["objectKey"],
                "sha256": "changed",
                "sizeBytes": 512,
            },
            "attachments": [],
            "packageManifest": {"schemaVersion": 2},
        },
    )
    assert changed_checksum.status_code == 400
    assert changed_checksum.json()["detail"]["code"] == "support_report_upload_invalid"
