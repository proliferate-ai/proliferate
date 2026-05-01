"""Request/response models for the desktop PKCE auth flow."""

from typing import Literal

from pydantic import BaseModel


class AuthorizeParams(BaseModel):
    """Query params the desktop app sends when opening the browser."""

    state: str
    code_challenge: str
    code_challenge_method: str = "S256"
    redirect_uri: str
    prompt: Literal["select_account"] | None = None


class TokenRequest(BaseModel):
    """POST body the desktop app sends to exchange an auth code for tokens."""

    code: str
    code_verifier: str
    grant_type: str = "authorization_code"


class PendingTokenRequest(BaseModel):
    """Polling request the desktop app sends while waiting for browser auth."""

    state: str
    code_verifier: str


class TokenUserInfo(BaseModel):
    id: str
    email: str
    display_name: str | None = None
    github_login: str | None = None
    avatar_url: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: TokenUserInfo


class AuthCodeCreated(BaseModel):
    """Returned when the server has created an auth code (internal use / testing)."""

    code: str
    redirect_uri: str
    state: str


class PendingTokenResponse(BaseModel):
    status: Literal["pending"] = "pending"


class OAuthAvailabilityResponse(BaseModel):
    enabled: bool
    client_id: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str
    grant_type: str = "refresh_token"
