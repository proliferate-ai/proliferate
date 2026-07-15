"""Public version metadata, capability contract, and desktop updater redirect.

``GET /meta`` reports the versions this server pins so desktop, runtime, and
operators all converge on the version the API controls, plus a ``capabilities``
contract describing what this deployment actually offers. ``GET
/desktop/updater/latest.json`` 302-redirects to the versioned updater manifest
on the official downloads CDN.

The server carries only a version string, never the manifest itself: manifests
contain per-platform minisign signatures that are a desktop-release artifact,
and the minisign pubkey baked into the app verifies those artifacts no matter
which endpoint served the manifest. A self-hosted server can therefore choose
the desktop version but can never ship an unofficial build.

The ``capabilities`` block is the source of truth for what the desktop renders.
The desktop must not infer Cloud/billing/gateway from mere reachability: a
self-managed server declares only the capabilities its operator configured, so
the desktop shows only those. Everything here is derived from operator config;
no secret material or per-secret presence is exposed, only product capability
booleans and safe, user-facing destinations (support email, pricing/web URL).
"""

from __future__ import annotations

from fastapi import APIRouter, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from proliferate.config import Settings, settings
from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_MODE_OFF,
)
from proliferate.constants.deployment import (
    SELF_HOST_CAPABILITY_CONTRACT_VERSION,
    SUPPORT_KIND_NONE,
    SUPPORT_KIND_OPERATOR,
    SUPPORT_KIND_VENDOR,
    VENDOR_DISPLAY_NAME,
    VENDOR_PRICING_URL,
    VENDOR_SUPPORT_EMAIL,
)
from proliferate.integrations.desktop_downloads import (
    downloads_base_url as _downloads_base_url,
)
from proliferate.integrations.desktop_downloads import (
    versioned_manifest_exists as _versioned_manifest_exists,
)
from proliferate.server.version import (
    desktop_version,
    min_desktop_version,
    runtime_version,
    server_version,
    worker_version,
)

router = APIRouter()


class DeploymentIdentity(BaseModel):
    """How this control plane identifies itself.

    ``mode`` mirrors the desktop telemetry runtime modes. ``displayName`` is the
    operator's instance name; empty means "use the connected origin" so the
    desktop never mislabels a self-managed server as the vendor product.
    """

    mode: str
    displayName: str
    logoUrl: str | None


class WebAppCapability(BaseModel):
    """Whether a hosted web app exists for this deployment, and where it lives.

    Self-managed deployments have no hosted web app (users connect the signed
    desktop app), so ``available`` is false and the desktop hides web handoffs.
    """

    available: bool
    baseUrl: str | None


class SupportCapability(BaseModel):
    """Where a user of this deployment should go for support.

    ``vendor`` is the hosted product's own support; ``operator`` is a
    self-managed operator's configured destination; ``none`` means the desktop
    offers no support-email affordance for this server.
    """

    kind: str
    email: str | None
    url: str | None


class PricingCapability(BaseModel):
    """Whether a vendor pricing page is meaningful for this deployment."""

    available: bool
    url: str | None


class GitHubRepositoryAccessCapability(BaseModel):
    """Operator readiness of GitHub repository discovery/authority.

    ``disabled`` means the operator intentionally configured no GitHub App;
    ``operator_configuration_required`` means a partial App config that only
    the operator can repair (clients must not offer user authorization);
    ``ready`` means the App runtime config is complete. Independent of
    managed-Cloud execution: an App-ready/E2B-disabled deployment can browse
    and clone repositories without advertising Cloud workspaces.
    """

    status: str
    provider: str | None
    displayName: str | None


class ManagedCloudCapability(BaseModel):
    """Operator readiness of managed-Cloud workspace execution.

    Requires both E2B provisioning and ready GitHub repository authority,
    because workspace mutations enforce GitHub App authority server-side.
    ``repositoryAuthority`` names the authority provider when one is
    involved in the managed-Cloud path.
    """

    status: str
    repositoryAuthority: str | None


class ServerCapabilities(BaseModel):
    """Versioned, conservative declaration of what this deployment offers.

    Defaults are disabled: a capability is true only when the operator
    configured the underlying feature. The desktop treats an absent contract
    (older servers) as all-off + self-managed. ``cloudWorkspaces`` is a v1
    compatibility projection of ``managedCloud.status == "ready"``.
    """

    contractVersion: int
    deployment: DeploymentIdentity
    billing: bool
    usageMetering: bool
    cloudWorkspaces: bool
    agentGateway: bool
    webApp: WebAppCapability
    support: SupportCapability
    pricing: PricingCapability
    githubRepositoryAccess: GitHubRepositoryAccessCapability
    managedCloud: ManagedCloudCapability


CAPABILITY_DISABLED = "disabled"
CAPABILITY_OPERATOR_CONFIGURATION_REQUIRED = "operator_configuration_required"
CAPABILITY_READY = "ready"


