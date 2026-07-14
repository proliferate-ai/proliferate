# Deploy the Private Support Feed

> [!important] Frozen contract
> Founder-approved on 2026-07-14 and grounded in Proliferate `origin/main` at
> `66f45bfbe2839ae1382133393844ba61dce035cd` and a read-only production
> audit on 2026-07-14. Implementation is authorized only after the centralized
> access preflight is green and this contract is promoted.

- Current slice: **B1 — Deploy the private support feed — frozen**
- Parallel slice after P0: **A — Put the target tracker live, dark — frozen**
- Dependent slice: **B2 — Make production runtime evidence usable — frozen**

## Outcome

Deploy the already-built completed-support-report feed as a private,
fail-closed machine-to-machine surface in staging and production.

```text
P0-provisioned environment-specific secret
-> GitHub environment contains only that secret's ARN
-> exact server task receives SUPPORT_FEED_BEARER_TOKEN by ECS secret reference
-> no token / wrong token returns 401
-> correct token returns one bounded completed-report page
-> tracker ingestion remains disabled
```

This slice is complete only when both live environments pass the
`401 / 401 / 200` proof, the successful response contains only the approved
feed contract, and the deployment can be rolled back without weakening feed
authentication.

## Current production baseline

Observed on 2026-07-14:

- `GET https://app.proliferate.com/api/internal/support/reports` returns
  `401 support_feed_unauthorized` without a credential;
- the route and fail-closed access dependency are already deployed;
- production uses ECS task `proliferate-prod-server:113` and image
  `proliferate-server:66f45bfbe283`; and
- the server task does not yet receive the centralized support-feed
  credential.

B1 deploys and proves the existing feed. It does not redesign support report
storage, feed ordering, cursors, or tracker ingestion.

## Hard dependency: green access preflight

No slice may stop halfway to ask Pablo for an API key, sign-in, provider
scope, secret location, or permission decision. The complete centralized
preflight must be green before B1 implementation starts. Secret values never
enter this directory, Git, prompts, deployment output, process listings, or
ordinary logs.

The B1-specific closure is:

| Dependency | Canonical store/reference | Required proof before implementation |
| --- | --- | --- |
| Staging feed token | AWS Secrets Manager `proliferate/staging/support-feed`, JSON field `supportFeedToken` | record/field are nonempty without printing; value differs from production |
| Production feed token | AWS Secrets Manager `proliferate/prod/support-feed`, JSON field `supportFeedToken` | same proof |
| Deployment references | staging and production GitHub environment variable `SUPPORT_FEED_SECRET_ARN` | each resolves to its own environment's exact secret ARN |
| GitHub deployment authority | authenticated admin plus each environment's `AWS_DEPLOY_ROLE_ARN` | workflow dispatch and required environment approval are available |
| AWS operator authority | account `157466816238`, region `us-east-1` | ECS task/service, Secrets Manager, IAM, and deployment reads/writes are proven |
| ECS secret access | each environment's ECS execution role | can read only its environment's support secret and is denied the other environment's value |

The tokens are generated and installed by P0. B1 consumes them; it must not
generate a replacement, invent another store, copy a value into a GitHub
secret, or pause for credential acquisition.

B1 requires no Cloudflare, Sentry API, Grafana, E2B, or tracker-source
credential. The whole stack's access ledger must nevertheless be green before
unattended execution begins.

## Scope

B1 owns:

- adding `SUPPORT_FEED_SECRET_ARN` to the server deployment contract;
- projecting its `supportFeedToken` JSON field into the ECS server container
  as `SUPPORT_FEED_BEARER_TOKEN`;
- failing before task registration when the ARN, field, or role access is
  missing;
- preserving the existing constant-time, unset-is-unauthorized feed auth;
- proving the feed's approved private wire shape and privacy exclusions; and
- staging-then-production deployment and rollback proof.

It owns no tracker deployment, ingestion, source switch, or general agent API.

## Repository changes

Expected changed files are bounded to:

```text
proliferate/
├── .github/workflows/
│   └── _deploy-server.yml
├── server/tests/integration/
│   └── test_support_feed.py
└── specs/developing/
    ├── deploying/ci-cd.md
    └── reference/env-vars.yaml
```

These existing product seams are the authority to inspect, not permission for
unrelated churn:

