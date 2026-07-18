from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient, Request, Response
from httpx_oauth.oauth2 import GetAccessTokenError

from proliferate.auth.oauth import google_oauth_client
from proliferate.config import settings
from tests.helpers.desktop_auth import make_pkce_pair


@pytest.mark.asyncio
async def test_web_google_token_rejection_redirects_to_provider_error(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, challenge = make_pkce_pair()
    monkeypatch.setattr(settings, "google_oauth_client_id", "google-client-id")
    monkeypatch.setattr(settings, "google_oauth_client_secret", "google-client-secret")

    async def authorization_url(
        redirect_uri: str,
        state: str | None = None,
        scope: list[str] | None = None,
        code_challenge: str | None = None,
        code_challenge_method: str | None = None,
        extras_params: dict[str, str] | None = None,
    ) -> str:
        assert redirect_uri.endswith("/auth/web/google/callback")
        assert state is not None
        assert scope == ["openid", "email", "profile"]
        assert code_challenge is None
        assert code_challenge_method is None
        assert extras_params is None
        return f"https://accounts.google.com/o/oauth2/v2/auth?state={state}"

    async def reject_access_token(code: str, redirect_uri: str) -> dict[str, object]:
        assert code == "google-code"
        assert redirect_uri.endswith("/auth/web/google/callback")
        response = Response(
            status_code=401,
            request=Request("POST", "https://oauth2.googleapis.com/token"),
        )
        raise GetAccessTokenError("Google rejected the token exchange.", response)

    monkeypatch.setattr(google_oauth_client, "get_authorization_url", authorization_url)
    monkeypatch.setattr(google_oauth_client, "get_access_token", reject_access_token)
    started = await client.post(
        "/auth/web/google/start",
        json={
            "purpose": "login",
            "clientState": "google-rejection-state",
            "codeChallenge": challenge,
            "codeChallengeMethod": "S256",
            "redirectUri": "http://localhost:5174/auth/callback",
        },
    )
    assert started.status_code == 200
    oauth_state = parse_qs(urlparse(started.json()["authorizationUrl"]).query)["state"][0]

    callback = await client.get(
        "/auth/web/google/callback",
        params={"code": "google-code", "state": oauth_state},
        follow_redirects=False,
    )

    assert callback.status_code == 302
    parsed = urlparse(callback.headers["location"])
    assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == (
        "http://localhost:5174/auth/callback"
    )
    callback_query = parse_qs(parsed.query)
    assert callback_query["error"] == ["provider_error"]
    assert callback_query["state"] == ["google-rejection-state"]

    replay = await client.get(
        "/auth/web/google/callback",
        params={"code": "google-code", "state": oauth_state},
        follow_redirects=False,
    )
    assert replay.status_code == 400
    assert replay.json()["detail"] == "Invalid or expired auth state."
