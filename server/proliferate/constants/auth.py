"""Auth-related constants."""

# PKCE
SUPPORTED_CODE_CHALLENGE_METHODS = frozenset({"S256"})

# Token lifetimes
JWT_LIFETIME_SECONDS = 60 * 60 * 24 * 7  # 7 days
REFRESH_TOKEN_LIFETIME_SECONDS = 60 * 60 * 24 * 30  # 30 days
AUTH_CODE_LIFETIME_SECONDS = 60

# Desktop auth flow
DESKTOP_REDIRECT_SCHEME = "proliferate"
DESKTOP_DEEP_LINK_LAUNCH_ENABLED = True
DESKTOP_CALLBACK_PATH = "/auth/callback"
DESKTOP_GITHUB_CSRF_COOKIE = "desktop_github_csrf"
GITHUB_OAUTH_SCOPES = ["repo", "user", "user:email"]