```text
server/proliferate/
├── config.py
├── db/store/support_reports.py
└── server/support/feed/
    ├── access.py
    ├── api.py
    ├── models.py
    ├── service.py
    └── domain/cursor.py
```

No server domain redesign, database migration, tracker repository change, or
new endpoint belongs in this PR. A concrete test-exposed contradiction returns
for a bounded spec amendment.

## Deployment contract

The staging and production GitHub environments contain only:

```text
SUPPORT_FEED_SECRET_ARN=<that environment's exact secret ARN>
```

`.github/workflows/_deploy-server.yml` must:

1. require the variable during deploy configuration validation;
2. after AWS role assumption, verify that the ARN is a Secrets Manager record
   in the selected environment and that the `supportFeedToken` field exists,
   without printing its value;
3. render exactly one ECS secret entry on the server container:

   ```json
   {
     "name": "SUPPORT_FEED_BEARER_TOKEN",
     "valueFrom": "<environment-secret-ARN>:supportFeedToken::"
   }
   ```

4. remove any inherited plain-environment entry with that name;
5. fail before `aws ecs register-task-definition` if the reference is absent,
   inaccessible, duplicated, or present as plaintext; and
6. inspect the final rendered task JSON before registration.

The token is never resolved into a workflow shell variable. GitHub retains the
non-secret ARN only; ECS resolves the value for the server process through the
already-proven execution role.

This PR deliberately does not perform B2's release-identity cleanup in the
same workflow. B2 starts from the accepted B1 revision and edits only the
identity portion of that now-stable server deploy path.

## Feed authentication and privacy contract

The only route is:

```text
GET /api/internal/support/reports
Authorization: Bearer <environment-specific-token>
```

`Settings.support_feed_bearer_token`,
`require_support_feed_key`, `list_support_report_feed`, and
`get_support_report_feed` remain the authoritative implementation.

Auth remains fail closed:

```text
unset configured token         -> 401 support_feed_unauthorized
missing Authorization header   -> 401 support_feed_unauthorized
wrong scheme / empty token     -> 401 support_feed_unauthorized
wrong token                    -> 401 support_feed_unauthorized
correct environment token      -> 200 bounded completed-report page
cross-environment token        -> 401 support_feed_unauthorized
```

Comparison remains constant-time. There is no compatibility bypass, query
token, cookie auth, employee auth, or logging of credential material.

The private feed may return only this existing item contract:

```json
{
  "reportId": "report-id",
  "submittedAt": "timestamp",
  "completedAt": "timestamp",
  "ownerUserId": "user-id",
  "kind": "bug",
  "summary": "safe tracker summary",
  "releaseId": "component@version+sha",
  "releaseWarning": null,
  "notifyMe": false,
  "creditConsent": false,
  "creditName": null,
  "outreachOverride": null,
  "privateCaseReference": "support-report:report-id",
  "sentryEvents": [
    {"project": "anyharness", "eventId": "exact-event-id"}
  ],
  "cursor": "opaque-through-this-item"
}
```

`outreachOverride` is the one private outreach field intentionally admitted to
this private machine feed. It is never written to logs, receipts, audit
summaries, or a general agent response. D may retain it only in the tracker's
private reporter table; proving the general tracker API omits it belongs to D,
because B1 does not deploy or modify that API.

The feed must continue to exclude:

```text
raw report message
account email
diagnostics and attachment contents
S3 bucket/object keys and signed URLs
log bodies and arbitrary telemetry references
credentials
incomplete reports
```

Ordering, per-item opaque cursors, pagination limits, completed-only
selection, release warnings, exact Sentry reference filtering, and tamper
rejection remain unchanged.

## Verification

### Local and CI proof

At minimum:

```bash
cd server
DEBUG=true uv run pytest -q tests/integration/test_support_feed.py
```

> [!note] Bounded amendment (2026-07-14, implementation evidence)
> The originally prescribed `python3 scripts/check_docs.py` does not exist in
> this repository (verified during B1 implementation and confirmed by the
> independent review). Documentation changes are instead validated by parsing
> the edited `specs/developing/reference/env-vars.yaml` entries and workflow
> YAML directly. This amendment removes only the unrunnable command; the
> approved outcome is unchanged.

Focused tests prove:

- unset, missing, malformed, wrong, and correct credentials;
- constant-time comparison remains the access boundary;
- completed-only output, same-timestamp pagination, replay, cursor tampering,
  and limit bounds;
