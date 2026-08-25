from __future__ import annotations

from proliferate.config import Settings
from proliferate.server.meta import build_server_capabilities

# --- Capability contract (server/proliferate/server/meta.py) ------------------
#
# The capabilities block is the source of truth the desktop renders from. These
# tests exercise the pure builder against a Settings instance so the behavior is
# deterministic regardless of ambient env. Every capability-relevant field is
# reset to a known base and then overridden per test, so ambient env / .env
# values cannot leak into the assertions.

_CAPABILITY_FIELDS = {
    "deployment": ("mode", "displayName", "logoUrl"),
    "billing": None,
    "usageMetering": None,
    "cloudWorkspaces": None,
    "agentGateway": None,
    "webApp": ("available", "baseUrl"),
    "support": ("kind", "email", "url"),
    "pricing": ("available", "url"),
    "githubRepositoryAccess": ("status", "provider", "displayName"),
    "managedCloud": ("status", "repositoryAuthority"),
}


def _cfg(**overrides):  # type: ignore[no-untyped-def]
    cfg = Settings()
    # Reset every capability-relevant field to a known base, then apply
    # overrides, so ambient env (including ambient DEBUG=true, which the test
    # suite runs under) cannot leak into the assertion.
    base = {
        "telemetry_mode": "self_managed",
        "cloud_billing_mode": "off",
        "agent_gateway_enabled": False,
        "debug": False,
        "e2b_api_key": "",
        "e2b_template_name": "",
        "frontend_base_url": "",
        "instance_name": "",
        "instance_logo_url": "",
        "instance_support_email": "",
        "instance_support_url": "",
        "github_app_id": "",
        "github_app_slug": "",
        "github_app_client_id": "",
        "github_app_client_secret": "",
        "github_app_webhook_secret": "",
        "github_app_private_key": "",
        "github_app_private_key_path": "",
    }
    base.update(overrides)
    for key, value in base.items():
        setattr(cfg, key, value)
    return cfg


# Complete GitHub App runtime config: one entry per requirement group the
# Settings.github_app_configured predicate checks (the slug is required
# because installation URL construction needs it at runtime).
_APP_COMPLETE = {
    "github_app_id": "12345",
    "github_app_slug": "acme-cloud",
    "github_app_client_id": "Iv1.app-client",
    "github_app_client_secret": "app-secret",
    "github_app_webhook_secret": "hook-secret",
    "github_app_private_key": "-----BEGIN RSA PRIVATE KEY-----",
}


def test_capabilities_shape_and_version() -> None:
    caps = build_server_capabilities(_cfg())

    assert caps.contractVersion == 3
    dumped = caps.model_dump()
    assert set(dumped) == {
        "contractVersion",
        "deployment",
        "billing",
        "usageMetering",
        "cloudWorkspaces",
        "agentGateway",
        "webApp",
        "support",
        "pricing",
        "githubRepositoryAccess",
        "managedCloud",
    }
    for field, subfields in _CAPABILITY_FIELDS.items():
        if subfields is not None:
            assert set(dumped[field]) == set(subfields)


def test_capabilities_hosted_product() -> None:
    caps = build_server_capabilities(
        _cfg(
            telemetry_mode="hosted_product",
            cloud_billing_mode="enforce",
            agent_gateway_enabled=True,
            e2b_api_key="e2b-key",
            e2b_template_name="proliferate-runtime-cloud",
            frontend_base_url="https://web.proliferate.com",
            **_APP_COMPLETE,
        )
    )

    assert caps.deployment.mode == "hosted_product"
    assert caps.deployment.displayName == "Proliferate"
    assert caps.billing is True
    assert caps.usageMetering is True
    assert caps.cloudWorkspaces is True
    assert caps.githubRepositoryAccess.status == "ready"
    assert caps.githubRepositoryAccess.provider == "github_app"
    assert caps.managedCloud.status == "ready"
    assert caps.managedCloud.repositoryAuthority == "github_app"
    assert caps.agentGateway is True
    assert caps.webApp.available is True
    assert caps.webApp.baseUrl == "https://web.proliferate.com"
    assert caps.support.kind == "vendor"
    assert caps.support.email == "support@proliferate.com"
    assert caps.pricing.available is True
    assert caps.pricing.url == "https://proliferate.com/pricing"


