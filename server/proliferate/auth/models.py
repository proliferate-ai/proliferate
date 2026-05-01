"""Auth request/response schemas."""

import uuid
from enum import StrEnum

from fastapi_users import schemas


class UserRole(StrEnum):
    USER = "user"
    ADMIN = "admin"


class UserRead(schemas.BaseUser[uuid.UUID]):
    display_name: str | None = None
    github_login: str | None = None
    avatar_url: str | None = None
    role: UserRole = UserRole.USER


class UserCreate(schemas.BaseUserCreate):
    display_name: str | None = None


class UserUpdate(schemas.BaseUserUpdate):
    display_name: str | None = None
