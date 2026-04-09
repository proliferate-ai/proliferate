"""JWT bearer transport and token strategy setup."""

from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)

from proliferate.config import settings
from proliferate.constants.auth import JWT_LIFETIME_SECONDS

bearer_transport = BearerTransport(tokenUrl="/auth/desktop/token")


def get_jwt_strategy() -> JWTStrategy:  # type: ignore[type-arg]
    return JWTStrategy(
        secret=settings.jwt_secret,
        lifetime_seconds=JWT_LIFETIME_SECONDS,
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)
