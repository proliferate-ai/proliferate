from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query, Response

from proliferate.server.catalogs.models import AgentCatalogResponse
from proliferate.server.catalogs.service import read_agent_catalog

router = APIRouter(prefix="/catalogs", tags=["catalogs"])


@router.get(
    "/agents",
    response_model=AgentCatalogResponse,
    responses={
        304: {"description": "Agent catalog unchanged for the supplied ETag."},
        400: {"description": "Unsupported catalog schema version."},
    },
)
async def get_agent_catalog(
    response: Response,
    if_none_match: str | None = Header(default=None),
    schema_version: int | None = Query(default=None, alias="schemaVersion"),
) -> AgentCatalogResponse | Response:
    if schema_version not in (None, 1):
        raise HTTPException(
            status_code=400,
            detail="Unsupported agent catalog schemaVersion.",
        )

    catalog = read_agent_catalog()
    headers = {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
        "ETag": catalog.etag,
    }
    if if_none_match == catalog.etag:
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return catalog.catalog
