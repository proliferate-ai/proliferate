"""Support-report upload-target idempotency.

Split out of test_support_api.py to keep that file under the max-line limit.
Re-issuing targets must be idempotent by object identity: re-captured
diagnostics drift in size/sha256 but the object set is unchanged.
"""

import pytest
from httpx import AsyncClient

from proliferate.config import settings
from tests.integration.test_support_api import _register_and_login


@pytest.mark.asyncio
async def test_support_report_upload_targets_reissue_refreshes_drifted_content(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = await _register_and_login(client, "support-report-reissue@example.com")
    headers = {"Authorization": f"Bearer {session['access_token']}"}
    monkeypatch.setattr(settings, "support_report_s3_bucket", "support-bucket")
    monkeypatch.setattr(settings, "support_report_s3_region", "us-west-2")

    async def fake_put_json_object(
        *, bucket: str, key: str, value: dict[str, object], region_name: str | None = None
    ) -> None:
        return None

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

    created = await client.post(
        "/v1/support/reports",
        headers=headers,
        json={
            "clientJobId": "support-job-reissue",
            "message": "The app got stuck.",
            "sourceSurface": "desktop",
            "context": {"source": "sidebar", "pathname": "/workspace"},
            "scope": {"kind": "app_only", "workspaceIds": []},
            "workspaceRefs": [],
            "expectedClientUploads": {"diagnostics": True, "attachmentCount": 1},
            "publicContentConsent": True,
        },
    )
    assert created.status_code == 200
    report_id = created.json()["reportId"]

    def upload_body(sha: str, size: int) -> dict[str, object]:
        return {
            "diagnostics": {
                "contentType": "application/json",
                "sizeBytes": size,
                "sha256": sha,
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
        }

    first = await client.post(
        f"/v1/support/reports/{report_id}/upload-targets",
        headers=headers,
        json=upload_body("abc123", 512),
    )
    assert first.status_code == 200

    # The client re-captures diagnostics on every retry, so size/sha256 drift
    # even though the object set is identical. Re-issuing must succeed (the
    # old behavior rejected this forever as "different objects").
    reissued = await client.post(
        f"/v1/support/reports/{report_id}/upload-targets",
        headers=headers,
        json=upload_body("refreshed", 2048),
    )
    assert reissued.status_code == 200
    assert reissued.json()["diagnostics"]["putUrl"].startswith("https://s3.test/")
    assert reissued.json()["attachments"][0]["clientFileId"] == "file-1"

    # Same intent (1 attachment) but a genuinely different object key set (new
    # client_file_id) IS a conflict — exercises the object-key comparison
    # branch directly, not the intent validation that guards it.
    different_objects = await client.post(
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
                    "clientFileId": "file-2",
                    "fileName": "other.png",
                    "contentType": "image/png",
                    "sizeBytes": 100,
                    "sha256": "def456",
                }
            ],
        },
    )
    assert different_objects.status_code == 400
    assert different_objects.json()["detail"]["code"] == "support_report_upload_conflict"
