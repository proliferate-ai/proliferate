"""Constants for the public deployment capability contract (``GET /meta``).

The capability contract lets the desktop render the connected control plane as
what it actually is: the hosted Proliferate product, or a self-managed server
that only offers the capabilities its operator configured.

The values here describe the *hosted product itself* — the identity and vendor
destinations the desktop should show when it is connected to the official
hosted control plane. They are product identity, not operator config: a
self-managed operator's instance name, logo, and support destination come from
``settings.instance_*`` and are only surfaced for non-hosted deployments.
"""

from __future__ import annotations

# Bump when the ``capabilities`` wire shape on ``/meta`` changes. The desktop
# treats an absent contract (older servers) conservatively and may branch on
# this version to stay forward-compatible with newer contracts.
SELF_HOST_CAPABILITY_CONTRACT_VERSION = 1

# Deployment modes mirror the desktop telemetry runtime modes so the contract
# and telemetry routing speak the same vocabulary.
DEPLOYMENT_MODE_LOCAL_DEV = "local_dev"
DEPLOYMENT_MODE_SELF_MANAGED = "self_managed"
DEPLOYMENT_MODE_HOSTED_PRODUCT = "hosted_product"

# Support routing kinds returned in the contract.
SUPPORT_KIND_VENDOR = "vendor"
SUPPORT_KIND_OPERATOR = "operator"
SUPPORT_KIND_NONE = "none"

# Hosted-product identity and vendor destinations.
VENDOR_DISPLAY_NAME = "Proliferate"
VENDOR_SUPPORT_EMAIL = "support@proliferate.com"
VENDOR_PRICING_URL = "https://proliferate.com/pricing"
