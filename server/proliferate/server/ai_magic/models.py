from __future__ import annotations

from pydantic import BaseModel, Field


class GenerateSessionTitleRequest(BaseModel):
    prompt_text: str = Field(alias="promptText", min_length=1, max_length=4000)


class GenerateSessionTitleResponse(BaseModel):
    title: str = Field(min_length=1, max_length=80)
