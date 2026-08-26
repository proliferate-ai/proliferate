from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from urllib.parse import urlencode

# Interim intake for the customer loop (specs/engineering/
# customer-loop): a prefilled GitHub issue-form link on the Slack receipt.
# Field ids must match .github/ISSUE_TEMPLATE/support_report.yml.
SUPPORT_ISSUE_REPO = "proliferate-ai/proliferate"
SUPPORT_ISSUE_TEMPLATE = "support_report.yml"
_RECEIPT_LIST_LIMIT = 5


@dataclass(frozen=True)
class SupportMessageField:
    label: str
    value: str


@dataclass(frozen=True)
class SupportMessagePlan:
    message: str
    fallback_text: str
    fields: tuple[SupportMessageField, ...]
    title: str = "*New support message*"


def normalize_support_message(message: str) -> str | None:
    cleaned = message.strip()
    return cleaned or None


def build_support_message_plan(
    *,
    sender_name: str,
    sender_email: str,
    message: str,
    context: Mapping[str, object] | None = None,
    request_id: str | None = None,
) -> SupportMessagePlan:
    payload_context = context or {}
    fields = [
        SupportMessageField("From", sender_name),
        SupportMessageField("Email", sender_email),
    ]

    _append_context_field(fields, "Source", payload_context.get("source"))
    _append_context_field(fields, "Intent", payload_context.get("intent"))
    _append_context_field(fields, "Page", payload_context.get("pathname"))
    _append_workspace_field(
        fields,
        name=payload_context.get("workspace_name"),
        location=payload_context.get("workspace_location"),
    )
    _append_context_field(fields, "Workspace ID", payload_context.get("workspace_id"))
    _append_context_field(fields, "Request ID", request_id)

    return SupportMessagePlan(
        message=message,
        fallback_text=f"Support message from {sender_name}: {message[:140]}",
        fields=tuple(fields),
    )


def build_support_report_plan(
    *,
    sender_name: str,
    sender_email: str,
    message: str,
    report_id: str,
    internal_url: str | None,
    diagnostics_included: bool,
    attachment_count: int,
    kind: str = "bug",
    credit_consent: bool = False,
    credit_name: str | None = None,
    urgent: bool = False,
    notify_me: bool = False,
    context: Mapping[str, object] | None = None,
    correlation: Mapping[str, object] | None = None,
    request_id: str | None = None,
    client_release_id: str | None = None,
    session_ids: Sequence[str] | None = None,
    sentry_events: Sequence[Mapping[str, object]] | None = None,
    summary: str | None = None,
) -> SupportMessagePlan:
    payload_context = context or {}
    payload_correlation = correlation or {}
    fields = [
        SupportMessageField("Report ID", report_id),
        SupportMessageField("Type", "Bug" if kind == "bug" else "Feature request"),
        SupportMessageField("Urgent", "Yes" if urgent else "No"),
        SupportMessageField("Notify requested", "Yes" if notify_me else "No"),
        SupportMessageField("From", sender_name),
        SupportMessageField("Email", sender_email),
        SupportMessageField("Diagnostics", "included" if diagnostics_included else "not included"),
        SupportMessageField("Attachments", str(attachment_count)),
    ]
    if kind == "feature":
        fields.append(SupportMessageField("Credit consent", "Yes" if credit_consent else "No"))
        if credit_name:
            fields.append(SupportMessageField("Credit", credit_name))
    _append_context_field(fields, "Internal report", internal_url)

    _append_context_field(fields, "Source", payload_context.get("source"))
    _append_context_field(fields, "Page", payload_context.get("pathname"))
    _append_workspace_field(
        fields,
        name=payload_context.get("workspace_name"),
        location=payload_context.get("workspace_location"),
    )
    _append_context_field(fields, "Workspace ID", payload_context.get("workspace_id"))
    _append_context_field(fields, "Tenant", payload_correlation.get("primaryTenantId"))
    _append_context_field(fields, "User ID", payload_correlation.get("ownerUserId"))
    _append_list_field(fields, "Cloud workspaces", payload_correlation.get("cloudWorkspaceIds"))
    _append_list_field(fields, "Cloud targets", payload_correlation.get("cloudTargetIds"))
    _append_context_field(fields, "Request ID", request_id)

    # Customer-loop join keys (pointers only, never content): the receipt must
    # be one step from triage without a database query.
    sentry_pairs = _sentry_pairs(sentry_events)
    _append_context_field(fields, "Release", client_release_id)
    _append_list_field(fields, "Sessions", list(session_ids or []))
    _append_list_field(fields, "Sentry", sentry_pairs)
    fields.append(SupportMessageField("Sentry query", f"support_report_id:{report_id}"))
    fields.append(
        SupportMessageField(
            "File issue",
            build_support_issue_url(
                report_id=report_id,
                client_release_id=client_release_id,
                session_ids=session_ids,
                summary=summary,
                kind=kind,
                urgent=urgent,
            ),
        )
    )

    title = "*:rotating_light: URGENT support report*" if urgent else "*New support report*"
    fallback_prefix = "URGENT support report" if urgent else "Support report"
    return SupportMessagePlan(
        message=message,
        fallback_text=f"{fallback_prefix} {report_id} from {sender_name}: {message[:140]}",
        fields=tuple(fields),
        title=title,
    )


