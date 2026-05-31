from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class SupportMessageField:
    label: str
    value: str


@dataclass(frozen=True)
class SupportMessagePlan:
    message: str
    fallback_text: str
    fields: tuple[SupportMessageField, ...]


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
    s3_prefix: str,
    diagnostics_included: bool,
    attachment_count: int,
    context: Mapping[str, object] | None = None,
    request_id: str | None = None,
) -> SupportMessagePlan:
    payload_context = context or {}
    fields = [
        SupportMessageField("Report ID", report_id),
        SupportMessageField("From", sender_name),
        SupportMessageField("Email", sender_email),
        SupportMessageField("S3 prefix", s3_prefix),
        SupportMessageField("Diagnostics", "included" if diagnostics_included else "not included"),
        SupportMessageField("Attachments", str(attachment_count)),
    ]

    _append_context_field(fields, "Source", payload_context.get("source"))
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
        fallback_text=f"Support report {report_id} from {sender_name}: {message[:140]}",
        fields=tuple(fields),
    )


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
