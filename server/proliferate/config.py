from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILES = (
    ".env",
    ".env.local",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILES,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    debug: bool = False
    api_base_url: str = ""
    api_path_prefix: str = ""
    telemetry_mode: str = Field(
        default="local_dev",
        validation_alias=AliasChoices("PROLIFERATE_TELEMETRY_MODE", "TELEMETRY_MODE"),
    )
    cors_allow_origins: str = (
        "http://localhost:1420,"
        "http://127.0.0.1:1420,"
        "http://localhost:3000,"
        "http://127.0.0.1:3000,"
        "http://tauri.localhost,"
        "tauri://localhost"
    )

    # Database
    database_url: str = "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5432/proliferate"
    database_echo: bool = False

    # Auth
    jwt_secret: str = "CHANGE-ME-IN-PRODUCTION"

    # GitHub OAuth
    github_oauth_client_id: str = ""
    github_oauth_client_secret: str = ""

    # Customer.io (optional)
    customerio_site_id: str = ""
    customerio_api_key: str = ""
    customerio_app_api_key: str = ""
    customerio_from_email: str = "hello@proliferate.dev"
    frontend_base_url: str = ""
    anonymous_telemetry_endpoint: str = Field(
        default="https://app.proliferate.com/api/v1/telemetry/anonymous",
        validation_alias=AliasChoices(
            "PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT",
            "ANONYMOUS_TELEMETRY_ENDPOINT",
        ),
    )
    anonymous_telemetry_disabled: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED",
            "ANONYMOUS_TELEMETRY_DISABLED",
        ),
    )

    # Observability
    sentry_dsn: str = ""
    sentry_environment: str = "trusted-beta"
    sentry_release: str = "proliferate-server@0.1.0"
    sentry_traces_sample_rate: float = 1.0

    # Secondary LLM flows
    anthropic_api_key: str = ""
    ai_magic_session_title_model: str = "claude-haiku-4-5-20251001"

    # Cloud workspaces
    cloud_secret_key: str = "CHANGE-ME-IN-PRODUCTION-CLOUD-SECRET"
    cloud_free_sandbox_hours: float = 2000.0
    cloud_concurrent_sandbox_limit: int = 200
    cloud_billing_mode: str = "off"
    support_slack_webhook_url: str = ""
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_cloud_monthly_price_id: str = ""
    stripe_sandbox_meter_id: str = ""
    stripe_sandbox_meter_event_name: str = "proliferate_sandbox_seconds"
    stripe_sandbox_overage_price_id: str = ""
    stripe_refill_10h_price_id: str = ""
    stripe_checkout_success_url: str = ""
    stripe_checkout_cancel_url: str = ""
    stripe_customer_portal_return_url: str = ""
    sandbox_provider: str = "e2b"
    cloud_runtime_source_binary_path: str = ""
    cloud_runtime_sentry_dsn: str = ""
    cloud_runtime_sentry_environment: str = ""
    cloud_runtime_sentry_release: str = ""
    cloud_runtime_sentry_traces_sample_rate: float = 1.0
    cloud_mcp_enabled: bool = True
    automations_enabled: bool = False
    cloud_mcp_oauth_callback_base_url: str = ""
    cloud_mcp_allow_insecure_launch_urls: bool = False
    e2b_api_key: str = ""
    e2b_template_name: str = ""
    e2b_webhook_signature_secret: str = ""
    daytona_api_key: str = ""
    daytona_server_url: str = "https://app.daytona.io/api"
    daytona_target: str = "us"

    @model_validator(mode="after")
    def validate_secrets_in_production(self) -> "Settings":
        if self.telemetry_mode not in {"local_dev", "self_managed", "hosted_product"}:
            raise ValueError(
                "telemetry_mode must be one of: local_dev, self_managed, hosted_product"
            )
        if not self.debug:
            if self.jwt_secret == "CHANGE-ME-IN-PRODUCTION":
                raise ValueError("jwt_secret must be set in production (debug=False)")
            if self.cloud_secret_key == "CHANGE-ME-IN-PRODUCTION-CLOUD-SECRET":
                raise ValueError("cloud_secret_key must be set in production (debug=False)")
        return self


settings = Settings()


def get_cors_allow_origins() -> list[str]:
    return [origin.strip() for origin in settings.cors_allow_origins.split(",") if origin.strip()]
