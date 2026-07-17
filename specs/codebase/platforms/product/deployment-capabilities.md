# Deployment Capabilities

Status: target contract for the `/meta` capability surface and GitHub
repository authority statuses. Frozen delivery slice: Managed Cloud
Capability And GitHub Authority — PR 1 (founder-approved 2026-07-15, base
`59baca9813e3f3aeef57d577c852b9787c6cd554`).

Current gap: `/meta` derives `cloudWorkspaces` from E2B configuration alone
(`server/proliferate/server/meta.py`), the capability contract is v1 with no
GitHub App component, `server/deploy/preflight.sh` claims the GitHub App is
not required for Cloud workspaces while workspace mutations enforce it, and
the repo authority endpoint maps missing human repository access to a user
reauthorization action that cannot repair it.

## Outcome

The control plane independently reports whether GitHub repository
discovery/authority and managed Cloud execution are disabled,
operator-misconfigured, or ready. The per-repository authority endpoint never
recommends an action that cannot repair the state. Old clients continue to
receive the compatibility `cloudWorkspaces` boolean.

## Wire contract (v2)

Bump `SELF_HOST_CAPABILITY_CONTRACT_VERSION` from `1` to `2`
(`server/proliferate/constants/deployment.py`).

```ts
type OperatorCapabilityStatus =
  | "disabled"
  | "operator_configuration_required"
  | "ready";

type GitHubRepositoryAccessCapability = {
  status: OperatorCapabilityStatus;
  provider: "github_app" | null;
  displayName: string | null;
};

type ManagedCloudCapability = {
  status: OperatorCapabilityStatus;
  repositoryAuthority: "github_app" | null;
};

type ServerCapabilitiesV2 = {
  contractVersion: 2;
  cloudWorkspaces: boolean; // compatibility projection only
  githubRepositoryAccess: GitHubRepositoryAccessCapability;
  managedCloud: ManagedCloudCapability;
  // existing fields unchanged
};
```

Derivation:

```text
GitHub repository access
  no GitHub App runtime fields configured      -> disabled
  partial GitHub App runtime configuration     -> operator_configuration_required
  complete GitHub App runtime configuration    -> ready

Managed Cloud
  E2B absent and not partial                   -> disabled
  E2B partial
    OR E2B ready and repository access != ready -> operator_configuration_required
  E2B ready and repository access ready         -> ready
```

`cloudWorkspaces` is `true` only when `managedCloud.status === "ready"`.

The two capabilities are independent: a self-managed operator may configure
GitHub repository browsing/authority while intentionally leaving E2B/managed
Cloud disabled. Desktop repository clone can then work; managed-Cloud
workspace actions cannot.

## GitHub App completeness predicate

One Python `Settings` property owns GitHub App runtime completeness, shared
by `/meta`, tests, and preflight expectations. It covers every field required
for App JWT signing, installation/user authorization, OAuth callback
validation, token exchange, and webhook validation. Public responses expose
only the aggregate status and a safe display name — never field-level secret
presence. `server/deploy/preflight.sh` must agree with this predicate and
must not claim E2B alone enables Cloud workspaces.

## Repository authority statuses

Add to `GitHubRepoAuthorityStatus`
(`server/proliferate/server/cloud/github_app/models.py`):

```text
operator_configuration_required
```

Error mapping corrections
(`server/proliferate/server/cloud/github_app/service.py`):

```text
github_app_not_configured    -> status=operator_configuration_required, action=null
github_repo_access_required  -> status=missing_user_repo_access,        action=null
```

No action is offered that cannot repair the state: operator misconfiguration
is repaired by the operator, and missing human repository access is repaired
on GitHub, not by reauthorizing the App. Existing missing-authorization,
installation, and coverage statuses retain their repair actions. Mutations
continue to call `require_github_cloud_repo_authority` rather than trusting a
prior status response.

## Compatibility

- v1/older clients see `cloudWorkspaces=false` for operator-incomplete
  deployments and fail closed for managed Cloud.
- Version-aware client interpretation ships in the follow-on repository
  availability UX slice, not here.
- The official hosted legacy-origin fallback remains client behavior, not a
  server exception.
- Unknown future capability fields remain ignorable.

## Proof

- Server unit/contract tests cover every disabled/partial/ready E2B × App
  combination, including App-ready/E2B-disabled; no secret or
  configuration-presence leakage; safe display-name fallback; the v2 contract
  and `cloudWorkspaces` projection; both corrected authority mappings; and
  preflight/predicate agreement.
- `make cloud-client-generate` regenerates `server/openapi.json` and
  `cloud/sdk/src/generated/openapi.ts`; generated output is never
  hand-edited.
