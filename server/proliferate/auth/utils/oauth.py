"""OAuth provider clients."""

from httpx_oauth.clients.github import GitHubOAuth2
from httpx_oauth.clients.google import GoogleOAuth2

from proliferate.config import settings

github_oauth_client = GitHubOAuth2(
    client_id=settings.github_oauth_client_id,
    client_secret=settings.github_oauth_client_secret,
)

google_oauth_client = GoogleOAuth2(
    client_id=settings.google_oauth_client_id,
    client_secret=settings.google_oauth_client_secret,
)
