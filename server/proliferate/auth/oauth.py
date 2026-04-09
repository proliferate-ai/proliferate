"""OAuth provider clients."""

from httpx_oauth.clients.github import GitHubOAuth2

from proliferate.config import settings

github_oauth_client = GitHubOAuth2(
    client_id=settings.github_oauth_client_id,
    client_secret=settings.github_oauth_client_secret,
)
