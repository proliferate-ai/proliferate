from __future__ import annotations


def cached_static_client_matches(
    *,
    cached_resource: str | None,
    cached_client_id: str,
    cached_client_secret: str | None,
    cached_token_endpoint_auth_method: str | None,
    cached_registration_client_uri: str | None,
    cached_registration_access_token_ciphertext: str | None,
    configured_resource: str,
    configured_client_id: str,
    configured_client_secret: str | None,
    configured_token_endpoint_auth_method: str,
) -> bool:
    return (
        cached_resource == configured_resource
        and cached_client_id == configured_client_id
        and cached_client_secret == configured_client_secret
        and cached_token_endpoint_auth_method == configured_token_endpoint_auth_method
        and cached_registration_client_uri is None
        and cached_registration_access_token_ciphertext is None
    )
