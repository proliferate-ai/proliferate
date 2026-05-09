from __future__ import annotations

from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord
from proliferate.server.cloud.mcp_catalog.domain.types import (
    ArgTemplate,
    CatalogConfigurationError,
    CatalogEntry,
    EnvTemplate,
)
from proliferate.server.cloud.mcp_materialization.launch_inputs import (
    secret_fields_for_record,
    settings_for_record,
)
from proliferate.server.cloud.mcp_materialization.models import (
    LocalStdioArgTemplateModel,
    LocalStdioCandidateModel,
    LocalStdioEnvTemplateModel,
    LocalStdioOAuthMetadataModel,
    local_stdio_static_arg_payload,
    local_stdio_static_env_payload,
    local_stdio_workspace_path_arg_payload,
)
from proliferate.server.cloud.mcp_materialization.results import (
    StdioMaterializationFailure,
)


def materialize_stdio_candidate(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
) -> tuple[LocalStdioCandidateModel | None, StdioMaterializationFailure | None]:
    try:
        settings = settings_for_record(record, entry)
    except CatalogConfigurationError:
        return None, StdioMaterializationFailure("invalid_settings", "invalid_settings")
    secrets = secret_fields_for_record(record, entry) if entry.auth_kind == "secret" else {}
    if secrets is None:
        return None, StdioMaterializationFailure("missing_secret", "missing_secret")
    try:
        args = [_stdio_arg_payload(template, settings, secrets) for template in entry.args]
        env = [_stdio_env_payload(template, settings, secrets) for template in entry.env]
    except CatalogConfigurationError:
        return None, StdioMaterializationFailure("invalid_settings", "invalid_settings")
    return (
        LocalStdioCandidateModel(
            connection_id=record.connection_id,
            catalog_entry_id=entry.id,
            server_name=record.server_name,
            connector_name=entry.name,
            setup_kind=entry.setup_kind,
            local_oauth=_local_oauth_metadata(entry, settings),
            command=entry.command,
            args=args,
            env=env,
        ),
        None,
    )


def _local_oauth_metadata(
    entry: CatalogEntry,
    settings: dict[str, object],
) -> LocalStdioOAuthMetadataModel | None:
    if entry.setup_kind != "local_oauth" or entry.id != "gmail":
        return None
    email = settings.get("userGoogleEmail")
    if not isinstance(email, str) or not email.strip():
        return None
    return LocalStdioOAuthMetadataModel(
        provider="google_workspace",
        user_google_email=email.strip().lower(),
        required_scope="https://www.googleapis.com/auth/gmail.readonly",
    )


def _stdio_arg_payload(
    template: ArgTemplate,
    settings: dict[str, object],
    secrets: dict[str, str],
) -> LocalStdioArgTemplateModel:
    if template.kind == "workspace_path":
        return local_stdio_workspace_path_arg_payload()
    return local_stdio_static_arg_payload(
        _resolved_stdio_source_value(
            template.kind,
            template.value,
            template.field_id,
            settings,
            secrets,
        )
    )


def _stdio_env_payload(
    template: EnvTemplate,
    settings: dict[str, object],
    secrets: dict[str, str],
) -> LocalStdioEnvTemplateModel:
    return local_stdio_static_env_payload(
        template.name,
        _resolved_stdio_source_value(
            template.kind,
            template.value,
            template.field_id,
            settings,
            secrets,
        ),
    )


def _resolved_stdio_source_value(
    kind: str,
    value: str | None,
    field_id: str | None,
    settings: dict[str, object],
    secrets: dict[str, str],
) -> str:
    if kind == "static":
        return value or ""
    if kind == "secret":
        if not field_id or field_id not in secrets:
            raise CatalogConfigurationError("Required stdio secret value was missing.")
        return secrets[field_id]
    if kind == "setting":
        if not field_id or field_id not in settings:
            raise CatalogConfigurationError("Required stdio setting value was missing.")
        setting_value = settings[field_id]
        if isinstance(setting_value, bool):
            return "true" if setting_value else "false"
        return str(setting_value)
    raise CatalogConfigurationError("Unsupported stdio launch source.")
