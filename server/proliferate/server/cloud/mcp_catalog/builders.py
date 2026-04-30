from __future__ import annotations

from proliferate.server.cloud.mcp_catalog.types import (
    CatalogSecretField,
    CatalogSettingOption,
    HeaderTemplate,
    QueryTemplate,
)


def _secret_field(
    id: str,
    label: str,
    placeholder: str,
    helper_text: str,
    get_token_instructions: str,
    prefix_hint: str | None = None,
) -> CatalogSecretField:
    return CatalogSecretField(
        id=id,
        label=label,
        placeholder=placeholder,
        helper_text=helper_text,
        get_token_instructions=get_token_instructions,
        prefix_hint=prefix_hint,
    )


def _setting_option(value: str, label: str) -> CatalogSettingOption:
    return CatalogSettingOption(value=value, label=label)


def _bearer(secret_field_id: str) -> HeaderTemplate:
    return HeaderTemplate("Authorization", f"Bearer {{secret.{secret_field_id}}}")


def _secret_query(parameter_name: str, secret_field_id: str) -> QueryTemplate:
    return QueryTemplate(parameter_name, f"{{secret.{secret_field_id}}}")