- the exact approved item keys, including `outreachOverride`;
- all forbidden private sentinels are absent from the serialized page; and
- the task-render contract rejects a missing/inaccessible secret reference,
  plaintext duplication, and a final task without exactly one ECS secret.

Run the repository's owning workflow validation and server integration suite
as the regression boundary.

### Staging proof

For the exact reviewed 40-character SHA:

1. record the current staging ECS task definition and server image;
2. verify the GitHub environment points at the staging support secret;
3. deploy the exact server revision;
4. inspect the live task definition and prove exactly one
   `SUPPORT_FEED_BEARER_TOKEN` ECS secret exists, no plaintext entry exists,
   and the image matches the exact SHA;
5. prove `/api/health` remains healthy;
6. call the feed with no token, a wrong token, the production token, and the
   staging token; require `401 / 401 / 401 / 200`;
7. inspect the successful page keys and confirm no forbidden private field is
   present; and
8. repeat one page/cursor request to prove deterministic replay.

### Production proof

Promote the same staging-tested revision; do not rebuild from a mutable branch.

Repeat the task-definition, health, `401 / 401 / 401 / 200`, response-shape,
privacy, and cursor checks using the production token as the sole successful
credential. Record only task/image coordinates, secret ARN plus version ID,
HTTP statuses, allowed field names, counts, and timestamps—never values or
private payloads.

Tracker ingestion remains disabled throughout.

## Failure and rollback behavior

- A missing/inaccessible secret ARN or JSON field fails before ECS mutation.
- A failed staging proof blocks production.
- Before either live mutation, record the previous task definition and image.
- If the new task cannot become healthy or any feed proof fails, restore the
  previous task definition and verify health plus the expected prior auth
  state.
- Wrong/no feed credentials always remain `401`; never weaken auth to keep a
  deploy moving.
- If credential exposure is suspected, stop, rotate only that environment's
  P0-owned support secret, restart the server, and prove the old value fails
  before proceeding.
- A concrete contradiction with the frozen code contract returns for a
  bounded amendment. It does not authorize architecture re-derivation.

## Acceptance criteria

- [ ] The complete centralized access preflight is green before work begins.
- [ ] The exact reviewed base and deployment revision are recorded.
- [ ] Both environment-specific support secrets and GitHub ARN variables
      already exist before implementation.
- [ ] Each ECS execution role can read only its environment's secret.
- [ ] The live task receives exactly one secret-backed
      `SUPPORT_FEED_BEARER_TOKEN` and no plaintext duplicate.
- [ ] Staging and production pass the cross-environment
      `401 / 401 / 401 / 200` proof.
- [ ] The authenticated response contains only the approved feed contract;
      `outreachOverride` is the sole private outreach field.
- [ ] Completed-only pagination, replay, and cursor tamper rejection remain
      green.
- [ ] Tracker ingestion remains disabled.
- [ ] Prior task/image coordinates and tested rollback commands are in the
      private deployment receipt.

## Non-goals

- changing the report submission/upload/completion flow;
- changing support report persistence, feed ordering, or cursor design;
- enabling Sentry, support, Grafana, or any tracker source;
- modifying the issue-tracker repository or its general agent API;
- proving general-agent privacy, which belongs to D;
- reporter notification, email, public credit, or outreach;
- B2's deployment/runtime identity cleanup or Sentry scrubbers;
- E2B template build or launch;
- a new support endpoint, database read path, or private-evidence API; or
- general IAM, deployment, Terraform, or secret-management redesign.

## Founder teach-back before freeze

Pablo should be able to explain:

1. why GitHub stores only the secret ARN while ECS resolves the JSON field;
2. why `outreachOverride` is allowed in the private machine feed but not in a
   general agent API; and
3. what rolls back if the server is healthy but the production privacy/auth
   proof fails.

## Handoff

```text
Status:              Frozen
Repository:          proliferate-ai/proliferate
Grounded base:       66f45bfbe2839ae1382133393844ba61dce035cd
Implementation base: exact reviewed descendant chosen at freeze
Authority:           this founder-approved contract until explicit promotion
Implementation:      prohibited until founder approval + green preflight
Tracker sources:     remain disabled throughout B1
Receipt consumed by: B2 and D
```
