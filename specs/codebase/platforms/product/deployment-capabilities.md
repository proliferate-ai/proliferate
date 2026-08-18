# Deployment capabilities

Status: current

The public `GET /meta` capability contract tells a product host what the
connected control plane actually offers. It is an operator-configuration
projection, not a reachability guess: self-managed deployments expose only
configured capabilities, while the hosted product exposes its owned identity
and destinations.

## Ownership and consumers

The server is the producer:

- [`server/proliferate/server/meta.py`](../../../../server/proliferate/server/meta.py)
  defines `ServerCapabilities`, derives it purely from `Settings`, and returns
  it under `MetaResponse.capabilities`.
- [`server/proliferate/constants/deployment.py`](../../../../server/proliferate/constants/deployment.py)
  owns `SELF_HOST_CAPABILITY_CONTRACT_VERSION`, currently `3`.

ProductClient is the main parser and host boundary:

- [`server-capability-contract.ts`](../../../../apps/packages/product-client/src/lib/domain/capabilities/server-capability-contract.ts)
  validates and normalizes the block.
- [`server-capabilities.ts`](../../../../apps/packages/product-client/src/lib/access/cloud/server-capabilities.ts)
  performs the bounded raw `GET /meta` probe.
- [`app-capabilities.ts`](../../../../apps/packages/product-client/src/lib/domain/capabilities/app-capabilities.ts)
  resolves the official-origin legacy fallback and derives app-wide flags.
- Desktop and Web consume those flags through ProductClient's host and
  `useAppCapabilities` surfaces for billing, usage, managed Cloud, repository
  access, agent gateway, Workflow delivery, web handoff, support, pricing, and
  deployment identity.

Mobile is also a current consumer. It reads the same `/meta` producer through
[`mobile-server-capabilities.ts`](../../../../apps/mobile/src/lib/access/cloud/capabilities/mobile-server-capabilities.ts),
a separate fail-closed subset parser for GitHub repository access and managed
Cloud readiness.

## Version 3 wire shape

```ts
type CapabilityStatus =
  | "disabled"
  | "operator_configuration_required"
  | "ready";

interface ServerCapabilitiesV3 {
  contractVersion: 3;
  deployment: {
    mode: "local_dev" | "self_managed" | "hosted_product";
    displayName: string;
    logoUrl: string | null;
  };
  billing: boolean;
  usageMetering: boolean;
  cloudWorkspaces: boolean;
  agentGateway: boolean;
  webApp: { available: boolean; baseUrl: string | null };
  support: {
    kind: "vendor" | "operator" | "none";
    email: string | null;
    url: string | null;
  };
  pricing: { available: boolean; url: string | null };
  githubRepositoryAccess: {
    status: CapabilityStatus;
    provider: "github_app" | null;
    displayName: string | null;
  };
  managedCloud: {
    status: CapabilityStatus;
    repositoryAuthority: "github_app" | null;
  };
  workflowManagedRuns: boolean;
}
```

`cloudWorkspaces` remains the version-1 compatibility projection and is true
only when `managedCloud.status` is `ready`. Version 2 introduced the split
`githubRepositoryAccess` and `managedCloud` objects. Version 3 added
`workflowManagedRuns`; it defaults false in clients that do not receive a
well-formed true value.

## Status derivation

GitHub repository access is:

- `ready` when the GitHub App configuration predicate is complete;
- `operator_configuration_required` when it is partially configured; and
- `disabled` when no App configuration is present.

Managed Cloud is `ready` only when E2B provisioning is complete and GitHub App
repository authority is ready. A partial E2B configuration, or configured E2B
with incomplete repository authority, is
`operator_configuration_required`. With no E2B configuration it is disabled.

Statuses expose only safe aggregates. They never reveal which secret field is
missing. A state that only an operator can repair must not cause a client to
offer a user reauthorization action.

## Compatibility and failure behavior

The producer may add unknown fields. Consumers ignore fields they do not know
and interpret known values conservatively:

- malformed or absent contract/deployment identity returns no parsed contract;
- absent or non-boolean feature flags are false;
- malformed version-2-or-later split capability objects are disabled;
- pre-version-2 contracts project both split statuses from
  `cloudWorkspaces`;
- an absent contract on a known official hosted origin receives the explicit
  ProductClient legacy-hosted fallback; other origins remain conservative and
  self-managed; and
- unsafe support, pricing, logo, or web-app URLs are discarded.

The probe returns `null` on timeout, network failure, non-success response, or
malformed JSON. Product surfaces therefore fail closed instead of inferring a
capability from server reachability.

## Why this is a named raw seam

`/meta` is needed before normal connected-client behavior is established and
also carries version compatibility and host identity. ProductClient therefore
uses one typed, bounded raw fetch and a pure parser rather than a generated SDK
resource operation. This is a named pre-SDK capability seam, not permission for
feature code to hand-parse server responses. Hosts consume the derived
capability state rather than calling `/meta` directly.

## Current proof and gap

Current local proof is independent on each side:

- [`test_meta_endpoint.py`](../../../../server/tests/unit/test_meta_endpoint.py)
  pins the response shape, stamped versions, and server derivation behavior;
- [`server-capability-contract.test.ts`](../../../../apps/packages/product-client/src/lib/domain/capabilities/server-capability-contract.test.ts)
  covers parsing, version-3 Workflow gating, safe defaults, and unsafe values;
- [`derive-app-capabilities.test.ts`](../../../../apps/packages/product-client/src/lib/domain/capabilities/derive-app-capabilities.test.ts)
  covers host fallback and app capability derivation;
- [`server-capabilities.test.ts`](../../../../apps/packages/product-client/src/lib/access/cloud/server-capabilities.test.ts)
  covers probe timeout and failure behavior; and
- [`mobile-server-capabilities.test.ts`](../../../../apps/mobile/src/lib/access/cloud/capabilities/mobile-server-capabilities.test.ts)
  covers the Mobile subset and legacy projection.

Current gap: there is no shared producer/consumer fixture or generated
agreement gate binding the Python v3 response to both TypeScript parsers. A
field, version, or compatibility change can therefore pass each local suite
while drifting across languages. Until that follow-up lands, any `/meta`
change must enumerate ProductClient and Mobile as affected consumers and run
both sides' focused tests.
