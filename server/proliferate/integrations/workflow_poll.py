"""DB-free HTTP transport for the Workflows poll protocol.

The workflow domain owns cursors, item validation, and run creation. This
integration owns the outbound HTTP request, pinned socket target, Host/SNI,
transport-controlled headers, timeouts, and bounded raw response bytes.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import SplitResult, parse_qsl, urlsplit, urlunsplit

import httpx

from proliferate.constants.workflows import (
    WORKFLOW_POLL_AUTH_HEADER_NAME_MAX_LENGTH,
    WORKFLOW_POLL_AUTH_HEADER_VALUE_MAX_BYTES,
    WORKFLOW_POLL_DEFAULT_LIMIT,
    WORKFLOW_POLL_FORBIDDEN_HEADER_NAMES,
    WORKFLOW_POLL_FORBIDDEN_HEADER_PREFIXES,
    WORKFLOW_POLL_HTTP_TIMEOUT_SECONDS,
    WORKFLOW_POLL_MAX_RESPONSE_BYTES,
    WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS,
)


class PollVettedEndpoint(Protocol):
    @property
    def scheme(self) -> str: ...

    @property
    def host(self) -> str: ...

    @property
    def port(self) -> int | None: ...

    @property
    def pinned_ip(self) -> str: ...


class PollResponseTooLargeError(Exception):
    pass


class PollContentEncodingError(Exception):
    pass


class PollForbiddenHeaderError(Exception):
    pass


class PollInvalidHeaderError(Exception):
    pass


class PollEndpointMismatchError(Exception):
    pass


_HTTP_FIELD_NAME_RE = re.compile(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+\Z")


def is_valid_poll_header_name(name: str) -> bool:
    """Whether ``name`` is exactly one RFC 9110 field-name token."""

    return (
        bool(name)
        and len(name) <= WORKFLOW_POLL_AUTH_HEADER_NAME_MAX_LENGTH
        and _HTTP_FIELD_NAME_RE.fullmatch(name) is not None
    )


def is_valid_poll_header_value(value: str) -> bool:
    """Whether a credential value is bounded visible ASCII (plus horizontal tab)."""

    try:
        encoded = value.encode("ascii")
    except UnicodeEncodeError:
        return False
    return (
        bool(value)
        and bool(value.strip(" \t"))
        and len(encoded) <= WORKFLOW_POLL_AUTH_HEADER_VALUE_MAX_BYTES
        and all(byte == 0x09 or 0x20 <= byte <= 0x7E for byte in encoded)
    )


def is_forbidden_poll_header(name: str) -> bool:
    """Whether a caller-controlled header would alter transport authority."""

    lowered = name.strip().lower()
    return bool(lowered) and (
        lowered in WORKFLOW_POLL_FORBIDDEN_HEADER_NAMES
        or lowered.startswith(WORKFLOW_POLL_FORBIDDEN_HEADER_PREFIXES)
    )


def has_reserved_poll_query(query: str) -> bool:
    """Whether an authored base URL tries to override server cursor controls."""

    try:
        fields = parse_qsl(query, keep_blank_values=True, max_num_fields=100)
    except ValueError:
        return True
    return any(name.lower() in {"cursor", "limit"} for name, _value in fields)


@dataclass(frozen=True)
class PollAuthBinding:
    """One validated write-only credential header for a poll request."""

    header: str
    value: str

    def __post_init__(self) -> None:
        if not is_valid_poll_header_name(self.header):
            raise PollInvalidHeaderError("Poll auth header name is invalid.")
        if is_forbidden_poll_header(self.header):
            raise PollForbiddenHeaderError(
                f"Poll auth header '{self.header}' is a transport-controlled "
                "header and may not be sent."
            )
        if not is_valid_poll_header_value(self.value):
            raise PollInvalidHeaderError("Poll auth header value is invalid.")

    @classmethod
    def create(cls, header: str | None, value: str | None) -> PollAuthBinding | None:
        if header is None and value is None:
            return None
        if not header or not value:
            raise PollInvalidHeaderError("Poll auth binding is incomplete.")
        return cls(header=header, value=value)


def _authority(host: str, port: int | None) -> str:
    try:
        is_v6 = isinstance(ipaddress.ip_address(host), ipaddress.IPv6Address)
    except ValueError:
        is_v6 = False
    literal = f"[{host}]" if is_v6 else host
    return f"{literal}:{port}" if port else literal


def validate_poll_url(url: str) -> SplitResult:
    """Validate the authored wire URL without performing DNS or network I/O."""

    try:
        parts = urlsplit(url)
        username = parts.username
        password = parts.password
        host = parts.hostname
        port = parts.port
    except ValueError as exc:
        raise PollEndpointMismatchError("The poll URL is malformed.") from exc
    if parts.scheme not in ("http", "https") or not host or port == 0:
        raise PollEndpointMismatchError("The poll URL is not a valid wire endpoint.")
    if username is not None or password is not None:
        raise PollEndpointMismatchError("The poll URL must not embed credentials.")
    if parts.fragment:
        raise PollEndpointMismatchError("The poll URL must not contain a URL fragment.")
    if has_reserved_poll_query(parts.query):
        raise PollEndpointMismatchError(
            "The poll URL query must not define server-owned cursor or limit fields."
        )
    return parts


def _require_matching_endpoint(url: str, endpoint: PollVettedEndpoint) -> SplitResult:
    parts = validate_poll_url(url)
    if (
        endpoint.scheme.lower() != parts.scheme.lower()
        or endpoint.host.lower() != (parts.hostname or "").lower()
        or endpoint.port != parts.port
    ):
        raise PollEndpointMismatchError(
            "The vetted endpoint does not match the URL being fetched; refusing to dispatch."
        )
    return parts


async def fetch_poll_bytes(
    *,
    url: str,
    endpoint: PollVettedEndpoint,
    auth: PollAuthBinding | None,
    cursor: str | None,
    limit: int,
) -> bytes:
    """Fetch one raw poll page through the exact freshly vetted endpoint."""

    parts = _require_matching_endpoint(url, endpoint)
    try:
        pinned_ip = ipaddress.ip_address(endpoint.pinned_ip)
    except ValueError as exc:
        raise PollEndpointMismatchError("The vetted socket target is not an IP literal.") from exc
    if not 1 <= limit <= WORKFLOW_POLL_DEFAULT_LIMIT:
        raise PollEndpointMismatchError("The poll page limit is outside the frozen range.")
    request_headers: dict[str, str] = {"Accept-Encoding": "identity"}
    if auth is not None:
        request_headers[auth.header] = auth.value
    params: dict[str, str | int] = {"limit": limit}
    if cursor is not None:
        params["cursor"] = cursor

    pinned_url = urlunsplit(
        (
            parts.scheme,
            _authority(str(pinned_ip), parts.port),
            parts.path,
            parts.query,
            "",
        )
    )
    request_headers["Host"] = _authority(endpoint.host, parts.port)
    extensions = {"sni_hostname": endpoint.host} if parts.scheme == "https" else {}
    timeout = httpx.Timeout(
        connect=WORKFLOW_POLL_HTTP_TIMEOUT_SECONDS,
        read=WORKFLOW_POLL_HTTP_TIMEOUT_SECONDS,
        write=WORKFLOW_POLL_HTTP_TIMEOUT_SECONDS,
        pool=WORKFLOW_POLL_HTTP_TIMEOUT_SECONDS,
    )

    body = bytearray()
    async with asyncio.timeout(WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS):
        async with (
            httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client,
            client.stream(
                "GET",
                pinned_url,
                params=params,
                headers=request_headers,
                extensions=extensions,
            ) as response,
        ):
            response.raise_for_status()
            encoding = response.headers.get("content-encoding", "").strip().lower()
            if encoding and encoding != "identity":
                raise PollContentEncodingError(
                    "Poll endpoint returned a non-identity Content-Encoding; "
                    "only identity is accepted."
                )
            async for chunk in response.aiter_raw():
                body.extend(chunk)
                if len(body) > WORKFLOW_POLL_MAX_RESPONSE_BYTES:
                    raise PollResponseTooLargeError(
                        "Poll response exceeded the configured raw-byte cap."
                    )
    return bytes(body)