def test_capabilities_self_managed_base_is_all_off() -> None:
    caps = build_server_capabilities(_cfg(telemetry_mode="self_managed"))

    assert caps.deployment.mode == "self_managed"
    # No instance name configured -> empty, so the desktop uses the origin.
    assert caps.deployment.displayName == ""
    assert caps.deployment.logoUrl is None
    assert caps.billing is False
    assert caps.usageMetering is False
    assert caps.cloudWorkspaces is False
    assert caps.githubRepositoryAccess.status == "disabled"
    assert caps.githubRepositoryAccess.provider is None
    assert caps.githubRepositoryAccess.displayName is None
    assert caps.managedCloud.status == "disabled"
    assert caps.managedCloud.repositoryAuthority is None
    assert caps.agentGateway is False
    assert caps.webApp.available is False
    assert caps.webApp.baseUrl is None
    assert caps.support.kind == "none"
    assert caps.support.email is None
    assert caps.pricing.available is False
    assert caps.pricing.url is None


def test_capabilities_self_managed_with_addons() -> None:
    caps = build_server_capabilities(
        _cfg(
            telemetry_mode="self_managed",
            cloud_billing_mode="observe",
            agent_gateway_enabled=True,
            e2b_api_key="e2b-key",
            e2b_template_name="company-runtime",
            instance_name="Acme Internal",
            **_APP_COMPLETE,
            instance_logo_url="https://acme.example.com/logo.svg",
            instance_support_email="it-help@acme.example.com",
        )
    )

    assert caps.deployment.mode == "self_managed"
    assert caps.deployment.displayName == "Acme Internal"
    assert caps.deployment.logoUrl == "https://acme.example.com/logo.svg"
    # Billing off but observe metering on: metering true, billing (mode != off) true.
    assert caps.billing is True
    assert caps.usageMetering is True
    assert caps.cloudWorkspaces is True
    assert caps.agentGateway is True
    # Web app is never self-hosted, even with add-ons configured.
    assert caps.webApp.available is False
    assert caps.support.kind == "operator"
    assert caps.support.email == "it-help@acme.example.com"
    assert caps.support.url is None
    # No vendor pricing on a self-managed deployment.
    assert caps.pricing.available is False


def test_capabilities_cloud_workspaces_requires_both_e2b_fields() -> None:
    # Outside debug mode, cloudWorkspaces shares Settings.cloud_provisioning_configured,
    # which requires both an API key and a template name.
    only_key = build_server_capabilities(_cfg(e2b_api_key="e2b-key"))
    only_template = build_server_capabilities(_cfg(e2b_template_name="company-runtime"))

    assert only_key.cloudWorkspaces is False
    assert only_template.cloudWorkspaces is False


def test_capabilities_cloud_workspaces_matches_provisioning_predicate_in_debug() -> None:
    # Same predicate as actual provisioning (Settings.cloud_provisioning_configured):
    # in debug mode a blank template name is fine as long as an API key is set, so
    # the advertised capability never diverges from what the server will provision.
    key_only_debug = _cfg(debug=True, e2b_api_key="e2b-key", **_APP_COMPLETE)
    no_key_debug = _cfg(debug=True, e2b_template_name="company-runtime", **_APP_COMPLETE)

    assert build_server_capabilities(key_only_debug).cloudWorkspaces is True
    assert key_only_debug.cloud_provisioning_configured is True
    assert build_server_capabilities(no_key_debug).cloudWorkspaces is False
    assert no_key_debug.cloud_provisioning_configured is False


# --- Independent GitHub repository access and managed Cloud (contract v2) ----
#
# The two operator capabilities must stay independent: repository authority
# (GitHub App completeness) and managed-Cloud execution (E2B + authority).
# Matrix over disabled/partial/ready on each axis, per the frozen PR 1
# contract (specs/codebase/platforms/product/deployment-capabilities.md).


def test_capabilities_app_ready_e2b_absent_is_repo_access_without_cloud() -> None:
    caps = build_server_capabilities(_cfg(**_APP_COMPLETE))

    assert caps.githubRepositoryAccess.status == "ready"
    assert caps.githubRepositoryAccess.provider == "github_app"
    assert caps.managedCloud.status == "disabled"
    assert caps.managedCloud.repositoryAuthority is None
    assert caps.cloudWorkspaces is False


def test_capabilities_app_partial_is_operator_configuration_required() -> None:
    partial = dict(_APP_COMPLETE)
    partial.pop("github_app_webhook_secret")
    caps = build_server_capabilities(_cfg(**partial))

    assert caps.githubRepositoryAccess.status == "operator_configuration_required"
    assert caps.githubRepositoryAccess.provider == "github_app"
    # No E2B config at all: managed Cloud stays disabled independently.
    assert caps.managedCloud.status == "disabled"
    assert caps.cloudWorkspaces is False


