from __future__ import annotations

from pydantic import BaseModel


class WorkspaceLifecycleMutationResponse(BaseModel):
    ok: bool = True
