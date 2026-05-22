"""Small Slack Web API client for the cloud bot integration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from proliferate.integrations.slack.errors import SlackApiError

SLACK_API_BASE_URL = "https://slack.com/api"
SLACK_OAUTH_TOKEN_URL = f"{SLACK_API_BASE_URL}/oauth.v2.access"


@dataclass(frozen=True)
class SlackOAuthAccessResult:
    access_token: str
    bot_user_id: str
    team_id: str
    team_name: str
    scope: str


@dataclass(frozen=True)
class SlackAuthTestResult:
    team_id: str
    team_name: str
    bot_user_id: str | None


@dataclass(frozen=True)
class SlackPostMessageResult:
    channel_id: str
    message_ts: str


@dataclass(frozen=True)
class SlackChannelSummary:
    id: str
    name: str
    is_channel: bool
    is_private: bool
    is_archived: bool


async def exchange_oauth_code(
    *,
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
) -> SlackOAuthAccessResult:
    payload = await _post_form(
        SLACK_OAUTH_TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": redirect_uri,
        },
    )
    access_token = _required_string(payload, "access_token")
    bot_user_id = _required_string(payload, "bot_user_id")
    team = payload.get("team")
    if not isinstance(team, dict):
        raise SlackApiError(
            "Slack OAuth response did not include team.",
            code="slack_team_missing",
        )
    return SlackOAuthAccessResult(
        access_token=access_token,
        bot_user_id=bot_user_id,
        team_id=_required_nested_string(team, "id", code="slack_team_id_missing"),
        team_name=_required_nested_string(team, "name", code="slack_team_name_missing"),
        scope=_string_value(payload.get("scope")),
    )


async def auth_test(*, bot_token: str) -> SlackAuthTestResult:
    payload = await _post_json("/auth.test", bot_token=bot_token, json_body={})
    return SlackAuthTestResult(
        team_id=_required_string(payload, "team_id"),
        team_name=_required_string(payload, "team"),
        bot_user_id=(
            _string_or_none(payload.get("bot_id")) or _string_or_none(payload.get("user_id"))
        ),
    )


async def chat_post_message(
    *,
    bot_token: str,
    channel_id: str,
    text: str,
    blocks: list[dict[str, object]],
    thread_ts: str | None,
) -> SlackPostMessageResult:
    body: dict[str, object] = {
        "channel": channel_id,
        "text": text,
        "blocks": blocks,
        "unfurl_links": False,
        "unfurl_media": False,
    }
    if thread_ts:
        body["thread_ts"] = thread_ts
    payload = await _post_json("/chat.postMessage", bot_token=bot_token, json_body=body)
    return SlackPostMessageResult(
        channel_id=_required_string(payload, "channel"),
        message_ts=_required_string(payload, "ts"),
    )


async def list_channels(*, bot_token: str, limit: int = 200) -> list[SlackChannelSummary]:
    payload = await _get_json(
        "/conversations.list",
        bot_token=bot_token,
        params={
            "types": "public_channel,private_channel",
            "exclude_archived": "true",
            "limit": str(min(max(limit, 1), 1000)),
        },
    )
    channels = payload.get("channels")
    if not isinstance(channels, list):
        return []
    return [
        SlackChannelSummary(
            id=_string_value(item.get("id")),
            name=_string_value(item.get("name")),
            is_channel=bool(item.get("is_channel")),
            is_private=bool(item.get("is_private")),
            is_archived=bool(item.get("is_archived")),
        )
        for item in channels
        if isinstance(item, dict) and item.get("id")
    ]


async def _post_form(url: str, *, data: dict[str, str]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(url, data=data)
    return _parse_response(response)


async def _post_json(
    path: str,
    *,
    bot_token: str,
    json_body: dict[str, object],
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{SLACK_API_BASE_URL}{path}",
            headers={"Authorization": f"Bearer {bot_token}"},
            json=json_body,
        )
    return _parse_response(response)


async def _get_json(
    path: str,
    *,
    bot_token: str,
    params: dict[str, str],
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{SLACK_API_BASE_URL}{path}",
            headers={"Authorization": f"Bearer {bot_token}"},
            params=params,
        )
    return _parse_response(response)


def _parse_response(response: httpx.Response) -> dict[str, Any]:
    retry_after = _retry_after(response)
    try:
        payload = response.json()
    except ValueError as exc:
        raise SlackApiError(
            f"Slack returned non-JSON response: {response.status_code}",
            status_code=response.status_code,
            retry_after_seconds=retry_after,
        ) from exc
    if response.status_code >= 400:
        raise SlackApiError(
            f"Slack API HTTP error: {response.status_code}",
            code=_string_value(payload.get("error")) or "slack_http_error",
            status_code=response.status_code,
            retry_after_seconds=retry_after,
        )
    if not bool(payload.get("ok")):
        raise SlackApiError(
            _string_value(payload.get("error")) or "Slack API returned ok=false.",
            code=_string_value(payload.get("error")) or "slack_api_error",
            status_code=response.status_code,
            retry_after_seconds=retry_after,
        )
    return payload


def _retry_after(response: httpx.Response) -> int | None:
    value = response.headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(1, int(value))
    except ValueError:
        return None


def _required_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if isinstance(value, str) and value:
        return value
    raise SlackApiError(f"Slack response missing {key}.", code=f"{key}_missing")


def _required_nested_string(payload: dict[str, Any], key: str, *, code: str) -> str:
    value = payload.get(key)
    if isinstance(value, str) and value:
        return value
    raise SlackApiError(f"Slack response missing {key}.", code=code)


def _string_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _string_value(value: object) -> str:
    return value if isinstance(value, str) else ""
