from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from proliferate.server.artifact_runtime.service import (
    CONTENT_SECURITY_POLICY,
    INDEX_PATH,
    STATIC_DIR,
    resolve_runtime_path,
)

router = APIRouter()


def _file_headers(path: Path) -> dict[str, str]:
    headers = {
        "Cache-Control": "no-cache",
    }
    if path == INDEX_PATH:
        headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    return headers


@router.get("/artifact-runtime", include_in_schema=False)
@router.get("/artifact-runtime/", include_in_schema=False)
@router.get("/artifact-runtime/{requested_path:path}", include_in_schema=False)
async def get_artifact_runtime(requested_path: str = "") -> FileResponse:
    if not STATIC_DIR.exists() or not INDEX_PATH.exists():
        raise HTTPException(status_code=503, detail="Artifact runtime assets are unavailable.")

    target = resolve_runtime_path(requested_path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="Artifact runtime asset not found.")

    return FileResponse(target, headers=_file_headers(target))
