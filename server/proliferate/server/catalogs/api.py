from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query, Response

from proliferate.constants.agent_catalog import AGENT_CATALOG_CACHE_CONTROL
from proliferate.server.catalogs.domain.schema import agent_catalog_schema_version_is_supported
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
    if not agent_catalog_schema_version_is_supported(schema_version):
        raise HTTPException(
            status_code=400,
            detail="Unsupported agent catalog schemaVersion.",
        )

    catalog = read_agent_catalog()
    headers = {
        "Cache-Control": AGENT_CATALOG_CACHE_CONTROL,
        "ETag": catalog.etag,
    }
    if if_none_match == catalog.etag:
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return catalog.catalog
