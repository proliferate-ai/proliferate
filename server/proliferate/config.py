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
    proliferate_dev: bool = Field(default=False, validation_alias="PROLIFERATE_DEV")
    api_base_url: str = ""
    api_path_prefix: str = ""
    telemetry_mode: str = Field(
        default="local_dev",
        validation_alias=AliasChoices("PROLIFERATE_TELEMETRY_MODE", "TELEMETRY_MODE"),
    )
    # Org membership mode. When single-org mode is on, every new identity joins
    # the one instance organization instead of getting a personal default org.
    # The default is derived (hosted production stays multi-org; every other
    # deployment posture defaults to single-org); an explicit env value wins.
    single_org_mode_override: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("SINGLE_ORG_MODE", "PROLIFERATE_SINGLE_ORG_MODE"),
    )
    # First-run claim (single-org mode only). While the user table is empty the
    # API mints a setup token, persists its hash in the database, and writes the
    # plaintext to this local file so deploy tooling can print it. The file is
    # never served over HTTP; only someone with shell access can read it.
    setup_token_file: str = Field(
        default="/var/lib/proliferate/setup/setup-token",
        validation_alias=AliasChoices("PROLIFERATE_SETUP_TOKEN_FILE", "SETUP_TOKEN_FILE"),
    )
    # Instance admin floor (single-org mode only). Comma-separated emails that
    # must always hold at least the admin role in the instance organization.
    # Asserted at account creation and at every login; removing an email from
    # the list never demotes anyone. Inert in hosted mode; see
    # proliferate.server.organizations.admin_emails for the rationale.
    admin_emails: str = Field(
        default="",
        validation_alias=AliasChoices("ADMIN_EMAILS", "PROLIFERATE_ADMIN_EMAILS"),
    )
    # Self-registration domain gate (single-org mode only). When set, invited
    # emails may self-register only if their domain is listed. Comma-separated,
    # e.g. "corp.example.com". Strictly a gate, never a grant: it restricts who
    # can register but assigns no roles and admits nobody without an invitation.
    # Empty (the default) means no domain restriction. SSO just-in-time
    # provisioning is governed by SSO_ALLOWED_DOMAINS instead.
    allowed_email_domains: str = Field(
        default="",
        validation_alias=AliasChoices(
            "ALLOWED_EMAIL_DOMAINS",
            "PROLIFERATE_ALLOWED_EMAIL_DOMAINS",
        ),
    )
    cors_allow_origins: str = (
        "http://localhost:1420,"
        "http://127.0.0.1:1420,"
        "http://localhost:5174,"
        "http://127.0.0.1:5174,"
        "http://localhost:5175,"
        "http://127.0.0.1:5175,"
        "http://localhost:5176,"
        "http://127.0.0.1:5176,"
        "http://localhost:8081,"
        "http://127.0.0.1:8081,"
        "http://localhost:3000,"
        "http://127.0.0.1:3000,"
        "http://localhost:5174,"
        "http://127.0.0.1:5174,"
        "http://tauri.localhost,"
        "tauri://localhost"
    )

    # Database
    database_url: str = "postgresql+asyncpg://proliferate:localdev@127.0.0.1:5432/proliferate"
    database_echo: bool = False

    # Background jobs
    celery_broker_url: str = "amqp://guest:guest@127.0.0.1:5672//"
    celery_worker_queues: str = "periodic.default,default,notifications"
    celery_task_always_eager: bool = False
    celery_task_time_limit_seconds: int = 3600
    celery_task_soft_time_limit_seconds: int = 3300
    redbeat_redis_url: str = "redis://127.0.0.1:6379/0"
    redbeat_key_prefix: str = "redbeat:proliferate:"

    # Auth
    jwt_secret: str = "CHANGE-ME-IN-PRODUCTION"
    password_auth_enabled: bool = True
    password_auth_trusted_proxy_hosts: str = ""
    web_beta_allowed_emails: str = ""
    web_beta_allowed_domains: str = ""

    # Deployment SSO (self-hosted / single-tenant)
    sso_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("PROLIFERATE_SSO_ENABLED", "SSO_ENABLED"),
    )
    sso_protocol: str = Field(
        default="oidc",
        validation_alias=AliasChoices("PROLIFERATE_SSO_PROTOCOL", "SSO_PROTOCOL"),
    )
    sso_display_name: str = Field(
        default="Company SSO",
        validation_alias=AliasChoices("PROLIFERATE_SSO_DISPLAY_NAME", "SSO_DISPLAY_NAME"),
    )
    sso_login_policy: str = Field(
        default="optional",
        validation_alias=AliasChoices("PROLIFERATE_SSO_LOGIN_POLICY", "SSO_LOGIN_POLICY"),
    )
    sso_jit_policy: str = Field(
        default="disabled",
        validation_alias=AliasChoices("PROLIFERATE_SSO_JIT_POLICY", "SSO_JIT_POLICY"),
    )
    sso_default_role: str = Field(
        default="member",
        validation_alias=AliasChoices("PROLIFERATE_SSO_DEFAULT_ROLE", "SSO_DEFAULT_ROLE"),
    )
    sso_allowed_domains: str = Field(
        default="",
        validation_alias=AliasChoices("PROLIFERATE_SSO_ALLOWED_DOMAINS", "SSO_ALLOWED_DOMAINS"),
    )
    sso_oidc_issuer_url: str = Field(
        default="",
        validation_alias=AliasChoices("PROLIFERATE_SSO_OIDC_ISSUER_URL", "SSO_OIDC_ISSUER_URL"),
    )
    sso_oidc_discovery_url: str = Field(
        default="",
        validation_alias=AliasChoices(
            "PROLIFERATE_SSO_OIDC_DISCOVERY_URL",
            "SSO_OIDC_DISCOVERY_URL",
        ),
    )
    sso_oidc_authorization_endpoint: str = Field(
        default="",
        validation_alias=AliasChoices(
            "PROLIFERATE_SSO_OIDC_AUTHORIZATION_ENDPOINT",
            "SSO_OIDC_AUTHORIZATION_ENDPOINT",
        ),
    )
    sso_oidc_token_endpoint: str = Field(
        default="",
        validation_alias=AliasChoices(
            "PROLIFERATE_SSO_OIDC_TOKEN_ENDPOINT",
            "SSO_OIDC_TOKEN_ENDPOINT",
        ),
    )
    sso_oidc_jwks_uri: str = Field(
        default="",
        validation_alias=AliasChoices("PROLIFERATE_SSO_OIDC_JWKS_URI", "SSO_OIDC_JWKS_URI"),
    )
    sso_oidc_userinfo_endpoint: str = Field(
        default="",
        validation_alias=AliasChoices(
            "PROLIFERATE_SSO_OIDC_USERINFO_ENDPOINT",
            "SSO_OIDC_USERINFO_ENDPOINT",
        ),
    )
    sso_oidc_client_id: str = Field(
        default="",
        validation_alias=AliasChoices("PROLIFERATE_SSO_OIDC_CLIENT_ID", "SSO_OIDC_CLIENT_ID"),
    )
    sso_oidc_client_secret: str = Field(
        default="",
        validation_alias=AliasChoices(
            "PROLIFERATE_SSO_OIDC_CLIENT_SECRET",
            "SSO_OIDC_CLIENT_SECRET",
        ),
    )
    sso_oidc_scopes: str = Field(
        default="openid email profile",
        validation_alias=AliasChoices("PROLIFERATE_SSO_OIDC_SCOPES", "SSO_OIDC_SCOPES"),
    )
    sso_oidc_token_endpoint_auth_method: str = Field(
        default="client_secret_basic",
        validation_alias=AliasChoices(
            "PROLIFERATE_SSO_OIDC_TOKEN_ENDPOINT_AUTH_METHOD",
            "SSO_OIDC_TOKEN_ENDPOINT_AUTH_METHOD",
        ),
    )
    sso_oidc_callback_base_url: str = Field(
        default="",
        validation_alias=AliasChoices(
            "PROLIFERATE_SSO_OIDC_CALLBACK_BASE_URL",
            "SSO_OIDC_CALLBACK_BASE_URL",
        ),
    )
    sso_oidc_allow_private_provider_urls: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "PROLIFERATE_SSO_OIDC_ALLOW_PRIVATE_PROVIDER_URLS",
            "SSO_OIDC_ALLOW_PRIVATE_PROVIDER_URLS",
        ),
    )

    # GitHub OAuth
    github_oauth_client_id: str = ""
    github_oauth_client_secret: str = ""

    # GitHub App for managed-cloud repository authority.
    github_app_id: str = ""
    github_app_slug: str = ""
    github_app_client_id: str = ""
    github_app_client_secret: str = ""
    github_app_webhook_secret: str = ""
    github_app_callback_base_url: str = ""
    github_app_private_key: str = ""
    github_app_private_key_path: str = ""

    # Google OAuth
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    # Apple OAuth / Sign in with Apple
    apple_sign_in_enabled: bool = False
    apple_web_service_id: str = ""
    apple_ios_bundle_id: str = ""
    apple_team_id: str = ""
    apple_key_id: str = ""
    apple_private_key: str = ""
    mobile_redirect_uri: str = "proliferate://auth/callback"

    # Customer.io (optional)
    customerio_site_id: str = ""
    customerio_api_key: str = ""
    resend_api_key: str = ""
    resend_from_email: str = "hello@proliferate.dev"
    frontend_base_url: str = ""

    # Self-managed instance identity + operator support routing. Surfaced on the
    # public /meta capability contract so the desktop renders a self-hosted
    # server as itself (name/logo) and points users at the operator's own
    # support destination instead of the vendor's. All optional: an empty value
    # means "use the safe default" — for identity the desktop falls back to the
    # connected server origin, and for support it offers no vendor address.
    instance_name: str = Field(
        default="",
        validation_alias=AliasChoices("INSTANCE_NAME", "PROLIFERATE_INSTANCE_NAME"),
    )
    instance_logo_url: str = Field(
        default="",
        validation_alias=AliasChoices("INSTANCE_LOGO_URL", "PROLIFERATE_INSTANCE_LOGO_URL"),
    )
    instance_support_email: str = Field(
        default="",
        validation_alias=AliasChoices(
            "INSTANCE_SUPPORT_EMAIL", "PROLIFERATE_INSTANCE_SUPPORT_EMAIL"
        ),
    )
    instance_support_url: str = Field(
        default="",
        validation_alias=AliasChoices("INSTANCE_SUPPORT_URL", "PROLIFERATE_INSTANCE_SUPPORT_URL"),
    )

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
    sentry_release: str = ""
    sentry_traces_sample_rate: float = 1.0

    # Secondary LLM flows
    anthropic_api_key: str = ""
    ai_magic_session_title_model: str = "claude-haiku-4-5-20251001"
    ai_magic_workspace_name_model: str = "claude-haiku-4-5-20251001"

    # Cloud workspaces
    cloud_secret_key: str = "CHANGE-ME-IN-PRODUCTION-CLOUD-SECRET"
    cloud_free_sandbox_hours: float = 2000.0
    cloud_free_repo_limit: int = 2
    cloud_paid_repo_limit: int = 4
    cloud_concurrent_sandbox_limit: int = 200
    cloud_billing_mode: str = "off"
    pro_billing_enabled: bool = False
    support_slack_webhook_url: str = ""
    support_report_s3_bucket: str = ""
    support_report_s3_prefix: str = "support/reports"
    support_report_s3_region: str = ""
    support_report_upload_url_expires_seconds: int = 900
    support_report_diagnostics_max_bytes: int = 25 * 1024 * 1024
    support_report_attachment_max_bytes: int = 25 * 1024 * 1024
    support_report_total_attachment_max_bytes: int = 100 * 1024 * 1024
    support_report_internal_base_url: str = ""
    # Dedicated Bearer key for the private completed-report feed
    # (GET /internal/support/reports). Empty disables the feed (every request is
    # rejected); the route still exists so the feed is dark-deployable.
    support_feed_bearer_token: str = ""
    # When true, report completion rejects a NEW report whose client PROVIDED a
    # release value that failed canonical validation (captured at create time
    # as `client_release_provided`). Reports from old/legacy clients that never
    # sent the field complete normally and stay feedable with a visible
    # warning. Defaults off: production enablement is an explicit ops flip once
    # desktop client adoption of the canonical `<component>@<version>+<sha>`
    # release ID is confirmed (old installed desktop builds send no release).
    support_report_require_client_release: bool = False
    signups_slack_webhook_url: str = ""
    billing_positive_slack_webhook_url: str = ""
    billing_negative_slack_webhook_url: str = ""
    slack_client_id: str = ""
    slack_client_secret: str = ""
    slack_signing_secret: str = ""
    slack_oauth_redirect_url: str = ""
    slack_outbound_max_attempts: int = 5
    slack_outbound_rate_per_team_per_sec: float = 1.0
    slack_run_cascade_max_attempts: int = 3
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_cloud_monthly_price_id: str = ""
    stripe_pro_monthly_price_id: str = ""
    stripe_legacy_cloud_monthly_price_id: str = ""
    stripe_sandbox_meter_id: str = ""
    stripe_sandbox_meter_event_name: str = "proliferate_sandbox_seconds"
    stripe_sandbox_overage_price_id: str = ""
    stripe_managed_cloud_overage_price_id: str = ""
    stripe_managed_cloud_overage_meter_id: str = ""
    stripe_managed_cloud_overage_meter_event_name: str = "proliferate_managed_cloud_overage_cents"
    stripe_refill_10h_price_id: str = ""
    stripe_checkout_success_url: str = ""
    stripe_checkout_cancel_url: str = ""
    stripe_customer_portal_return_url: str = ""
    cloud_worker_base_url: str = ""
    cloud_runtime_source_binary_path: str = ""
    cloud_worker_source_binary_path: str = ""
    cloud_supervisor_source_binary_path: str = ""
    cloud_runtime_sentry_dsn: str = ""
    cloud_runtime_sentry_environment: str = ""
    cloud_runtime_sentry_release: str = ""
    cloud_runtime_sentry_traces_sample_rate: float = 1.0
    cloud_target_sentry_dsn: str = ""
    cloud_target_sentry_environment: str = ""
    cloud_target_sentry_traces_sample_rate: float = 1.0
    # Emergency, component-specific Sentry release overrides for the target
    # processes. Each must canonically name its own component
    # (`proliferate-worker@...` / `proliferate-supervisor@...`); a mismatched
    # value is refused rather than propagated. Normally EMPTY: each binary
    # stamps its own `<component>@<version>+<sha>` from its compile-time build
    # stamp. The prior shared `cloud_target_sentry_release` /
    # `PROLIFERATE_TARGET_SENTRY_RELEASE` override was removed because it could
    # not distinguish worker from supervisor events.
    cloud_worker_sentry_release: str = ""
    cloud_supervisor_sentry_release: str = ""
    cloud_jwt_signing_key_pem: str = ""
    cloud_jwt_signing_key_id: str = "local-dev"
    cloud_jwt_verification_keys_json: str = "[]"
    cloud_jwt_issuer: str = "https://api.proliferate.ai"
    cloud_jwt_audience_anyharness: str = "anyharness"
    cloud_jwt_direct_attach_ttl_seconds: int = 1200
    cloud_mcp_enabled: bool = True
    automation_cloud_executor_claim_ttl_seconds: float = 300.0
    automation_cloud_executor_heartbeat_seconds: float = 30.0
    automation_cloud_executor_concurrency: int = 4
    automation_cloud_executor_poll_seconds: float = 5.0
    automation_cloud_executor_sweep_limit: int = 100
    automation_cloud_executor_branch_prefix: str = "automation"
    automation_cloud_executor_branch_slug_chars: int = 48
    workspace_move_cleanup_max_attempts: int = 5
    workspace_move_executor_heartbeat_timeout_seconds: int = 120
    workspace_move_cleanup_reconciler_interval_seconds: int = 300
    cloud_mcp_oauth_callback_base_url: str = ""
    cloud_mcp_oauth_callback_fallback_base_url: str = "http://localhost:8000"
    cloud_mcp_slack_enabled: bool = False
    cloud_mcp_slack_client_id: str = ""
    cloud_mcp_slack_client_secret: str = ""
    cloud_mcp_slack_token_endpoint_auth_method: str = "client_secret_post"
    cloud_mcp_google_workspace_enabled: bool = False
    cloud_mcp_google_workspace_oauth_client_id: str = ""
    cloud_mcp_google_workspace_oauth_client_secret: str = ""
    # Agent LLM gateway (LiteLLM proxy)
    agent_gateway_enabled: bool = False
    agent_gateway_litellm_base_url: str = "http://127.0.0.1:14000"
    agent_gateway_litellm_public_base_url: str = ""
    agent_gateway_litellm_master_key: str = ""
    agent_gateway_litellm_timeout_seconds: float = 30.0
    agent_gateway_default_user_budget_usd: str = "5"
    agent_gateway_default_org_budget_usd: str = "0"
    agent_gateway_backfill_interval_seconds: float = 300.0
    agent_gateway_free_credit_usd: str = "5"
    agent_gateway_usage_import_interval_seconds: float = 60.0
    agent_gateway_usage_import_overlap_seconds: float = 300.0
    agent_gateway_topup_interval_seconds: float = 300.0
    agent_gateway_topup_threshold_usd: str = "2"
    agent_gateway_topup_amount_usd: str = "10"
    # Stripe price for one auto top-up charge; empty disables auto top-ups.
    agent_gateway_llm_topup_price_id: str = ""
    # Minimum org plan required to edit the org agent policy: "free" (no
    # gate) or "pro" (org needs a healthy paid cloud subscription or an
    # active unlimited-cloud entitlement). Reading is never plan-gated.
    agent_gateway_policy_min_plan: str = "pro"
    e2b_api_key: str = ""
    e2b_template_name: str = ""
    e2b_webhook_signature_secret: str = ""
    proliferate_target_installer_url: str = (
        "https://raw.githubusercontent.com/proliferate-ai/proliferate/main/"
        "install/proliferate-target-install.sh"
    )
    proliferate_target_artifact_base_url: str = ""

    @property
    def cloud_provisioning_configured(self) -> bool:
        """True when E2B is fully configured to provision cloud sandboxes.

        Requires BOTH an API key and a template name. In debug/dev the template
        name may be blank (a built-in default is used), so any API key suffices.
        """
        if not self.e2b_api_key.strip():
            return False
        if self.debug:
            return True
        return bool(self.e2b_template_name.strip())

    @property
    def cloud_provisioning_config_error(self) -> str | None:
        """Actionable reason cloud provisioning is unavailable, or None if ready.

        Names the missing requirement without echoing any secret value. Used
        both to log a startup warning and to fail cloud-provisioning requests
        with a specific error instead of crash-looping the API or booting the
        wrong E2B template.
        """
        if self.debug:
            return None
        if not self.e2b_api_key.strip():
            return None  # cloud provisioning intentionally disabled
        if not self.e2b_template_name.strip():
            return (
                "E2B_API_KEY is set but E2B_TEMPLATE_NAME is empty. Set "
                "E2B_TEMPLATE_NAME to the published runtime template for this "
                "deployment to enable cloud workspaces."
            )
        return None

    @property
    def single_org_mode(self) -> bool:
        if self.single_org_mode_override is not None:
            return self.single_org_mode_override
        return self.telemetry_mode != "hosted_product"

    @property
    def admin_email_set(self) -> frozenset[str]:
        """ADMIN_EMAILS parsed into normalized (stripped, lowercased) emails."""
        return frozenset(
            normalized
            for raw in self.admin_emails.split(",")
            if (normalized := raw.strip().lower())
        )

    @property
    def allowed_email_domain_set(self) -> frozenset[str]:
        """ALLOWED_EMAIL_DOMAINS parsed into normalized (stripped, lowercased) domains."""
        return frozenset(
            normalized
            for raw in self.allowed_email_domains.split(",")
            if (normalized := raw.strip().lower().lstrip("@"))
        )

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
