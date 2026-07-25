"""Secure page acquisition and error boundaries for workflow polling."""

from __future__ import annotations

import asyncio
from enum import StrEnum

import pydantic

from proliferate.constants.workflows import (
    WORKFLOW_POLL_DEFAULT_LIMIT,
    WORKFLOW_POLL_ERROR_MAX_LENGTH,
    WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS,
)
from proliferate.db.store.cloud_workflow_triggers import DuePollTrigger
from proliferate.integrations.workflow_poll import (
    PollAuthBinding,
    PollContentEncodingError,
    PollCredentialReflectionError,
    PollEndpointMismatchError,
    PollForbiddenHeaderError,
    PollInvalidHeaderError,
    PollPageLimitError,
    PollPageSchemaError,
    PollRequestError,
    PollResponseTooLargeError,
    PollTimeoutError,
    PollTransportError,
    PollUpstreamStatusError,
    PollWorkerCapacityError,
    fetch_poll_bytes,
    safe_poll_error,
)
from proliferate.lib.infra.bounded_executor import (
    BoundedExecutor,
    BoundedExecutorCapacityError,
)
from proliferate.server.cloud import net_guard
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.domain.poll_contract import PollPage
from proliferate.utils.crypto import decrypt_text

# Parsing attacker-controlled JSON is synchronous CPU work. Keep it off the event
# loop in a dedicated pool whose admission is hard-bounded across cancellation.
_POLL_PARSE_EXECUTOR = BoundedExecutor(
    max_workers=4,
    thread_name_prefix="workflow-poll-parse",
)


def _poll_auth_binding_result(
    header: str | None, value: str | None
) -> PollAuthBinding | None | PollRequestError:
    try:
        return PollAuthBinding.create(header, value)
    except PollRequestError as caught:
        detached = safe_poll_error(caught)
        assert detached is not None
        return detached


def resolve_plaintext_poll_auth(
    header: str | None, value: str | None
) -> PollAuthBinding | None | PollRequestError:
    """Build an ephemeral request binding without propagating plaintext locals."""

    return _poll_auth_binding_result(header, value)


def resolve_stored_poll_auth(
    header: str | None, ciphertext: str | None
) -> PollAuthBinding | None | PollRequestError:
    """Resolve a stored binding without allowing crypto details to propagate."""

    if header is None and ciphertext is None:
        return None
    if not header or not ciphertext:
        return PollInvalidHeaderError("Stored poll auth binding is incomplete.")
    try:
        value = decrypt_text(ciphertext)
    except Exception:
        return PollInvalidHeaderError(
            "Stored poll auth credential could not be resolved."
        )
    return _poll_auth_binding_result(header, value)


def decrypt_poll_auth(trigger: DuePollTrigger) -> PollAuthBinding | None:
    """Decrypt and validate the exact stored binding before request construction."""

    result = resolve_stored_poll_auth(
        trigger.poll_auth_header,
        trigger.poll_auth_ciphertext,
    )
    if isinstance(result, PollRequestError):
        # Sole raise point: ``DuePollTrigger`` has a redacted repr and the result
        # carries no ciphertext/plaintext or raw crypto exception.
        raise result
    return result


class PollErrorKind(StrEnum):
    """Stable, mechanically-switchable taxonomy for a failed poll fetch.

    In-process the failure modes are distinct exception TYPES; this enum is the
    stable name a later durable layer (WF-POLL-OCC fencing) can persist and branch
    on without re-parsing a human string. ``classify_poll_error`` maps any
    poll-path exception to exactly one kind.
    """

    PRE_SEND = "pre_send"  # rejected before request bytes leave
    DNS_POLICY = "dns_policy"  # SSRF guard denial (private/rebinding/scheme/userinfo)
    TIMEOUT = "timeout"  # per-op or total wall-clock deadline exceeded
    UPSTREAM_STATUS = "upstream_status"  # a non-2xx HTTP response
    SIZE = "size"  # body exceeded the byte cap
    CONTENT_ENCODING = "content_encoding"  # a non-identity Content-Encoding
    SCHEMA = "schema"  # 2xx body that isn't a valid PollPage
    TRANSPORT = "transport"  # connect/TLS/read failure with no status


