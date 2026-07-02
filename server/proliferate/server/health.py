from fastapi import APIRouter
from pydantic import BaseModel

from proliferate.server.version import server_version

router = APIRouter()


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(version=server_version())
