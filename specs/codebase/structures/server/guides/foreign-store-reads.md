Status: proposal — not current or target law

# Foreign Store Reads

This document is a review artifact for exact base
`1471d4f7e85549c4842b3fb4e69b43600f4509ed`. It has no authority unless this
proposal is explicitly accepted, and it must not land while this proposal
status remains. A later acceptance edit may promote it to current law; that
promotion is outside this run.

## Scope and base

This proposal records only the foreign-store read APIs and store-owned value
or error types observed at the pinned base. It accompanies the proposed
amendment to the [Server Domains guide](domains.md); current `main` remains
authoritative until a later founder ruling accepts and lands both documents.

`cloud` is a consumer-area label, not a wildcard declaration for
`server/cloud/**`. Each Cloud subdomain-to-foreign-store read is declared only
by its exact importing path and symbols in a ledger row; another Cloud
subdomain, sibling row, or parent label does not cover it.

The code map is intentionally small:

```text
server/proliferate/
├── server/<consumer>/**      exact importing paths recorded below
└── db/store/**               exact imported modules and symbols recorded below
```

The pinned AST census found 55 concrete importing-file-to-store-module sites
under the active server tree. Those sites collapse to 25 consumer-surface to
store-module candidates across seven active importing surfaces, but not every
candidate is a read. The parked Automations tree contributes four imports of
store modules that still exist and three imports of store modules that do not
exist. Counting the four resolvable parked edges explains the older approximate
total of 29; it is not a count of live foreign reads. The ledger below instead
declares 20 exact read or value dependencies and fences every observed
non-read or unresolved candidate separately.

## Proposed declaration rule

**A foreign read crosses only through a declared store edge.** A domain may use
another domain's store read or store-owned value type only when the exact
consumer surface, store module, import sites, and symbols appear in the ledger
below. A new unlisted foreign read requires a reviewed amendment to this
ledger.

A declaration is specific to the listed symbols at the listed import sites.
It makes the coupling reviewable but does not permit other members of the
module and never authorizes a mutation. Foreign writes continue to call the
owning domain's public service. These declarations are documentation, not
static enforcement.

## Current read/value ledger

Each reason describes the pinned call flow. It does not prescribe a future
replacement. `read API` means a database read; `store value/error type` means
the consumer depends on a type owned by the store without necessarily calling
the database.

