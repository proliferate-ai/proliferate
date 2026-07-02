"""JWT bearer transport and token strategy setup."""

import jwt
from fastapi_users import models
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.jwt import decode_jwt, generate_jwt
from fastapi_users.manager import BaseUserManager

from proliferate.auth.tokens import claimed_token_generation, user_token_generation
from proliferate.config import settings
from proliferate.constants.auth import JWT_LIFETIME_SECONDS

bearer_transport = BearerTransport(tokenUrl="/auth/desktop/token")


class TokenGenerationJWTStrategy(JWTStrategy[models.UP, models.ID]):
    """JWTStrategy that binds every access token to the user's token generation.

    ``write_token`` stamps the user's current ``token_generation`` into the JWT,
    and ``read_token`` rejects any token whose stamp no longer matches the user's
    current generation. Because a logout or password change increments the
    generation, previously issued access tokens stop authenticating on their
    next use (validated per request, not bounded by the token TTL).

    Tokens minted before this claim existed carry no stamp; those are treated as
    generation ``0`` so pre-existing sessions keep working until the user's
    generation is first bumped.
    """

    async def write_token(self, user: models.UP) -> str:
        data = {
            "sub": str(user.id),
            "aud": self.token_audience,
            "token_generation": user_token_generation(user),
        }
        return generate_jwt(data, self.encode_key, self.lifetime_seconds, algorithm=self.algorithm)

    async def read_token(
        self,
        token: str | None,
        user_manager: BaseUserManager[models.UP, models.ID],
    ) -> models.UP | None:
        user = await super().read_token(token, user_manager)
        if user is None or token is None:
            return None
        # Decode the token a second time to read our custom ``token_generation``
        # claim. ``super().read_token`` already verified the signature, audience,
        # and expiry and loaded the user, but fastapi-users' JWTStrategy does not
        # expose the decoded claims to subclasses, so there is no way to read the
        # claim without decoding again. (We reuse the parent's key/audience/algo,
        # so this repeats — never loosens — that verification.)
        try:
            data = decode_jwt(
                token, self.decode_key, self.token_audience, algorithms=[self.algorithm]
            )
        except jwt.PyJWTError:
            return None
        if claimed_token_generation(data) != user_token_generation(user):
            return None
        return user


def get_jwt_strategy() -> JWTStrategy:  # type: ignore[type-arg]
    return TokenGenerationJWTStrategy(
        secret=settings.jwt_secret,
        lifetime_seconds=JWT_LIFETIME_SECONDS,
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)