def _github_repository_access(config: Settings) -> GitHubRepositoryAccessCapability:
    """Derive GitHub repository access readiness from the shared predicate.

    Exposes only the aggregate status and a safe display name (App slug or
    operator instance name) — never which specific field is missing.
    """
    if config.github_app_configured:
        status = CAPABILITY_READY
    elif config.github_app_partially_configured:
        status = CAPABILITY_OPERATOR_CONFIGURATION_REQUIRED
    else:
        status = CAPABILITY_DISABLED
    if status == CAPABILITY_DISABLED:
        return GitHubRepositoryAccessCapability(status=status, provider=None, displayName=None)
    display_name = config.github_app_slug.strip() or config.instance_name.strip() or None
    return GitHubRepositoryAccessCapability(
        status=status,
        provider="github_app",
        displayName=display_name,
    )


def _managed_cloud(
    config: Settings, repository_access: GitHubRepositoryAccessCapability
) -> ManagedCloudCapability:
    """Derive managed-Cloud readiness from E2B plus repository authority.

    E2B absent -> disabled. E2B partial, or E2B ready with incomplete GitHub
    App authority -> operator configuration required (workspace mutations
    would fail on ``require_github_cloud_repo_authority``). Ready only when
    the whole path is operable.
    """
    e2b_ready = config.cloud_provisioning_configured
    e2b_partial = config.cloud_provisioning_partially_configured
    if not e2b_ready and not e2b_partial:
        return ManagedCloudCapability(status=CAPABILITY_DISABLED, repositoryAuthority=None)
    if e2b_partial or repository_access.status != CAPABILITY_READY:
        return ManagedCloudCapability(
            status=CAPABILITY_OPERATOR_CONFIGURATION_REQUIRED,
            repositoryAuthority="github_app",
        )
    return ManagedCloudCapability(status=CAPABILITY_READY, repositoryAuthority="github_app")


def build_server_capabilities(config: Settings) -> ServerCapabilities:
    """Derive the public capability contract from operator configuration.

    Pure over ``config`` (no I/O), so it is unit-tested directly against a
    ``Settings`` instance. Exposes product capability booleans and safe,
    user-facing destinations only — never secret material or per-secret
    presence.
    """
    mode = config.telemetry_mode
    hosted = mode == "hosted_product"

    billing = config.cloud_billing_mode != BILLING_MODE_OFF
    usage_metering = config.cloud_billing_mode in {
        BILLING_MODE_OBSERVE,
        BILLING_MODE_ENFORCE,
    }
    # Repository authority and managed Cloud are independent operator
    # capabilities; `cloudWorkspaces` stays as the v1 compatibility
    # projection so older clients fail closed unless the whole managed-Cloud
    # path (E2B + GitHub App) is operable.
    github_repository_access = _github_repository_access(config)
    managed_cloud = _managed_cloud(config, github_repository_access)
    cloud_workspaces = managed_cloud.status == CAPABILITY_READY
    agent_gateway = config.agent_gateway_enabled

    web_base = config.frontend_base_url.strip()
    web_app = WebAppCapability(
        available=hosted,
        baseUrl=(web_base or None) if hosted else None,
    )

    if hosted:
        support = SupportCapability(kind=SUPPORT_KIND_VENDOR, email=VENDOR_SUPPORT_EMAIL, url=None)
        pricing = PricingCapability(available=True, url=VENDOR_PRICING_URL)
        display_name = config.instance_name.strip() or VENDOR_DISPLAY_NAME
    else:
        support_email = config.instance_support_email.strip()
        support_url = config.instance_support_url.strip()
        if support_email or support_url:
            support = SupportCapability(
                kind=SUPPORT_KIND_OPERATOR,
                email=support_email or None,
                url=support_url or None,
            )
        else:
            support = SupportCapability(kind=SUPPORT_KIND_NONE, email=None, url=None)
        pricing = PricingCapability(available=False, url=None)
        display_name = config.instance_name.strip()

    return ServerCapabilities(
        contractVersion=SELF_HOST_CAPABILITY_CONTRACT_VERSION,
        deployment=DeploymentIdentity(
            mode=mode,
            displayName=display_name,
            logoUrl=config.instance_logo_url.strip() or None,
        ),
        billing=billing,
        usageMetering=usage_metering,
        cloudWorkspaces=cloud_workspaces,
        agentGateway=agent_gateway,
        webApp=web_app,
        support=support,
        pricing=pricing,
        githubRepositoryAccess=github_repository_access,
        managedCloud=managed_cloud,
    )


class MetaResponse(BaseModel):
    serverVersion: str
    desktopVersion: str
    runtimeVersion: str
    workerVersion: str
    minDesktopVersion: str
    capabilities: ServerCapabilities


@router.get("/meta", response_model=MetaResponse)
async def meta() -> MetaResponse:
    return MetaResponse(
        serverVersion=server_version(),
        desktopVersion=desktop_version(),
        runtimeVersion=runtime_version(),
        workerVersion=worker_version(),
        minDesktopVersion=min_desktop_version(),
        capabilities=build_server_capabilities(settings),
    )


@router.get("/desktop/updater/latest.json")
async def desktop_updater_latest() -> RedirectResponse:
    base = _downloads_base_url()
    target = f"{base}/desktop/stable/{desktop_version()}/latest.json"
    if not await _versioned_manifest_exists(target):
        target = f"{base}/desktop/stable/latest.json"
    return RedirectResponse(url=target, status_code=status.HTTP_302_FOUND)