| ID | Consumer surface | Store module | Exact importing source path(s) | Exact declared symbol(s) | Kind | Factual purpose in the current call flow |
| --- | --- | --- | --- | --- | --- | --- |
| FR-01 | `ai_magic` | [repositories](../../../../../server/proliferate/db/store/repositories.py) | [server/ai_magic/service.py](../../../../../server/proliferate/server/ai_magic/service.py) | [get_repo_config_for_user](../../../../../server/proliferate/db/store/repositories.py) | read API | Resolve the user's repository configuration for the AI-magic request. |
| FR-02 | `billing` | [agent_gateway](../../../../../server/proliferate/db/store/agent_gateway/__init__.py) | [server/billing/usage.py](../../../../../server/proliferate/server/billing/usage.py) | [get_remaining_credit_usd](../../../../../server/proliferate/db/store/agent_gateway/__init__.py), [llm_cost_usd_in_window](../../../../../server/proliferate/db/store/agent_gateway/__init__.py), [llm_cost_usd_timeseries](../../../../../server/proliferate/db/store/agent_gateway/__init__.py) | read API | Read managed-LLM credit and usage for Billing views. |
| FR-03 | `billing` | [cloud_sandboxes](../../../../../server/proliferate/db/store/cloud_sandboxes.py) | [server/billing/authorization.py](../../../../../server/proliferate/server/billing/authorization.py), [server/billing/reconciler.py](../../../../../server/proliferate/server/billing/reconciler.py) | [CloudSandboxValue](../../../../../server/proliferate/db/store/cloud_sandboxes.py), [load_cloud_sandbox_by_id](../../../../../server/proliferate/db/store/cloud_sandboxes.py) | read API; store value/error type | Type and load a sandbox used by Billing enforcement and reconciliation. The four provider-observation mutations are excluded below. |
| FR-04 | `billing` | [organization_records](../../../../../server/proliferate/db/store/organization_records.py) | [server/billing/team_checkout/service.py](../../../../../server/proliferate/server/billing/team_checkout/service.py) | [CheckoutIntentRecord](../../../../../server/proliferate/db/store/organization_records.py), [CheckoutIntentWithOrganizationRecord](../../../../../server/proliferate/db/store/organization_records.py) | store value/error type | Use store-owned values in the current checkout flow. |
| FR-05 | `billing` | [organizations](../../../../../server/proliferate/db/store/organizations.py) | [server/billing/authorization.py](../../../../../server/proliferate/server/billing/authorization.py), [server/billing/checkout.py](../../../../../server/proliferate/server/billing/checkout.py), [server/billing/team_checkout/service.py](../../../../../server/proliferate/server/billing/team_checkout/service.py) | [get_current_membership_for_user](../../../../../server/proliferate/db/store/organizations.py), [get_organization_with_membership](../../../../../server/proliferate/db/store/organizations.py), [load_organization_by_billing_subject](../../../../../server/proliferate/db/store/organizations.py), [get_current_team_checkout_intent](../../../../../server/proliferate/db/store/organizations.py) | read API | Read payer, membership, and checkout state. No activation or intent mutation is declared. |
| FR-06 | `billing` | [users](../../../../../server/proliferate/db/store/users.py) | [server/billing/team_checkout/activation.py](../../../../../server/proliferate/server/billing/team_checkout/activation.py) | [get_user_by_id](../../../../../server/proliferate/db/store/users.py) | read API | Load the invited user needed by the current activation flow. |
| FR-07 | `cloud` | [automation_environment_references](../../../../../server/proliferate/db/store/automation_environment_references.py) | [server/cloud/repositories/service.py](../../../../../server/proliferate/server/cloud/repositories/service.py) | [repo_environment_has_automation_references](../../../../../server/proliferate/db/store/automation_environment_references.py) | read API | Prevent removal of a repository environment with retained automation rows. |
| FR-08 | `cloud` | [billing](../../../../../server/proliferate/db/store/billing.py) | [server/cloud/agent_gateway/service.py](../../../../../server/proliferate/server/cloud/agent_gateway/service.py), [server/cloud/agent_gateway/usage_import.py](../../../../../server/proliferate/server/cloud/agent_gateway/usage_import.py) | [list_entitlements](../../../../../server/proliferate/db/store/billing.py), [list_budget_limits](../../../../../server/proliferate/db/store/billing.py) | read API | Read Billing entitlement and limit state for gateway behavior. |
| FR-09 | `cloud` | [billing_runtime_usage](../../../../../server/proliferate/db/store/billing_runtime_usage.py) | [server/cloud/materialization/failures.py](../../../../../server/proliferate/server/cloud/materialization/failures.py), [server/cloud/materialization/sandbox_io/connect.py](../../../../../server/proliferate/server/cloud/materialization/sandbox_io/connect.py) | [UsageProviderBindingMismatchError](../../../../../server/proliferate/db/store/billing_runtime_usage.py) | store value/error type | Use the store-owned typed mismatch result; this is a type dependency, not a database call. |
| FR-10 | `cloud` | [billing_subjects](../../../../../server/proliferate/db/store/billing_subjects.py) | [server/cloud/agent_gateway/topups.py](../../../../../server/proliferate/server/cloud/agent_gateway/topups.py), [server/cloud/agent_gateway/usage_import.py](../../../../../server/proliferate/server/cloud/agent_gateway/usage_import.py) | [get_billing_subject_by_id](../../../../../server/proliferate/db/store/billing_subjects.py) | read API | Read the payer subject. No ensure or move mutation is declared. |
| FR-11 | `cloud` | [billing_subscriptions](../../../../../server/proliferate/db/store/billing_subscriptions.py) | [server/cloud/agent_gateway/service.py](../../../../../server/proliferate/server/cloud/agent_gateway/service.py) | [list_subscriptions](../../../../../server/proliferate/db/store/billing_subscriptions.py) | read API | Read active subscription state for gateway eligibility. |
| FR-12 | `cloud` | [instance_organizations](../../../../../server/proliferate/db/store/instance_organizations.py) | [server/cloud/runtime_workers/service.py](../../../../../server/proliferate/server/cloud/runtime_workers/service.py) | [get_instance_organization](../../../../../server/proliferate/db/store/instance_organizations.py) | read API | Resolve the instance organization for worker enrollment. |
| FR-13 | `cloud` | [organization_records](../../../../../server/proliferate/db/store/organization_records.py) | [server/cloud/secrets/service.py](../../../../../server/proliferate/server/cloud/secrets/service.py) | [MembershipRecord](../../../../../server/proliferate/db/store/organization_records.py) | store value/error type | Use the store-owned membership value; this is a type dependency. |
| FR-14 | `cloud` | [organizations](../../../../../server/proliferate/db/store/organizations.py) | [server/cloud/agent_gateway/budget.py](../../../../../server/proliferate/server/cloud/agent_gateway/budget.py), [server/cloud/agent_gateway/enrollment.py](../../../../../server/proliferate/server/cloud/agent_gateway/enrollment.py), [server/cloud/agent_gateway/free_credits.py](../../../../../server/proliferate/server/cloud/agent_gateway/free_credits.py), [server/cloud/agent_gateway/migration.py](../../../../../server/proliferate/server/cloud/agent_gateway/migration.py), [server/cloud/agent_gateway/service.py](../../../../../server/proliferate/server/cloud/agent_gateway/service.py), [server/cloud/agent_run_config/service.py](../../../../../server/proliferate/server/cloud/agent_run_config/service.py), [server/cloud/integration_gateway/dependencies.py](../../../../../server/proliferate/server/cloud/integration_gateway/dependencies.py), [server/cloud/integrations/action_approvals/access.py](../../../../../server/proliferate/server/cloud/integrations/action_approvals/access.py), [server/cloud/integrations/action_approvals/service.py](../../../../../server/proliferate/server/cloud/integrations/action_approvals/service.py), [server/cloud/integrations/health.py](../../../../../server/proliferate/server/cloud/integrations/health.py), [server/cloud/integrations/service.py](../../../../../server/proliferate/server/cloud/integrations/service.py), [server/cloud/materialization/materialize/secret_set.py](../../../../../server/proliferate/server/cloud/materialization/materialize/secret_set.py), [server/cloud/materialization/sandbox_io/runtime_launch.py](../../../../../server/proliferate/server/cloud/materialization/sandbox_io/runtime_launch.py), [server/cloud/runtime_workers/service.py](../../../../../server/proliferate/server/cloud/runtime_workers/service.py), [server/cloud/secrets/service.py](../../../../../server/proliferate/server/cloud/secrets/service.py) | [get_default_organization_for_user](../../../../../server/proliferate/db/store/organizations.py), [list_organizations_for_user](../../../../../server/proliferate/db/store/organizations.py), [get_active_membership](../../../../../server/proliferate/db/store/organizations.py), [list_organization_members](../../../../../server/proliferate/db/store/organizations.py), [get_current_membership_for_user](../../../../../server/proliferate/db/store/organizations.py) | read API | Read organization and membership context for Cloud operations. |
| FR-15 | `cloud` | [users](../../../../../server/proliferate/db/store/users.py) | [server/cloud/materialization/materialize/git_identity.py](../../../../../server/proliferate/server/cloud/materialization/materialize/git_identity.py) | [get_user_by_id](../../../../../server/proliferate/db/store/users.py) | read API | Load the user's Git identity inputs. |
| FR-16 | `organizations` | [agent_gateway](../../../../../server/proliferate/db/store/agent_gateway/__init__.py) | [server/organizations/usage/service.py](../../../../../server/proliferate/server/organizations/usage/service.py) | [llm_cost_usd_by_user](../../../../../server/proliferate/db/store/agent_gateway/__init__.py) | read API | Read per-user managed-LLM usage for the organization usage surface. |
| FR-17 | `organizations` | [auth_passwords](../../../../../server/proliferate/db/store/auth_passwords.py) | [server/organizations/self_registration.py](../../../../../server/proliferate/server/organizations/self_registration.py) | [get_user_by_normalized_email](../../../../../server/proliferate/db/store/auth_passwords.py) | read API | Resolve an existing user during self-registration. |
| FR-18 | `organizations` | [billing](../../../../../server/proliferate/db/store/billing.py) | [server/organizations/usage/service.py](../../../../../server/proliferate/server/organizations/usage/service.py) | [BudgetLimitInput](../../../../../server/proliferate/db/store/billing.py), [compute_usage_seconds_by_user_for_org](../../../../../server/proliferate/db/store/billing.py), [list_budget_limits](../../../../../server/proliferate/db/store/billing.py) | read API; store value/error type | Type and read organization usage and limits. The mutation that replaces budget limits is excluded below. |
| FR-19 | `workflows` | [cloud_workspaces](../../../../../server/proliferate/db/store/cloud_workspaces.py) | [server/workflows/managed.py](../../../../../server/proliferate/server/workflows/managed.py) | [get_cloud_workspace_by_id](../../../../../server/proliferate/db/store/cloud_workspaces.py) | read API | Resolve the workspace for managed execution. |
| FR-20 | `workflows` | [repositories](../../../../../server/proliferate/db/store/repositories.py) | [server/workflows/service.py](../../../../../server/proliferate/server/workflows/service.py), [server/workflows/worker/delivery.py](../../../../../server/proliferate/server/workflows/worker/delivery.py), [server/workflows/worker/target_plan.py](../../../../../server/proliferate/server/workflows/worker/target_plan.py) | [get_repo_config_by_id_for_user](../../../../../server/proliferate/db/store/repositories.py), [get_repo_environment_by_id](../../../../../server/proliferate/db/store/repositories.py) | read API | Resolve repository targets for workflow planning and delivery. |

