"""UserManager — handles registration, login hooks, and user lifecycle."""

import uuid
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, UUIDIDMixin

from proliferate.config import settings
from proliferate.db.models.auth import User
from proliferate.db.store.users import get_user_db


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.jwt_secret
    verification_token_secret = settings.jwt_secret

    async def on_after_register(self, user: User, request: Request | None = None) -> None:
        # TODO: Customer.io identify call
        pass

    async def on_after_login(  # type: ignore[override]  # fastapi-users signature mismatch
        self,
        user: User,
        request: Request | None = None,
        response: None = None,
    ) -> None:
        # TODO: Customer.io track "logged_in"
        pass

    async def on_after_forgot_password(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        # TODO: send password reset email
        pass

    async def on_after_request_verify(
        self, user: User, token: str, request: Request | None = None
    ) -> None:
        # TODO: send verification email
        pass


async def get_user_manager(
    user_db: Annotated[object, Depends(get_user_db)],
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)  # type: ignore[arg-type]