def _string_matches_any(value: str, candidates: tuple[str, ...]) -> bool:
    # The endpoint already received the credential; this is a reflection guard,
    # not a secret-verification oracle. Reject embedded candidates too: setup
    # returns sample values, so accepting ``prefix-<secret>-suffix`` would violate
    # the write-only contract. This intentionally applies to short credentials;
    # fail-closed availability is safer than a known 1-7 character leak.
    return any(candidate in value for candidate in candidates)


def _json_value_reflects_credential(value: object, candidates: tuple[str, ...]) -> bool:
    if isinstance(value, str):
        return _string_matches_any(value, candidates)
    if isinstance(value, dict):
        return any(
            _string_matches_any(str(key), candidates)
            or _json_value_reflects_credential(child, candidates)
            for key, child in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(_json_value_reflects_credential(child, candidates) for child in value)
    return False


def _page_reflects_credential(page: PollPage, auth: PollAuthBinding | None) -> bool:
    if auth is None:
        return False
    candidates = auth.reflection_candidates()
    if page.cursor is not None and _string_matches_any(page.cursor, candidates):
        return True
    for item in page.items:
        if _string_matches_any(item.id, candidates):
            return True
        if item.kind is not None and _string_matches_any(item.kind, candidates):
            return True
        if item.occurred_at is not None and _string_matches_any(item.occurred_at, candidates):
            return True
        if _json_value_reflects_credential(item.data, candidates):
            return True
    return False


def _parse_poll_page_worker(
    body: bytes,
    *,
    limit: int,
    auth: PollAuthBinding | None,
) -> PollPage | PollRequestError:
    """Parse/validate in a worker and return only a page or a safe scalar error."""

    try:
        page = PollPage.model_validate_json(body)
        if len(page.items) > limit:
            return PollPageLimitError(
                f"Poll endpoint returned {len(page.items)} items for limit={limit}."
            )
        if _page_reflects_credential(page, auth):
            return PollCredentialReflectionError(
                "Poll endpoint response reflected a credential-bearing value."
            )
        return page
    except Exception as caught:
        # Pydantic errors retain rejected input, which may be a reflected
        # credential. Only the class name crosses the worker boundary.
        return PollPageSchemaError(caught.__class__.__name__)


def _sanitize_poll_exception(
    error: Exception,
    *,
    fallback: PollErrorKind,
) -> PollRequestError:
    detached = safe_poll_error(error)
    if detached is not None:
        return detached
    if isinstance(error, pydantic.ValidationError):
        return PollPageSchemaError(error.__class__.__name__)
    if fallback is PollErrorKind.TRANSPORT:
        return PollTransportError(error.__class__.__name__)
    return PollPageSchemaError(error.__class__.__name__)


async def _fetch_poll_page_result(
    *,
    url: str,
    endpoint: net_guard.VettedEndpoint,
    auth: PollAuthBinding | None,
    cursor: str | None,
    limit: int,
) -> PollPage | PollRequestError:
    failure: PollRequestError | None = None
    try:
        async with asyncio.timeout(WORKFLOW_POLL_TOTAL_DEADLINE_SECONDS):
            try:
                body = await fetch_poll_bytes(
                    url=url,
                    endpoint=endpoint,
                    auth=auth,
                    cursor=cursor,
                    limit=limit,
                )
            except Exception as caught:
                failure = _sanitize_poll_exception(caught, fallback=PollErrorKind.TRANSPORT)
            if failure is None:
                try:
                    parsed = await _POLL_PARSE_EXECUTOR.run(
                        _parse_poll_page_worker,
                        body,
                        limit=limit,
                        auth=auth,
                    )
                except BoundedExecutorCapacityError:
                    failure = PollWorkerCapacityError(
                        "Poll response parser is at capacity."
                    )
                except Exception as caught:
                    failure = _sanitize_poll_exception(caught, fallback=PollErrorKind.SCHEMA)
                else:
                    return parsed
    except TimeoutError as caught:
        failure = PollTimeoutError(caught.__class__.__name__)
    assert failure is not None
    return failure


async def fetch_poll_page(
    *,
    url: str,
    endpoint: net_guard.VettedEndpoint,
    auth: PollAuthBinding | None,
    cursor: str | None,
    limit: int = WORKFLOW_POLL_DEFAULT_LIMIT,
) -> PollPage:
    """Fetch and parse one page within one hard absolute deadline.

    The result helper owns raw bytes, reflection candidates, and worker failures
    without raising. This outer frame raises only a fresh secret-free typed error,
    so response bytes and credential candidates are absent from traceback locals.
    """

    result = await _fetch_poll_page_result(
        url=url,
        endpoint=endpoint,
        auth=auth,
        cursor=cursor,
        limit=limit,
    )
    if isinstance(result, PollRequestError):
        raise result
    return result


def classify_poll_error(exc: Exception) -> PollErrorKind:
    """Map any poll-path exception to its stable ``PollErrorKind``.

    Ordered most-specific-first: timeout subclasses of ``httpx.HTTPError`` are
    caught before the generic transport bucket, and ``HTTPStatusError`` before the
    same. This is the single classification authority the human-message helper and
    (later) the durable fencing layer share."""

    detached = safe_poll_error(exc)
    effective = detached if detached is not None else exc
    if isinstance(
        effective,
        (PollForbiddenHeaderError, PollInvalidHeaderError, PollEndpointMismatchError),
    ):
        return PollErrorKind.PRE_SEND
    if isinstance(effective, CloudApiError):  # the SSRF guard's poll_endpoint_blocked
        return PollErrorKind.DNS_POLICY
    if isinstance(effective, PollResponseTooLargeError):
        return PollErrorKind.SIZE
    if isinstance(effective, PollContentEncodingError):
        return PollErrorKind.CONTENT_ENCODING
    if isinstance(effective, PollTimeoutError):
        return PollErrorKind.TIMEOUT
    if isinstance(effective, PollUpstreamStatusError):
        return PollErrorKind.UPSTREAM_STATUS
    if isinstance(effective, (PollTransportError, PollWorkerCapacityError)):
        return PollErrorKind.TRANSPORT
    if isinstance(
        effective,
        (
            PollCredentialReflectionError,
            PollPageLimitError,
            PollPageSchemaError,
            pydantic.ValidationError,
        ),
    ):
        return PollErrorKind.SCHEMA
    return PollErrorKind.SCHEMA


def describe_poll_error(exc: Exception) -> str:
    """Return a bounded, secret-free operator message for a poll failure.

    Never serialize an arbitrary upstream exception. In particular, Pydantic's
    validation text includes rejected input values, and an HTTP transport
    exception retains its request (including credential headers). A hostile
    endpoint can reflect a credential into an invalid response, so schema and
    transport failures expose only the stable kind/class, not ``str(exc)``.
    """

    kind = classify_poll_error(exc)
    detached = safe_poll_error(exc)
    if detached is not None:
        # Every PollRequestError is constructed from bounded safe scalar metadata;
        # none owns a request, response body, credential, or vendor exception.
        message = str(detached)
    elif kind in (PollErrorKind.SIZE, PollErrorKind.CONTENT_ENCODING, PollErrorKind.PRE_SEND):
        message = str(exc)
    elif kind is PollErrorKind.DNS_POLICY and isinstance(exc, CloudApiError):
        # The SSRF guard's structured denial (poll_endpoint_blocked) — surface its
        # message verbatim rather than the generic "not a valid page" fallback.
        message = exc.message
    elif kind is PollErrorKind.TIMEOUT:
        message = f"Poll request timed out: {exc.__class__.__name__}."
    elif kind is PollErrorKind.TRANSPORT:
        message = f"Poll request failed: {exc.__class__.__name__}."
    else:
        message = f"Poll response was not a valid page ({exc.__class__.__name__})."
    normalized = " ".join(message.split())
    if len(normalized) <= WORKFLOW_POLL_ERROR_MAX_LENGTH:
        return normalized
    return normalized[: WORKFLOW_POLL_ERROR_MAX_LENGTH - 1] + "…"