## Observed candidates not declared as reads

This evidence table explains the remaining candidates from the pinned census.
It does not declare, approve, or create implementation work for any row.

| Current candidate | Why it is not declared by this proposal |
| --- | --- |
| [server/billing/stripe_webhooks.py](../../../../../server/proliferate/server/billing/stripe_webhooks.py) → [create_llm_credit_grant](../../../../../server/proliferate/db/store/agent_gateway/__init__.py) | Mutation, even though Billing also has read-only Agent Gateway imports. |
| [server/billing/reconciler.py](../../../../../server/proliferate/server/billing/reconciler.py) → the four Cloud provider-observation functions in [cloud_sandboxes](../../../../../server/proliferate/db/store/cloud_sandboxes.py) | Mutations owned by the separate write-repair slice; only [load_cloud_sandbox_by_id](../../../../../server/proliferate/db/store/cloud_sandboxes.py) is declared in FR-03. |
| [server/billing/team_checkout/activation.py](../../../../../server/proliferate/server/billing/team_checkout/activation.py) → [organization_invitations](../../../../../server/proliferate/db/store/organization_invitations.py) | Invitation creation and delivery mutations owned by the separate write-repair slice. |
| Billing team-checkout via [service.py](../../../../../server/proliferate/server/billing/team_checkout/service.py) and [activation.py](../../../../../server/proliferate/server/billing/team_checkout/activation.py) → Organization activation, intent mutation, and locking symbols in [organizations](../../../../../server/proliferate/db/store/organizations.py) | Mutations or transaction-coupled locking seams owned by separate write-repair slices; only the exact reads in FR-05 are proposed. |
| Cloud → [billing-subject ensure and move symbols](../../../../../server/proliferate/db/store/billing_subjects.py) | Mutations; only [get_billing_subject_by_id](../../../../../server/proliferate/db/store/billing_subjects.py) is declared in FR-10. |
| [server/notifications.py](../../../../../server/proliferate/server/notifications.py) → [billing_runtime_usage](../../../../../server/proliferate/db/store/billing_runtime_usage.py) | Claim and mark mutations, not reads. |
| Organizations SSO via [service.py](../../../../../server/proliferate/server/organizations/sso/service.py) and [transactions.py](../../../../../server/proliferate/server/organizations/sso/transactions.py) → [auth_sso](../../../../../server/proliferate/db/store/auth_sso.py) | The current store API mixes record types, reads, and CRUD, while its product ownership is not settled by this proposal. Do not infer or declare it here. |
| [server/organizations/usage/service.py](../../../../../server/proliferate/server/organizations/usage/service.py) → [replace_budget_limits](../../../../../server/proliferate/db/store/billing.py) | Mutation; only the read and type symbols in FR-18 are proposed. |
| Setup via [server/setup/accounts.py](../../../../../server/proliferate/server/setup/accounts.py) → [update_user_password_hash](../../../../../server/proliferate/db/store/auth_passwords.py) | Mutation. |
| Workflows via [server/workflows/managed.py](../../../../../server/proliferate/server/workflows/managed.py) and [server/workflows/worker/coordination.py](../../../../../server/proliferate/server/workflows/worker/coordination.py) → [enqueue_outbox_task](../../../../../server/proliferate/db/store/background_outbox.py) | Deliberate substrate write, not a foreign product-domain read. |
| Parked [server/automations](../../../../../server/proliferate/server/automations/) imports | The tree is not importable and is covered by its deletion slice; dead code does not become read doctrine. The resolvable and missing-module counts appear only in the census note above. |

## Limits of this proposal

- This review artifact does not adopt the proposed doctrine, change current
  product behavior, or authorize a merge.
- It adds no static enforcement, owner registry, generated graph,
  configuration, tier rule, event rule, or general algorithm for deciding
  whether arbitrary code is a domain, owner, read, or write.
- An `FR-*` row declares only its exact sites and symbols. It does not approve
  the rest of a store module or any write named in the evidence table.
- It creates no migration policy or replacement architecture for the listed
  dependencies.
- Auth, permissions, middleware, integrations, background work, migrations,
  and the parked Automations tree are outside the ledger except where the
  evidence table explicitly fences an observed candidate.
