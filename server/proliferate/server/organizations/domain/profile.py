"""Pure organization profile rules."""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

from proliferate.constants.organizations import (
    ORGANIZATION_LOGO_IMAGE_MAX_BYTES,
    ORGANIZATION_LOGO_IMAGE_MIME_TYPES,
    ORGANIZATION_NAME_MAX_LENGTH,
    PUBLIC_EMAIL_DOMAINS,
)


@dataclass(frozen=True)
class OrganizationProfileIssue:
    code: str
    message: str
    status_code: int = 400


@dataclass(frozen=True)
class SanitizedLogoImage:
    logo_image: str | None
    issue: OrganizationProfileIssue | None = None


def derive_logo_domain_from_email(email: str) -> str | None:
    domain = _normalize_email(email).partition("@")[2]
    if not domain or domain in PUBLIC_EMAIL_DOMAINS:
        return None
    return domain


def default_organization_name(*, email: str, display_name: str | None) -> str:
    logo_domain = derive_logo_domain_from_email(email)
    if logo_domain:
        return _domain_display_name(logo_domain)[:ORGANIZATION_NAME_MAX_LENGTH]
    cleaned_display_name = (display_name or "").strip()
    if cleaned_display_name:
        return f"{cleaned_display_name}'s organization"[:ORGANIZATION_NAME_MAX_LENGTH]
    local_part = _normalize_email(email).partition("@")[0]
    local_name = local_part.replace(".", " ").replace("-", " ").replace("_", " ").strip()
    if local_name:
        return f"{local_name.title()}'s organization"[:ORGANIZATION_NAME_MAX_LENGTH]
    return "Personal organization"


def organization_name_issue(name: str) -> OrganizationProfileIssue | None:
    cleaned = clean_organization_name(name)
    if not cleaned:
        return OrganizationProfileIssue(
            code="invalid_organization_name",
            message="Organization name is required.",
        )
    if len(cleaned) > ORGANIZATION_NAME_MAX_LENGTH:
        return OrganizationProfileIssue(
            code="invalid_organization_name",
            message=f"Organization name cannot exceed {ORGANIZATION_NAME_MAX_LENGTH} characters.",
        )
    return None


def clean_organization_name(name: str) -> str:
    return name.strip()


def sanitize_logo_image(value: str | None) -> SanitizedLogoImage:
    if value is None:
        return SanitizedLogoImage(logo_image=None)
    image = value.strip()
    if not image:
        return SanitizedLogoImage(logo_image=None)
    header, separator, payload = image.partition(",")
    if separator != "," or not header.startswith("data:") or ";base64" not in header:
        return SanitizedLogoImage(
            logo_image=None,
            issue=OrganizationProfileIssue(
                code="invalid_organization_logo_image",
                message="Organization image must be a base64 encoded image upload.",
            ),
        )
    mime_type = header.removeprefix("data:").split(";", 1)[0].lower()
    if mime_type not in ORGANIZATION_LOGO_IMAGE_MIME_TYPES:
        return SanitizedLogoImage(
            logo_image=None,
            issue=OrganizationProfileIssue(
                code="invalid_organization_logo_image",
                message="Organization image must be PNG, JPEG, WebP, or GIF.",
            ),
        )
    try:
        raw = base64.b64decode(payload, validate=True)
    except binascii.Error:
        return SanitizedLogoImage(
            logo_image=None,
            issue=OrganizationProfileIssue(
                code="invalid_organization_logo_image",
                message="Organization image could not be read.",
            ),
        )
    if len(raw) > ORGANIZATION_LOGO_IMAGE_MAX_BYTES:
        return SanitizedLogoImage(
            logo_image=None,
            issue=OrganizationProfileIssue(
                code="organization_logo_image_too_large",
                message="Organization image must be 256 KB or smaller.",
            ),
        )
    encoded = base64.b64encode(raw).decode("ascii")
    return SanitizedLogoImage(logo_image=f"data:{mime_type};base64,{encoded}")


def _domain_display_name(domain: str) -> str:
    label = domain.split(".", 1)[0].replace("-", " ").replace("_", " ").strip()
    return label.title() if label else "Organization"


def _normalize_email(email: str) -> str:
    return email.strip().lower()