def build_support_issue_url(
    *,
    report_id: str,
    client_release_id: str | None = None,
    session_ids: Sequence[str] | None = None,
    summary: str | None = None,
    kind: str = "bug",
    urgent: bool = False,
) -> str:
    """Prefilled GitHub issue-form link for the customer loop's interim intake.

    Carries pointers only: ids, the release, and the already-redacted summary.
    Absent sources are omitted from the query string, never sent blank.
    """

    params: list[tuple[str, str]] = [
        ("template", SUPPORT_ISSUE_TEMPLATE),
        ("title", f"[Support]: {report_id}"),
        ("report_id", report_id),
    ]
    if client_release_id:
        params.append(("release", client_release_id))
    if session_ids:
        shown = session_ids[:_RECEIPT_LIST_LIMIT]
        params.append(("sessions", ", ".join(str(item) for item in shown)))
    params.append(("sentry_query", f"support_report_id:{report_id}"))
    if summary:
        params.append(("summary", summary))
    params.append(("kind", "feature" if kind == "feature" else "bug"))
    params.append(("urgent", "yes" if urgent else "no"))
    return f"https://github.com/{SUPPORT_ISSUE_REPO}/issues/new?{urlencode(params)}"


def _sentry_pairs(sentry_events: Sequence[Mapping[str, object]] | None) -> list[str]:
    pairs: list[str] = []
    for item in sentry_events or []:
        if not isinstance(item, Mapping):
            continue
        project = item.get("project")
        event_id = item.get("eventId")
        if project and event_id:
            pairs.append(f"{project}:{event_id}")
    return pairs


def _append_context_field(
    fields: list[SupportMessageField],
    label: str,
    value: object | None,
) -> None:
    if value:
        fields.append(SupportMessageField(label, str(value)))


def _append_workspace_field(
    fields: list[SupportMessageField],
    *,
    name: object | None,
    location: object | None,
) -> None:
    if name:
        workspace_value = str(name)
        if location:
            workspace_value = f"{location} · {workspace_value}"
        fields.append(SupportMessageField("Workspace", workspace_value))
    elif location:
        fields.append(SupportMessageField("Workspace", str(location)))


def _append_list_field(
    fields: list[SupportMessageField],
    label: str,
    value: object | None,
) -> None:
    if not isinstance(value, list) or not value:
        return
    rendered = ", ".join(str(item) for item in value[:_RECEIPT_LIST_LIMIT])
    if len(value) > _RECEIPT_LIST_LIMIT:
        rendered = f"{rendered}, +{len(value) - _RECEIPT_LIST_LIMIT} more"
    fields.append(SupportMessageField(label, rendered))
