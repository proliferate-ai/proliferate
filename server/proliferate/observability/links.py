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
    "staging": "https://staging-app.proliferate.com",
    "local": "http://localhost:3000",
}
_SENTRY_ORG = "proliferate"
_SENTRY_SERVER_PROJECT = "proliferate-server"
_HONEYCOMB_TEAM = "proliferate"
_HONEYCOMB_ENVIRONMENT = {"production": "production", "staging": "dogfood", "local": "dogfood"}
_HONEYCOMB_DATASET = "anyharness"
_AWS_REGION = "us-east-1"
# The production group name is the spec's + the Grafana artifacts';
# staging follows infra's `/ecs/proliferate-server-${environment}`
# (server/infra/main.tf). Local links read the staging group.
_SERVER_LOG_GROUP = {
    "production": "/ecs/proliferate-prod",
    "staging": "/ecs/proliferate-server-staging",
    "local": "/ecs/proliferate-server-staging",
}


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
    log_group = _SERVER_LOG_GROUP.get(environment, _SERVER_LOG_GROUP["production"])
    # The project filter rides the search query itself (slugs are legal
    # there; the ?project= URL parameter takes numeric ids only).
    sentry_query = f"project:{_SENTRY_SERVER_PROJECT} session_id:{canonical}"
    logs_query = (
        f"fields @timestamp, level, message | filter session_id = '{canonical}'"
        f" | sort @timestamp desc"
    )
    support_query = (
        f"fields @timestamp, support_report_id | filter event = 'support.report.captured'"
        f" and session_id = '{canonical}' | sort @timestamp desc"
    )
    return SessionLinks(
        replay=f"{app_base}/sessions/{canonical}",
        sentry=(f"https://{_SENTRY_ORG}.sentry.io/issues/?query=" + _url_quote(sentry_query)),
        honeycomb=(
            f"https://ui.honeycomb.io/{_HONEYCOMB_TEAM}/environments/{honeycomb_env}"
            f"/datasets/{_HONEYCOMB_DATASET}?query=" + _honeycomb_query_param(canonical)
        ),
        logs=_logs_insights_url(logs_query, log_group),
        support_reports=_logs_insights_url(support_query, log_group),
    )


def _url_quote(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")


def _honeycomb_query_param(session_id: str) -> str:
    import json
    from urllib.parse import quote

    query = {"filters": [{"column": "proliferate.session_id", "op": "=", "value": session_id}]}
    return quote(json.dumps(query, separators=(",", ":")))


def _star_encode(value: str) -> str:
    """The console's inner string encoding: non-alphanumerics as *XX hex."""
    return "".join(char if char.isalnum() else "*" + format(ord(char), "02x") for char in value)


def _logs_insights_url(query: str, log_group: str) -> str:
    """The console's deep-link serialization: a ~-object under queryDetail,
    strings *XX-encoded inside it, the whole object $25-escaped in the
    fragment. Verified against a hand-opened console link once per change
    (the acceptance gate's link half)."""
    from urllib.parse import quote

    detail = (
        "~(end~0~start~-3600~timeType~'RELATIVE~unit~'seconds"
        f"~editorString~'{_star_encode(query)}"
        f"~source~(~'{_star_encode(log_group)}))"
    )
    # The console's own escaping: the *XX inner encoding stays literal, the
    # rest of the ~-object is percent-encoded once and % becomes $25.
    fragment = quote(detail, safe="*").replace("%", "$25")
    return (
        f"https://{_AWS_REGION}.console.aws.amazon.com/cloudwatch/home?region={_AWS_REGION}"
        f"#logsV2:logs-insights$3FqueryDetail$3D{fragment}"
    )