def test_capabilities_e2b_partial_is_operator_configuration_required() -> None:
    # Either half of the E2B pair alone is an operator error, not "disabled":
    # key-without-template used to crash-loop the API at startup, and
    # template-without-key silently looks intentional while provisioning fails.
    key_only = build_server_capabilities(_cfg(e2b_api_key="e2b-key", **_APP_COMPLETE))
    template_only = build_server_capabilities(
        _cfg(e2b_template_name="company-runtime", **_APP_COMPLETE)
    )

    for caps in (key_only, template_only):
        assert caps.githubRepositoryAccess.status == "ready"
        assert caps.managedCloud.status == "operator_configuration_required"
        assert caps.cloudWorkspaces is False


def test_capabilities_e2b_ready_app_incomplete_is_operator_state_not_ready() -> None:
    # The exact deployment shape that used to lie: E2B fully configured but
    # the GitHub App absent or partial. Workspace mutations enforce App
    # authority, so this must be operator_configuration_required, and the
    # compatibility boolean must fail closed for old clients.
    e2b = {"e2b_api_key": "e2b-key", "e2b_template_name": "company-runtime"}

    app_absent = build_server_capabilities(_cfg(**e2b))
    assert app_absent.githubRepositoryAccess.status == "disabled"
    assert app_absent.managedCloud.status == "operator_configuration_required"
    assert app_absent.cloudWorkspaces is False

    partial = dict(_APP_COMPLETE)
    partial.pop("github_app_private_key")
    app_partial = build_server_capabilities(_cfg(**e2b, **partial))
    assert app_partial.githubRepositoryAccess.status == "operator_configuration_required"
    assert app_partial.managedCloud.status == "operator_configuration_required"
    assert app_partial.cloudWorkspaces is False


def test_capabilities_private_key_path_counts_as_key_form() -> None:
    keyless = dict(_APP_COMPLETE)
    keyless.pop("github_app_private_key")
    caps = build_server_capabilities(
        _cfg(github_app_private_key_path="/etc/proliferate/app.pem", **keyless)
    )

    assert caps.githubRepositoryAccess.status == "ready"


def test_capabilities_both_disabled_independently() -> None:
    caps = build_server_capabilities(_cfg())

    assert caps.githubRepositoryAccess.status == "disabled"
    assert caps.managedCloud.status == "disabled"
    assert caps.cloudWorkspaces is False


def test_capabilities_agent_gateway_independent_of_github_app() -> None:
    caps = build_server_capabilities(_cfg(agent_gateway_enabled=True))

    assert caps.agentGateway is True
    assert caps.githubRepositoryAccess.status == "disabled"
    assert caps.managedCloud.status == "disabled"


def test_capabilities_display_name_prefers_app_slug_then_instance() -> None:
    # A ready App always has a slug (it is a readiness requirement), so the
    # instance-name and None fallbacks only apply to partial configs, which
    # still surface a display name alongside operator_configuration_required.
    ready = build_server_capabilities(_cfg(**_APP_COMPLETE))
    assert ready.githubRepositoryAccess.displayName == "acme-cloud"

    slugless = dict(_APP_COMPLETE)
    slugless.pop("github_app_slug")
    named = build_server_capabilities(_cfg(instance_name="Acme Internal", **slugless))
    assert named.githubRepositoryAccess.status == "operator_configuration_required"
    assert named.githubRepositoryAccess.displayName == "Acme Internal"

    bare = build_server_capabilities(_cfg(**slugless))
    assert bare.githubRepositoryAccess.status == "operator_configuration_required"
    assert bare.githubRepositoryAccess.displayName is None


def test_capabilities_expose_no_secret_or_field_presence() -> None:
    # The wire response may reveal only aggregate statuses and a safe display
    # name — never secret values or which specific App/E2B field is missing.
    partial = dict(_APP_COMPLETE)
    partial.pop("github_app_client_secret")
    caps = build_server_capabilities(_cfg(e2b_api_key="e2b-key", **partial))

    dumped = caps.model_dump_json()
    for secret in ("e2b-key", "app-secret", "hook-secret", "PRIVATE KEY", "Iv1.app-client"):
        assert secret not in dumped
    assert "github_app_client_secret" not in dumped
    assert "e2b_api_key" not in dumped


def test_capabilities_local_dev_is_self_managed_posture() -> None:
    caps = build_server_capabilities(_cfg(telemetry_mode="local_dev"))

    assert caps.deployment.mode == "local_dev"
    assert caps.billing is False
    assert caps.webApp.available is False
    assert caps.support.kind == "none"
    assert caps.pricing.available is False
