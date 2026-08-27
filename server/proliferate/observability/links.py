"""The link scheme: one session id becomes the five story links.

Observability README §3 Flow 5: a reader — a person triaging or an agent
fixing — starts from a ``session_id`` and must reach every surface without
hand-assembling a URL. Encoded once, here; consumed by surfaces in their own
specs. Base identities are module constants keyed by environment, not
parameters: a caller knows a session id and nothing else.
"""

from __future__ import annotations

from typing import TypedDict
from uuid import UUID

_APP_BASE_URL = {
    "production": "https://app.proliferate.com",
    "staging": "https://staging.proliferate.com",
    "local": "http://localhost:3000",
}
_SENTRY_ORG = "proliferate"
_SENTRY_SERVER_PROJECT = "proliferate-server"
_HONEYCOMB_TEAM = "proliferate"
_HONEYCOMB_ENVIRONMENT = {"production": "production", "staging": "dogfood", "local": "dogfood"}
_HONEYCOMB_DATASET = "anyharness"
_AWS_REGION = "us-east-1"
_SERVER_LOG_GROUP = "/ecs/proliferate-server"


class SessionLinks(TypedDict):
    """The five story links, in reading order."""

    replay: str
    sentry: str
    honeycomb: str
    logs: str
    support_reports: str


def session_links(session_id: str, *, environment: str = "production") -> SessionLinks:
    """The five links for one session, from its id and nothing else.

    Raises ``ValueError`` for anything that is not a canonical UUID — the
    id lands in URLs, so the input domain is closed.
    """
    canonical = str(UUID(session_id))
    app_base = _APP_BASE_URL.get(environment, _APP_BASE_URL["production"])
    honeycomb_env = _HONEYCOMB_ENVIRONMENT.get(environment, "production")
    sentry_query = f"session_id:{canonical}"
    logs_query = f"fields @timestamp, level, message | filter session_id = '{canonical}' | sort @timestamp desc"
    support_query = (
        f"fields @timestamp, support_report_id | filter event = 'support.report.captured'"
        f" and session_id = '{canonical}' | sort @timestamp desc"
    )
    return SessionLinks(
        replay=f"{app_base}/sessions/{canonical}",
        sentry=(
            f"https://{_SENTRY_ORG}.sentry.io/issues/?project={_SENTRY_SERVER_PROJECT}"
            f"&query={sentry_query.replace(':', '%3A')}"
        ),
        honeycomb=(
            f"https://ui.honeycomb.io/{_HONEYCOMB_TEAM}/environments/{honeycomb_env}"
            f"/datasets/{_HONEYCOMB_DATASET}?query="
            + _honeycomb_query_param(canonical)
        ),
        logs=_logs_insights_url(logs_query),
        support_reports=_logs_insights_url(support_query),
    )


def _honeycomb_query_param(session_id: str) -> str:
    import json
    from urllib.parse import quote

    query = {"filters": [{"column": "proliferate.session_id", "op": "=", "value": session_id}]}
    return quote(json.dumps(query, separators=(",", ":")))


def _logs_insights_url(query: str) -> str:
    from urllib.parse import quote

    return (
        f"https://{_AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region={_AWS_REGION}"
        f"#logsV2:logs-insights$3FqueryDetail$3D{quote(quote(query))}"
        f"$26logGroups$3D{quote(quote(_SERVER_LOG_GROUP))}"
    )
