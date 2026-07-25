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


class PollRequestError(Exception):
    """Base for secret-free poll failures safe to propagate across layers."""


class PollResponseTooLargeError(PollRequestError):
    pass


class PollContentEncodingError(PollRequestError):
    pass


class PollForbiddenHeaderError(PollRequestError):
    pass


class PollInvalidHeaderError(PollRequestError):
    pass


class PollEndpointMismatchError(PollRequestError):
    pass


class PollUpstreamStatusError(PollRequestError):
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code
        super().__init__(f"HTTP {status_code} from poll endpoint.")


class PollTimeoutError(PollRequestError):
    def __init__(self, failure_class: str) -> None:
        self.failure_class = failure_class
        super().__init__(f"Poll request timed out: {failure_class}.")


class PollTransportError(PollRequestError):
    def __init__(self, failure_class: str) -> None:
        self.failure_class = failure_class
        super().__init__(f"Poll request failed: {failure_class}.")


class PollPageSchemaError(PollRequestError):
    def __init__(self, failure_class: str) -> None:
        self.failure_class = failure_class
        super().__init__(f"Poll response was not a valid page ({failure_class}).")


class PollPageLimitError(PollRequestError):
    pass


class PollWorkerCapacityError(PollRequestError):
    pass


class PollCredentialReflectionError(PollRequestError):
    pass


def safe_poll_error(error: Exception) -> PollRequestError | None:
    """Detach a poll/http failure from vendor objects and unsafe tracebacks.

    Product code uses this integration-owned classifier instead of importing
    ``httpx`` merely to recognize its exception hierarchy.
    """

    if isinstance(error, PollUpstreamStatusError):
        return PollUpstreamStatusError(error.status_code)
    if isinstance(error, PollTimeoutError):
        return PollTimeoutError(error.failure_class)
    if isinstance(error, PollTransportError):
        return PollTransportError(error.failure_class)
    if isinstance(error, PollPageSchemaError):
        return PollPageSchemaError(error.failure_class)
    if isinstance(error, PollRequestError):
        return error.__class__(*error.args)
    if isinstance(error, (httpx.TimeoutException, TimeoutError)):
        return PollTimeoutError(error.__class__.__name__)
    if isinstance(error, httpx.HTTPStatusError):
        return PollUpstreamStatusError(error.response.status_code)
    if isinstance(error, httpx.HTTPError):
        return PollTransportError(error.__class__.__name__)
    return None


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


@dataclass(frozen=True, repr=False)
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

    def reflection_candidates(self) -> tuple[str, ...]:
        """Exact response values that would disclose this credential.

        A service may reflect the whole header value or, for the common Bearer
        grammar, only the token payload. OWS-normalized values are included
        because intermediaries frequently trim header whitespace.
        """

        candidates = [self.value]
        stripped = self.value.strip(" \t")
        if stripped and stripped != self.value:
            candidates.append(stripped)
        bearer = re.fullmatch(r"(?i:bearer)[ \t]+(.+)", stripped)
        if bearer is not None:
            payload = bearer.group(1).strip(" \t")
            if payload:
                candidates.append(payload)
        return tuple(dict.fromkeys(candidates))


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
    """Fetch one raw poll page through the exact freshly vetted endpoint.

    The secret-bearing HTTP implementation returns only bytes or a newly-created
    secret-free ``PollRequestError``. This outer frame is the sole raise point, so
    no httpx Request, response body, credential header dictionary, or raw vendor
    exception survives in the propagated traceback/exception chain.
    """

    result = await _fetch_poll_bytes_result(
        url=url,
        endpoint=endpoint,
        auth=auth,
        cursor=cursor,
        limit=limit,
    )
    if isinstance(result, PollRequestError):
        raise result
    return result


async def _fetch_poll_bytes_result(
    *,
    url: str,
    endpoint: PollVettedEndpoint,
    auth: PollAuthBinding | None,
    cursor: str | None,
    limit: int,
) -> bytes | PollRequestError:
    """Result-returning boundary around the credential-bearing HTTP frame."""

    try:
        parts = _require_matching_endpoint(url, endpoint)
        pinned_ip = ipaddress.ip_address(endpoint.pinned_ip)
    except PollEndpointMismatchError as caught:
        return PollEndpointMismatchError(str(caught))
    except ValueError:
        return PollEndpointMismatchError("The vetted socket target is not an IP literal.")
    if not 1 <= limit <= WORKFLOW_POLL_DEFAULT_LIMIT:
        return PollEndpointMismatchError("The poll page limit is outside the frozen range.")

    return await _fetch_poll_bytes_with_credential(
        parts=parts,
        pinned_ip=pinned_ip,
        endpoint=endpoint,
        auth=auth,
        cursor=cursor,
        limit=limit,
    )


async def _fetch_poll_bytes_with_credential(
    *,
    parts: SplitResult,
    pinned_ip: ipaddress.IPv4Address | ipaddress.IPv6Address,
    endpoint: PollVettedEndpoint,
    auth: PollAuthBinding | None,
    cursor: str | None,
    limit: int,
) -> bytes | PollRequestError:
    """Credential-bearing frame. No ordinary exception or traceback escapes."""

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
    try:
        async with asyncio.timeout(WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS):
            async with (
                httpx.AsyncClient(
                    timeout=timeout,
                    follow_redirects=False,
                    trust_env=False,
                ) as client,
                client.stream(
                    "GET",
                    pinned_url,
                    params=params,
                    headers=request_headers,
                    extensions=extensions,
                ) as response,
            ):
                if not response.is_success:
                    return PollUpstreamStatusError(response.status_code)
                encoding = response.headers.get("content-encoding", "").strip().lower()
                if encoding and encoding != "identity":
                    return PollContentEncodingError(
                        "Poll endpoint returned a non-identity Content-Encoding; "
                        "only identity is accepted."
                    )
                async for chunk in response.aiter_raw():
                    # Check BEFORE extension. A transport is allowed to yield one
                    # huge chunk; copying it first would transiently duplicate the
                    # attacker-controlled overshoot in the bytearray.
                    if len(chunk) > WORKFLOW_POLL_MAX_RESPONSE_BYTES - len(body):
                        return PollResponseTooLargeError(
                            "Poll response exceeded the configured raw-byte cap."
                        )
                    body.extend(chunk)
    except (httpx.TimeoutException, TimeoutError) as caught:
        return PollTimeoutError(caught.__class__.__name__)
    except Exception as caught:
        # Never serialize or retain the raw httpx exception: it may own a Request
        # carrying the credential header or a response body controlled upstream.
        return PollTransportError(caught.__class__.__name__)
    return bytes(body)
