"""OAuth callback and final-surface policy."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit

from proliferate.config import settings as app_settings
from proliferate.server.api_errors import CloudApiError

OAUTH_WEB_COMPLETION_PATH = "/plugins/connect/complete"

_CALLBACK_SURFACES = {"desktop", "web"}
_FINAL_SURFACES = {"desktop", "web"}


@dataclass(frozen=True)
class OAuthReturnTarget:
    callback_surface: str
    final_surface: str
    return_path: str | None


def _validate_frontend_base_url(frontend_base_url: str) -> None:
    base = frontend_base_url.strip().rstrip("/")
    parts = urlsplit(base)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise CloudApiError(
            "invalid_payload",
            "Frontend base URL is not configured correctly.",
            status_code=400,
        )


def _normalize_return_path(return_path: str | None) -> str | None:
    if return_path is None:
        return None
    path = return_path.strip()
    if not path:
        return None
    if path != OAUTH_WEB_COMPLETION_PATH:
        raise CloudApiError(
            "invalid_payload",
            "OAuth return path is not allowed.",
            status_code=400,
        )
    return path


def normalize_return_target(
    *,
    callback_surface: str | None,
    final_surface: str | None,
    return_path: str | None,
) -> OAuthReturnTarget:
    resolved_callback_surface = (callback_surface or "desktop").strip()
    if resolved_callback_surface not in _CALLBACK_SURFACES:
        raise CloudApiError(
            "invalid_payload",
            "Unsupported OAuth callback surface.",
            status_code=400,
        )

    resolved_final_surface = (final_surface or resolved_callback_surface).strip()
    if resolved_final_surface not in _FINAL_SURFACES:
        raise CloudApiError(
            "invalid_payload",
            "Unsupported OAuth final surface.",
            status_code=400,
        )

    normalized_return_path = _normalize_return_path(return_path)
    if resolved_callback_surface == "desktop":
        if resolved_final_surface != "desktop":
            raise CloudApiError(
                "invalid_payload",
                "Desktop callback must return to desktop.",
                status_code=400,
            )
        if normalized_return_path is not None:
            raise CloudApiError(
                "invalid_payload",
                "Desktop callback does not accept a return path.",
                status_code=400,
            )
    else:
        if not app_settings.frontend_base_url.strip():
            raise CloudApiError(
                "invalid_payload",
                "Web OAuth callback requires a frontend base URL.",
                status_code=400,
            )
        _validate_frontend_base_url(app_settings.frontend_base_url)
        if normalized_return_path != OAUTH_WEB_COMPLETION_PATH:
            raise CloudApiError(
                "invalid_payload",
                "Web OAuth callback requires the plugin completion path.",
                status_code=400,
            )

    return OAuthReturnTarget(
        callback_surface=resolved_callback_surface,
        final_surface=resolved_final_surface,
        return_path=normalized_return_path,
    )
