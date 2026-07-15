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


class ServerCapabilities(BaseModel):
    """Versioned, conservative declaration of what this deployment offers.

    Defaults are disabled: a capability is true only when the operator
    configured the underlying feature. The desktop treats an absent contract
    (older servers) as all-off + self-managed.
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
    # Shared with the actual provisioning gate (Settings.cloud_provisioning_configured)
    # so the advertised capability never diverges from what the server will actually
    # provision (e.g. a debug box with only E2B_API_KEY set).
    cloud_workspaces = config.cloud_provisioning_configured
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
