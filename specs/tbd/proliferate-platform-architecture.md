# Proliferate Platform Thesis, Product Architecture, and Requirements

Status: non-authoritative cross-system architecture proposal.

Date: 2026-07-10.

Current-state review baseline: repository commit
`24e987ee9b90b4dbdfd88ff09d828331b5b2b034`, rechecked 2026-07-11.

Owner: Proliferate.

Audience: founders, product and engineering leads, implementation agents, and
design-partner engineers.

Scope: the product thesis, end-state product model, canonical vocabulary,
control-plane and execution architecture, team and enterprise requirements,
current-state gaps, V1 boundary, and dependency-ordered implementation shape.

This document stands on its own. Existing focused specifications under
specs/codebase and specs/developing remain authoritative until they are amended
or superseded. This proposal must not be cited as proof that a Target capability
is currently implemented.

## 1. How to use this memo

Read this memo before making a cross-system change involving:

- workflows or automations
- remote agent execution
- cloud sandboxes
- Runner Pools or customer-hosted compute
- Projects, team access, service identities, or budgets
- Web/Desktop runtime convergence
- integration and secret policy
- devcontainers, environment builds, or prebuilds
- background scheduling or durable automation
- self-hosting topology

The memo has three jobs:

1. Explain what company and product Proliferate is building.
2. Give every implementation agent the same system model and vocabulary.
3. Prevent local implementation choices from closing off the larger product.

An agent must still read the authoritative focused specification for the code
area it changes. This memo supplies cross-system intent; focused specifications
own current behavior and code boundaries.

### 1.1 Focused reading map

- [Repository specification map](../README.md)
- [Workflow feature contract](../codebase/features/workflows.md)
- [Workflow completion plan](workflows-v1-completion-plan.md)
- [Server standards](../codebase/structures/server/README.md)
- [Background work](../codebase/structures/server/guides/background.md)
- [AnyHarness structure](../codebase/structures/anyharness/README.md)
- [Proliferate Worker structure](../codebase/structures/proliferate-worker/README.md)
- [Proliferate Supervisor structure](../codebase/structures/proliferate-supervisor/README.md)
- [Frontend structure](../codebase/structures/frontend/README.md)
- [Frontend package boundaries](../codebase/structures/frontend/packages/README.md)
- [Current self-hosted deployment](../developing/deploying/self-hosted-deploy.md)

## 2. Status vocabulary

Every capability in this memo is one of:

- **Current**: verified in the repository today.
- **V1**: required for the first credible team or enterprise design-partner
  experience.
- **Target**: the intended durable architecture after V1.
- **Non-goal**: deliberately outside the near-term boundary.

Do not mix these states. In particular:

- Current personal-cloud behavior is not the Target team architecture.
- A Target schema is not permission to add an unratified table.
- Public launch readiness is not equivalent to enterprise readiness.
- Self-hostable control-plane code is not the same as customer-hosted execution.
- Product parity between Web and Desktop is not identical source code.

Unless a subsection explicitly says otherwise, Sections 7 through 31 describe
the **Target** architecture. Section 32 describes **Current** repository
reality. Sections 33 through 39 define the staged **Pilot V1**, **Platform V1**,
and acceptance boundary. Sections 3 through 6 are company and product thesis,
not implementation claims.

In this memo, **secret-free contract** means that Proliferate-managed
credentials, private envelopes, and secret-mount values are represented only by
safe references and never embedded as values. It does not assert that arbitrary
customer-authored code, files, prompts, or outputs contain no sensitive data.

## 3. Executive thesis

Software development is becoming the coordination of increasingly capable,
heterogeneous agents rather than the manual production of every line of code.
The winning organizational primitive is not one chat box or one model-specific
IDE. It is the system through which a company defines, runs, observes, governs,
and improves agent work.

Proliferate exists to let organizations build and own that system.

The concise product thesis is:

> Build and own repeatable work across any coding agent, on compute and
> infrastructure you control.

The broader thesis is:

> Proliferate is the open, self-hostable control and execution plane for an
> organization's software factory.

A software factory is not a metaphor for a single workflow. It is the complete
operating system around autonomous engineering work:

- reusable workflows and agent roles
- interactive human-agent workspaces
- reproducible environments
- managed and customer-owned compute
- integrations and execution identities
- access and cost controls
- schedules and event-driven work
- inspection, intervention, review, and audit
- artifacts such as patches, pull requests, reports, and sites
- continuous evaluation and improvement

Proliferate begins with software engineering because code is measurable,
versioned, reviewable, and economically valuable. The execution architecture
must nevertheless support repository-optional work, interactive chat, and
long-lived functional agents without a fundamental rewrite.

## 4. Why this company has a right to exist

Frontier model providers can and will offer increasingly complete coding
products. That does not eliminate the need for an independent platform.

Organizations still need a layer that is:

- model-neutral
- harness-neutral
- deployable in their infrastructure
- open source and inspectable
- able to use proprietary and open models together
- connected to their tools and internal systems
- governed by their identity, access, network, and budget policy
- durable across changes in model vendor and interface
- customizable by platform teams
- capable of becoming organization-specific infrastructure

The model provider optimizes its model and product ecosystem. Proliferate
optimizes the customer's complete agent operating environment.

The strategic whitespace is not merely self-hosting an IDE. It is owning the
neutral organizational layer between:

~~~
people and teams
models and harnesses
repositories and data
integrations and credentials
compute and environments
workflows and schedules
results and review
policy and cost
~~~

If a frontier provider later exposes self-hostable infrastructure, Proliferate
still competes through neutrality, openness, customer deployment, cross-harness
workflow portability, team governance, and superior execution. The correct
response is not to predict that labs will ignore the space. It is to build the
best independent implementation and earn distribution before the category
settles.

## 5. Product strategy

### 5.1 Initial wedge

Status: product direction. Individual pieces are Current or beta; the complete
combination is not an enterprise-readiness claim.

The initial wedge combines:

- a rich AI development interface
- support for Claude Code, Codex, and open-source agents/models
- repeatable single-agent and multi-agent workflows
- local and cloud execution
- open-source, AGPL-3.0 code
- self-hostable foundations

The public product should be useful to an individual engineer immediately.
Team and enterprise adoption expands the same product rather than introducing a
separate enterprise architecture.

### 5.2 Team expansion

The first team mandate is:

> Give Proliferate one recurring engineering process. Proliferate deploys it
> into a controlled Project, runs it on approved compute under an approved
> identity, and makes its work and cost visible to the team.

The first enterprise sale should be one installed, measurable workflow or
workspace use case. The platform expands after value is proven.

### 5.3 Long-term expansion

As models improve, Proliferate should support:

- interactive coding and collaboration
- background coding agents
- proactive maintenance and support response
- repository-optional knowledge work
- chat and coworking
- persistent agents responsible for business functions
- customer-trained or customer-selected models
- artifacts and applications produced by agents
- eventually broader organizational autonomy

Proliferate is not a static workflow editor. It is the place where increasingly
capable agents are deployed and governed.

## 6. Business and monetization thesis

Open source is the adoption and trust strategy, not the absence of a business.

Credible monetization paths include:

- Proliferate-managed control plane and compute
- enterprise subscriptions for governance, audit, identity, policy, and support
- customer-hosted Runner Pool management
- managed updates and fleet operations
- security, compliance, retention, and deployment controls
- premium support and forward-deployed engineering
- usage-based model and compute services
- workflow deployment, observability, and evaluation services
- private integration and environment implementation
- future model customization, routing, or training services

The open-source code makes adoption, inspection, extension, and self-hosting
credible. The commercial product makes the platform easy to operate, secure,
govern, and scale.

Durable advantages can accumulate through:

- trusted deployment inside real organizations
- workflow definitions, evaluations, and operational knowledge
- integration and environment compatibility
- reliable managed and customer-hosted runner operations
- team-wide usage and review habits
- the open-source community and ecosystem
- enterprise relationships and forward-deployed expertise
- a reputation for model neutrality and customer control

No single item is a permanent moat. The company wins by compounding all of them
while the market forms.

## 7. Product invariant

The central platform invariant is:

> Any authorized piece of work can be resolved into an immutable, secret-free
> work contract, scheduled onto policy-compliant compute, executed by
> AnyHarness in an isolated environment, observed and controlled by humans, and
> preserved as an auditable result.

This applies to:

- an interactive Workspace activation
- a manual Workflow Run
- a scheduled or event-triggered Workflow Run
- a repository-optional Task
- a future persistent Agent Service activation

The product objects differ. The infrastructure substrate is shared.

### 7.1 Design for rapidly improving agents

The architecture must not depend on agents remaining weak.

As models become more capable:

- authored workflows may become shorter and more goal-oriented
- agents may choose more internal tactics
- one agent may perform work that currently requires several stages
- persistent services may replace some scheduled jobs

The durable value of the platform remains:

- identity and authorization
- environment and compute
- integrations and secrets
- durable intent and observation
- budgets and admission
- human inspection/intervention
- artifacts, audit, and evaluation
- deployment neutrality

Deterministic workflow structure should concentrate around side effects,
handoffs, verification, policy, and recoverability. It should not micromanage
reasoning merely because today's models sometimes need it.

## 8. End-state system overview

~~~
Clients
  Desktop
  Web
  API
  later Mobile
        |
        | Control API and Runtime Gateway
        v
Control Plane
  Organizations, Projects, Workflows
  Access, identity, integrations, budgets
  Workspaces, Runs, projections, audit
  Scheduler, runner registry, ticket issuer
        |
        | durable background delivery
        v
Background Orchestration Plane
  transactional outbox
  Celery workers
  Beat schedules
  reconciliation and cleanup
        |
        | outbound controller protocol
        v
Runner Plane
  Runner Pools
  Runner Controllers
  Compute Classes
  provider drivers
        |
        v
Execution Environment
  Supervisor
  AnyHarness
  Proliferate Worker
  workspace/devcontainer context
  agent and human processes

Cross-cutting data planes
  Runtime Gateway and Relay
  Model and Integration Gateway
  Secret and Effect Broker
  Artifact and checkpoint storage
~~~

## 9. Canonical vocabulary

These nouns are deliberately distinct.

### 9.1 Organization

The hard tenancy, ownership, policy, and billing boundary for shared product
resources.

### 9.2 Membership

A human user's relationship to an Organization. Organization-wide owner,
admin, and member roles remain coarse administrative roles, not sufficient
resource authorization.

### 9.3 Access Group

An overlapping collection of memberships or service identities that receives
typed roles on resources.

Access Groups grant permissions. They do not own Projects, Workflows, or
compute.

### 9.4 Cost Center

A budgeting and attribution identity. A Cost Center never grants access.

### 9.5 Service Principal

A nonhuman execution identity used by approved unattended work. A Service
Principal is not a disguised human account.

### 9.6 Integration Connection

An Organization-owned authenticated relationship with an external provider.
Policy determines which Projects, principals, Workflows, and tools may use it.

### 9.7 Repository

An Organization-known source repository and provider identity.

### 9.8 Project

The runnable organizational context for a body of work. A Project may contain
zero, one, or several repositories or source mounts.

A Project owns or selects:

- source bindings
- environment configuration
- allowed compute
- integration and network policy
- Workflow Deployments
- access grants
- budget defaults
- Workspaces and work history

A Project is not synonymous with a repository or an Access Group.

### 9.9 Environment Definition

Mutable authoring state describing how to construct a workspace environment.

### 9.10 Environment Revision

An immutable, content-addressed resolution of an Environment Definition.
Every remote Workspace activation and WorkflowRun references an exact revision.

### 9.11 Workflow Definition

Portable authored workflow logic: typed inputs, agent roles, steps, emitted
state, branches, and declared capability requirements.

### 9.12 Workflow Version

An immutable Workflow Definition revision.

### 9.13 Workflow Deployment

The operational installation of a Workflow Version into a Project. It binds
environment, compute, execution identity, integrations, triggers, access,
budget, visibility, and result policy.

Definition and Deployment must not collapse.

### 9.14 Workflow Run

One logical invocation of a Workflow Deployment or, during migration, a
personal Workflow Version. Use WorkflowRun when referring to this product
object; do not use capitalized Run as a generic synonym for all work.

### 9.15 Workspace

A durable user-visible context for interactive human-agent work, sessions,
review state, and artifacts. A Workspace is not a physical sandbox.

### 9.15a Workspace Materialization

One generation-fenced realization of a Workspace on an Attempt, eventually one
Target, and a storage backend. Its identity, assigned Attempt, and
`storage_generation` are immutable; lifecycle, Target enrollment, checkpoint,
and cleanup facts change only through fenced compare-and-swap transitions. A
Workspace points to at most one current writable materialization. Replacing a
Target does not replace the Workspace and never silently reuses the old storage
generation. Historical materialization identities remain append-only for audit.

### 9.15b Workspace Checkpoint

An immutable, verified, content-addressed snapshot of reproducible workspace
state. It records exact source lineage plus staged, unstaged, and every eligible
non-ignored untracked file according to the workflow checkpoint contract. It excludes
Target identity, runtime credentials, control state, ephemeral secrets, and
undeclared caches.

### 9.15c Runtime Ledger Snapshot

An optional encrypted snapshot of recoverable AnyHarness durable state such as
session/workflow cursors, attempts, effects, and the observation outbox. It is
not a Workspace Checkpoint, never contains Worker Target identity, and is not
an available Pilot V1 cross-Target workflow continuation path. Any future
cross-Target workflow continuation requires a verified Runtime Ledger Snapshot.

### 9.15d Recovery Manifest

The immutable signed aggregate that references one Workspace Checkpoint, the
required Runtime Ledger Snapshot, storage/encryption receipts, source and
runtime lineage, and either the `recovery` or future `resume_safe` acceptance
class. The component payloads remain separately encrypted and scoped.

### 9.16 Execution

The durable infrastructure request to make an authorized workload active.
Interactive Workspace activation and automated Workflow work both use
Executions.

Cardinalities:

- one Workspace has many activation Executions over time
- one WorkflowRun has one logical Execution
- one Execution has one or more Attempts
- one Attempt has at most one current Execution Environment
- one environment lifetime has exactly one Target identity

### 9.17 Execution Attempt

One physical attempt to satisfy an Execution. Its provisioning claim has an
immutable assignment plus a renewable lease and fence. A pre-acceptance failed
Attempt may be replaced without replacing the logical WorkflowRun or Workspace.
Post-acceptance replacement has stricter orphan and quiescence rules.

### 9.18 Execution Environment

One isolated VM, microVM, pod, or container boundary materializing a Workspace
activation or automated Attempt.

### 9.19 Execution state set

This is a conceptual set, not a ratified database resource named ExecutionHome.
It distinguishes:

- the durable Workspace identity
- one replaceable materialization/environment
- runtime-owned AnyHarness state
- filesystem/worktree bytes
- caches
- accepted checkpoints and archives
- the current Target identity

Focused Workspace lifecycle specifications must decide which pieces persist,
where they live, and how replacement works. Do not create an ExecutionHome
table or collapse Workspace, materialization, cache, and archive ownership
without that decision.

### 9.20 Runner Pool

An Organization-visible capacity, placement, and trust boundary. A pool may be
Proliferate-managed or customer-owned.

### 9.21 Compute Class

A named resource and policy profile offered by a Runner Pool: CPU, memory,
disk, GPU, region, architecture, isolation, network, and price characteristics.

### 9.22 Runner Controller

The long-lived pool agent that advertises capacity, claims Attempts, provisions
and destroys environments, and manages provider-level lifecycle.

### 9.23 Target

The enrolled identity of one materialized environment generation. A new
environment receives a new Target identity.

### 9.24 Proliferate Worker

The per-Target bridge between one Execution Environment and the control plane.
It does not schedule or provision a fleet.

### 9.25 Supervisor

The target-local process lifecycle owner for AnyHarness and Worker.

### 9.26 AnyHarness

The focused execution runtime and sole workflow interpreter. It owns live
sessions, workflow state, tools, terminals, files, worktrees, transcripts, and
observed execution.

### 9.27 Runtime Gateway and Relay

The authenticated payload-transparent route between authorized clients and the
current AnyHarness Target. It is not a scheduler or execution authority.

### 9.28 Artifact

A durable output such as a patch, diff, report, pull request, site, generated
application, dataset, or checkpoint reference.

## 10. Resource graph

~~~
Organization
  Memberships
    default Cost Center

  Access Groups
    Group Memberships

  Cost Centers
    Budget Policies

  Service Principals

  Integration Connections
    capability and principal grants

  Repository Connections
    Repositories

  Projects
    Project Repository bindings
    Environment Definitions
      Environment Revisions
        Environment Builds
    Project access grants
    allowed Runner Pools and Compute Classes
    Workflow Deployments
    Workspaces
      Workspace Materializations
      accepted Recovery Manifests
        Workspace Checkpoints
        Runtime Ledger Snapshots
    Runs and Artifacts

  Workflow Definitions
    immutable Workflow Versions

  Runner Pools
    Compute Classes
    Runner Controllers
    capacity and health

  Audit, Usage, and Billing
~~~

All shared resources carry a non-null Organization identity. Database access
must scope by Organization as well as resource ID. Cross-Organization foreign
references must be structurally impossible or explicitly validated at the
store boundary.

### 10.1 An engineering organization is not one hierarchy

Do not add one magical `Team` tree and hang permissions, compute, and money
from it. Real engineering organizations are overlapping graphs:

| Question | Canonical model |
| --- | --- |
| Which tenant owns this? | Organization |
| Who is this human or automation inside the tenant? | Membership or Service Principal |
| Which collections grant access? | Access Groups |
| What body of engineering work is this? | Project |
| Which automation is operationally installed? | Workflow Deployment |
| Which capacity may it request? | Runner Pool, Compute Class, and typed grants/bindings |
| Whose internal budget is charged? | Cost Center and Budget Policy |
| Who pays Proliferate? | Billing Subject |

One engineer may belong to Platform, Security Reviewers, and Incident Response
Access Groups, work in several Projects, and have one effective Cost Center at
a point in time. A Project may be accessible to several groups, use compute
administered by another group, and charge a Cost Center that grants no access.
Reorganizations should change join rows and future attribution, not move or
re-own every Project and historical Execution.

This separation is the core organizational principle:

~~~
tenant ownership != access != work context != execution identity
                 != compute entitlement != cost attribution
~~~

The product may present a convenient "team setup" flow that creates a group,
Cost Center, and Project together. Those remain separate resources with
separate lifecycles in the database.

### 10.2 Concrete 100-engineer example

~~~
Organization: Acme

Access Groups:
  payments-engineers
  platform-engineers
  security-reviewers

Cost Centers:
  ENG-PAYMENTS
  ENG-PLATFORM

Project: payments-api
  repositories: payments-api + shared-protos
  approved compute revisions:
    managed-standard-r7
    customer-secure-large-r3

Grants:
  payments-engineers -> Project executor
  platform-engineers -> Project maintainer
  payments-engineers -> managed Pool use
  platform-engineers -> customer-secure-large use

Workflow Deployment: dependency-upgrade
  Project: payments-api
  Workflow Version: 12
  access: restricted to platform-engineers
  executed as: payments-automation Service Principal
  Cost Center: ENG-PAYMENTS
  compute: customer-secure-large-r3
~~~

A Payments engineer can open ordinary work on the Project using the managed
class. They cannot invoke the restricted Deployment or secure-large compute
unless the independent grants also allow it. The unattended Deployment charges
ENG-PAYMENTS regardless of which human last edited it. If its budget is
exhausted, the work is authorized but not admitted. If compatible secure-large
capacity is absent, it awaits capacity rather than appearing forbidden.

## 11. Team product experience

### 11.1 Administrator experience

For a 100-person engineering organization, an administrator should:

1. Connect source providers and repositories.
2. Create Projects for meaningful engineering contexts.
3. Define or adopt a devcontainer-compatible environment.
4. Publish an immutable Environment Revision.
5. Register Proliferate-managed or customer-owned Runner Pools.
6. Select allowed Compute Classes for each Project.
7. Create Access Groups or synchronize them from identity providers.
8. Grant groups Project and compute roles.
9. Connect integrations and define capability policy.
10. Create Service Principals for unattended work.
11. Create Cost Centers and budget rules.
12. Deploy approved Workflow Versions into Projects.
13. Observe work, cost, audit, capacity, and failure.

### 11.2 Developer experience

An authorized developer should:

1. See only Projects and Workflows they may access.
2. Open or resume an interactive Workspace.
3. Select an allowed agent, model, environment, and Compute Class.
4. Chat, use terminals, inspect files, and review changes in one workspace.
5. Run an approved Workflow.
6. Watch its live transcript and status.
7. Inspect outputs, files, diffs, tests, and artifacts.
8. Cancel or intervene when permitted.
9. Understand which identity, environment, integrations, and budget the work
   used.
10. Hand work to a teammate without exporting opaque chat history.

### 11.3 Platform-engineering experience

A platform engineer should be able to:

- encode the standard environment once
- register compute once
- install reusable Workflows
- bind service identities and integrations
- define cost and concurrency policy
- make approved automation discoverable
- observe failures across the organization
- keep code and secrets inside customer-controlled infrastructure when needed

## 12. Authorization, admission, and placement

The start decision has three stages that must remain distinct.

**Authorization** asks whether an actor may use a resource, execution principal,
integration, and Compute Class:

~~~
Organization membership
  intersect Project role
  intersect Workflow Deployment role
  intersect Project compute allowlist
  intersect actor/group compute entitlement
  intersect execution-principal authority
  intersect integration capability policy
~~~

**Admission policy** asks whether this authorized work may start now under:

~~~
  intersect network/model policy
  intersect budget and concurrency policy
~~~

**Placement** selects currently compatible capacity:

~~~
  intersect current capacity
~~~

No single organization-wide role implies all of these. Capacity exhaustion is
not an authorization denial; it queues or returns an explicit availability
result. The domain service freezes authorization and admission decisions. The
scheduler consumes and revalidates those decisions but does not invent product
policy.

### 12.1 Recommended V1 roles

Project:

- Viewer
- Executor
- Contributor
- Maintainer

Runner Pool and Compute Class:

- Use
- Administer

Workflow Deployment:

- View
- Execute
- Edit
- Administer

Deployment-specific grants are needed only when narrower than Project access.

### 12.2 Typed grants

Use resource-typed grant tables with real foreign keys rather than one loose
polymorphic grant table.

Examples:

~~~
project_grant
runner_pool_grant
compute_class_grant
workflow_deployment_grant
integration_connection_grant
~~~

V1 groups are flat. Nested groups, custom role builders, and a generic grant
graph are later capabilities.

### 12.3 Effective capabilities

The server returns effective booleans and eligible choices such as:

~~~
canView
canExecute
canEdit
canManageAccess
eligibleComputeClasses
eligibleExecutionPrincipals
eligibleIntegrationBindings
~~~

Clients must not reconstruct resource policy from owner/admin/member labels.

### 12.4 Organizational invariants

The following are database and service invariants, not UI conventions:

1. Organization is the non-null tenant on every shared resource, grant,
   binding, decision, usage row, and audit row.
2. A User is a global login identity. A Membership is that human's standing in
   one Organization. Shared-resource authorization never keys on User alone.
3. Access Groups receive grants; they do not own Projects, repositories,
   Workflows, Runner Pools, or Cost Centers.
4. Cost Centers attribute spend and never grant access.
5. Project access, compute entitlement, integration capability, execution
   identity, and budget admission are independent intersections.
6. Organization owner/admin/member remains coarse governance. It does not
   silently grant repository, transcript, secret, compute, or Workflow access.
7. V1 authorization is default-deny and additive-allow. It has fixed roles,
   no generic deny rows, no custom role builder, and no nested groups.
8. A child resource's restricted access mode plus a matching grant may narrow
   Project access. An additive grant by itself never narrows and never widens
   beyond the Project baseline.
9. Authorization liveness has one canonical state. A removed Membership or
   suspended/removed Service Principal cannot remain active through another
   table.
10. Historical principals, grants, decisions, runs, usage, and audit records
    are retained. Removal disables authority; it does not erase accountability.

Owner and admin authority permits management of access. It does not imply
silent data-plane access. Any break-glass elevation into Project content is
explicit, time-bounded, and audited.

### 12.5 Canonical authorization subjects

The existing Organization remains the tenant row and adds the fields that make
policy revocable and attribution deterministic:

~~~
organization
  ...current identity and lifecycle fields...
  authorization_revision bigint not null default 0
  policy_revision bigint not null default 0
  default_cost_center_id UUID nullable
~~~

`suspended` is a universal no-new-access/no-new-admission state. The active-work
response is explicit Organization policy; suspension is never merely a badge in
the administrative UI.

One small relational supertype is justified because the same three kinds of
entity can receive a typed grant:

~~~
authorization_subject
  id UUID primary key
  organization_id UUID not null
  kind membership | service_principal | access_group
  status pending | active | suspended | removed
  created_at
  suspended_at nullable
  removed_at nullable

  unique (organization_id, id)
~~~

An authorization subject is a grant target. Only Membership and Service
Principal subjects are principals: they can authenticate, initiate work, or be
`executed_as`. An Access Group can receive grants and contain principals, but
it cannot authenticate or execute.

The subtype tables share the subject UUID as their primary key:

~~~
organization_membership
  subject_id UUID primary key
  organization_id UUID not null
  user_id UUID nullable until a provisioned identity is claimed
  org_role owner | admin | member
  provisioning_source manual | invitation | jit | scim | bootstrap
  joined_at nullable
  created_at
  unique (organization_id, user_id, subject_id)

current_organization_membership
  organization_id UUID not null
  user_id UUID not null
  membership_subject_id UUID not null
  primary key (organization_id, user_id)
  unique (organization_id, membership_subject_id)
  foreign key (organization_id, user_id, membership_subject_id)
    references organization_membership
      (organization_id, user_id, subject_id)

service_principal
  subject_id UUID primary key
  organization_id UUID not null
  slug
  display_name
  description nullable
  owner_membership_subject_id UUID
  created_by_subject_id UUID
  last_used_at nullable
  created_at

service_principal_credential
  id UUID primary key
  organization_id UUID not null
  service_principal_subject_id UUID not null
  kind api_key | workload_identity
  public_prefix nullable
  secret_hash nullable
  encrypted_config_reference nullable
  expires_at nullable
  revoked_at nullable
  last_used_at nullable
  created_at

access_group
  subject_id UUID primary key
  organization_id UUID not null
  slug
  display_name
  description nullable
  management_mode manual | scim | system
  directory_group_id UUID nullable
  created_by_subject_id UUID nullable
  created_at
~~~

`authorization_subject.status` is the single access-liveness state. The
subtypes contain identity-specific metadata, not a second competing status.
Cross-table deferred constraints or invariant triggers must ensure exactly one
subtype matches `kind`. All write paths go through one domain service; tests
exercise these invariants directly.

The same deferred constraints cover subject-typed foreign keys: initiator,
executor, creator, grantor, and Cost Center assignment accept only Membership
or Service Principal kinds where specified; approver/owner fields require a
human Membership; group IDs require Access Group. A plain foreign key to
`authorization_subject` is not enough.

A kind-dependent check requires an API-key `secret_hash` or a workload-identity
`encrypted_config_reference`, never both. An API-key secret is returned once at
creation and is never retrievable again.

A SCIM-provisioned, not-yet-claimed Membership may be `pending` and may have
pre-staged group edges, but it authorizes nothing until activated. `suspended`
is reversible by the authoritative directory or an explicit administrator
action. `removed` is terminal. A later rejoin creates a new Membership subject,
so old direct grants cannot silently resurrect. The current-membership pointer
selects at most one nonterminal claimed incarnation per Organization/User. It
is removed atomically when the subject becomes `removed`; historical Membership
and grant rows remain. This avoids a partial index that would need to inspect
status in another table.

A Membership claim may set `user_id` from null to one verified User exactly
once; it can never be reassigned to transfer grants. Account deletion detaches
the User only after removing the current pointer and terminating the subject
under the retention flow.

An active or suspended claimed Membership must be the target of its matching
current pointer; a removed Membership must not be. Pending unclaimed directory
subjects have no User pointer. Deferred constraints prevent an alternate
claimed subject from remaining active off to the side.

Deleting a global User must not cascade-delete historical Memberships,
Executions, usage, or audit. Product account deletion anonymizes or detaches the
login identity according to retention policy while retaining the Organization
subject required for history.

### 12.6 Flat Access Groups

~~~
access_group_member
  id UUID primary key
  organization_id UUID not null
  group_subject_id UUID not null
  member_subject_id UUID not null
  source manual | scim | system
  external_assignment_id nullable
  valid_from
  expires_at nullable
  revoked_at nullable
  added_by_subject_id UUID nullable
  revoked_by_subject_id UUID nullable
  created_at
~~~

The member must be a Membership or Service Principal subject, never another
group. An active-edge partial unique index prevents duplicate effective
membership. Index active edges by both `(organization_id, member_subject_id)`
and `(organization_id, group_subject_id)`.

A SCIM-managed group is read-only locally. If administrators need local
additions, they create an overlapping manual group rather than mixing two
authorities in one membership set. This makes directory reconciliation and
revocation explainable.

Management mode and edge source are enforced server-side and by invariant
checks:

- manual groups accept only manual edges
- SCIM groups accept only reconciler-written SCIM edges with an external
  assignment identity
- system groups accept only named platform-maintainer writes
- local APIs reject writes to SCIM/system groups

Changing group membership is equivalent to granting every capability already
held by that group. V1 permits owner/full admin to edit any manual group and
`security_admin` to edit ordinary Project-access groups only. A group holding
delegated Organization roles, Service Principal delegation, Integration use,
or privileged compute is owner/full-admin managed. No delegated administrator
may add themselves, a controlled Service Principal, or a colluding subject to a
group that confers authority they cannot directly grant. `identity_admin` may
provision people and manage nonprivileged identity metadata but cannot edit an
access-bearing group or promote an owner/admin. Any future group-manager
delegation must evaluate the complete authority the group can confer and
prohibit self-escalation.

Flat overlapping groups are sufficient for 100–1,000-person organizations.
Nested groups add cycles, closure-table maintenance, surprising transitive
access, and ambiguous cache invalidation. If customer evidence later requires
them, add a distinct `access_group_edge`, a maintained closure table, a maximum
depth, and transactionally enforced cycle checks. Do not change the meaning of
`access_group_member`.

### 12.7 Typed resource grants

Use the authorization subject abstraction only for grantees. Keep a separate
grant table for each resource class so the resource side has a real foreign key
and a fixed role vocabulary:

~~~
project_grant
workflow_deployment_grant
workspace_grant
runner_pool_grant
compute_class_grant
integration_connection_grant
service_principal_grant
service_principal_delegate_grant
organization_role_grant
~~~

Every table follows one grammar:

~~~
id UUID primary key
organization_id UUID not null
<typed_resource_id> UUID not null
grantee_subject_id UUID not null
role <resource-specific fixed enum>
valid_from
expires_at nullable
revoked_at nullable
grant_source manual | scim | system | migration
granted_by_actor_kind membership | service_principal | system
granted_by_subject_id UUID nullable for system
revoked_by_actor_kind nullable
revoked_by_subject_id UUID nullable
created_at
~~~

Every grant has a partial unique index on resource, grantee, and role where
`revoked_at IS NULL`. PostgreSQL cannot put `expires_at > now()` in this index;
a regrant transaction first closes any expired-but-unrevoked row. A role change
revokes the old row and inserts a new row; it does not rewrite history. The
evaluator ignores pending, suspended, removed, not-yet-valid, expired, or
revoked subjects/edges/grants.

Actor-kind checks require the subject to be a Membership or Service Principal;
an Access Group can never create, approve, grant, or revoke. Bootstrap and
migration changes use a named system actor and still write audit evidence.

The recommended fixed roles compile to capabilities in versioned server code:

| Resource | Roles | Important capabilities |
| --- | --- | --- |
| Project | viewer, executor, contributor, maintainer | view; run/open; author; configure/manage access |
| Workflow Deployment | view, execute, edit, administer | narrower operational access |
| Workspace | view, contribute, administer | optional narrowing and handoff |
| Runner Pool | use, administer | request eligible classes; manage pool/controllers |
| Compute Class | use, administer | request class; configure class revisions |
| Integration Connection | use, administer | invoke approved capabilities; manage connection |
| Service Principal | act_as, bind_to_deployment, administer | ad hoc execute; durable scoped binding; rotate/suspend/configure |
| Organization | identity_admin, security_admin, billing_admin, platform_admin, auditor | delegated administration without ownership |

Project, Deployment, and Workspace roles are ordered capability bundles: each
higher role contains the lower role's capabilities. Runner Pool, Compute Class,
Integration Connection, Service Principal, and Organization roles are
orthogonal. In particular, `administer` does not imply `use` or `act_as`; a
platform or security administrator does not silently gain the ability to run
private compute, invoke an integration, or impersonate automation. The
evaluator unions all matching role capability sets.

An Organization owner is always an active human Membership and remains a
special governance invariant. Groups and Service Principals can never be
owners. The last active owner cannot be removed or demoted; owner mutations
lock the Organization and enforce this in the same transaction. The current
coarse admin role may initially map to all administrative capabilities, while
`organization_role_grant` provides narrower delegation as customers scale.
Custom role definitions are intentionally later.

`organization_role_grant` targets its own Organization and therefore has no
second resource UUID. Only an owner or current full admin may create/revoke a
delegated Organization role, with explicit anti-self-escalation checks. Owner
promotion/demotion, recovery authority, and SSO enforcement remain owner-only.

Project-scoped ad hoc Service Principal delegation is intentionally a
two-resource grant:

~~~
service_principal_delegate_grant
  organization_id
  project_id
  service_principal_subject_id
  grantee_membership_subject_id
  role act_as
  ...grant lifecycle and actor evidence...
~~~

Its grantee is an active human Membership only—not a Service Principal or
Access Group—so V1 cannot create identity-delegation chains. Workflow
Deployment binding is the normal automation path.

Durable administration/binding authority uses a different typed grant:

~~~
service_principal_grant
  organization_id
  service_principal_subject_id
  grantee_subject_id
  role bind_to_deployment | administer
  ...grant lifecycle and actor evidence...
~~~

The grantee may be a Membership or carefully managed Access Group, never
another Service Principal. This grant does not confer ad hoc `act_as`.

### 12.8 Project inheritance and narrowing

Project is the primary collaboration and policy boundary. Repository bindings,
Environment Definitions, Workspaces, run history, and ordinary artifacts
inherit the Project baseline unless an explicitly supported child resource
narrows it.

`WorkflowDeployment.access_mode` is:

- `inherit_project`: the Project capability is sufficient
- `restricted`: the caller needs both the Project capability and a matching
  Workflow Deployment grant

The inherited capability mapping is explicit:

~~~
Project viewer      -> Deployment view
Project executor    -> Deployment view + execute
Project contributor -> Deployment view + execute + edit
Project maintainer  -> Deployment view + execute + edit + administer
~~~

Workspace uses `access_mode = inherit_project | restricted`. A restricted
Workspace needs both the Project capability and a Workspace grant; a new
personal Workspace is represented by a restricted grant to its creating
Membership, and sharing adds deliberate grants. Effective child capability is
the intersection of Project and child capabilities, never the larger one.

The Deployment grant never admits a caller who lacks Project access. The same
intersection applies to a restricted Workspace. This avoids a deny ACL and
makes "why can Alice run this?" answerable.

Repositories do not need an independent team ACL in V1. Access is through
Projects, and one repository may be bound to several Projects. Provider-side
repository permissions are a separate credential/capability check and can only
narrow product access.

### 12.9 Compute and integration authorization

The customer-visible capacity model is Organization-scoped even when
Proliferate backs several logical pools with one internal physical fleet:

~~~
runner_pool
  id UUID primary key
  organization_id UUID not null
  slug
  ownership_kind proliferate_managed | customer_owned
  status registering | active | draining | offline | retired
  current_policy_revision_id UUID nullable

runner_pool_policy_revision
  id UUID primary key
  organization_id UUID not null
  runner_pool_id UUID not null
  revision_n
  provider_kind
  region
  trust_class
  network_boundary_id UUID nullable
  policy_digest
  created_at

compute_class
  id UUID primary key
  organization_id UUID not null
  runner_pool_id UUID not null
  slug
  display_name
  status draft | active | deprecated | disabled | retired
  current_revision_id UUID nullable

compute_class_revision
  id UUID primary key
  organization_id UUID not null
  compute_class_id UUID not null
  runner_pool_id UUID not null
  runner_pool_policy_revision_id UUID not null
  revision_n
  cpu_millis
  memory_mb
  disk_mb
  gpu_spec nullable
  architecture
  isolation_class
  network_profile_id UUID
  maximum_duration_seconds
  compute_price_revision_id UUID
  specification_digest
  created_at
~~~

Runner Pool Policy Revision and Compute Class Revision are immutable because
trust, region, network, shape, isolation, duration, and price are execution
inputs. Every Execution/Attempt pins both exact revisions; editing either named
resource creates a revision instead of rewriting history.
An internal supply-pool table may map many Organization pools to managed
capacity, but it is not exposed as a cross-tenant product resource.

Project compute policy and direct/group compute entitlement remain separate:

~~~
project_compute_class
  id UUID primary key
  organization_id
  project_id
  compute_class_id
  approved_compute_class_revision_id
  is_default
  status

compute_class_grant
  organization_id
  compute_class_id
  grantee_subject_id
  role use | administer
  ...grant lifecycle...
~~~

Effective compute is:

~~~
Project permits Compute Class
AND direct/group subject grant permits Compute Class or its Pool
AND Deployment permits the class when applicable
AND admission policy permits its cost, network, region, and isolation
~~~

At most one active Project binding is default. That default references its own
active `project_compute_class` row. Pool `use` permits use of an exact
Project-bound revision from that Pool; a Class `use` grant is the narrower
alternative. `administer` never implies `use`.

Adding a class or promoting a new Class/Pool revision does not automatically
make it runnable in any Project. A Project binding must approve the exact
revision, and a Deployment Revision pins an approved exact revision or subset.
The scheduler never silently upgrades cost, network access, or isolation; a
revision change requires new configuration authorization, admission, and budget
reservation.

Composite lineage constraints prove, rather than assume:

- `(organization, compute_class, revision)` names a revision of that Class
- the Class and its revision name the same Runner Pool
- the Pool Policy Revision belongs to that same Pool
- a Deployment's `(organization, Project, Class, revision)` references an
  active exact `project_compute_class` approval row

Tenant-only foreign keys are insufficient because swapping a revision from a
different Class or Pool changes cost, network, and isolation authority.

Integration access follows the same structure. A Project or Deployment binds
an Integration Connection plus allowed capabilities; the `executed_as`
principal must also have permission to use that connection. The intersection,
not either side alone, is exposed to the runtime.

### 12.10 Effective authorization query and caching

At this scale, resolve access from authoritative rows rather than building a
premature materialized ACL graph:

1. Require active Organization and active Membership/Service Principal.
2. Build `effective_subjects` as the direct subject union its active flat
   Access Groups.
3. Join the relevant typed grant table on those subjects.
4. Filter active resource, grant validity, revocation, and Organization.
5. Union the explicit capability sets from every matching fixed role.
6. Apply child-resource narrowing and the independent compute/integration
   intersections.
7. Return both capabilities and the matching grant path for administrative
   explanation.

Do not compare role strings lexicographically. The server owns an explicit
role-to-capability mapping. Clients receive `can*` booleans, eligible choices,
and denial reason codes.

`Organization.authorization_revision` is a monotonic bigint. Every mutation to
an authorization input increments it once per transaction and writes an audit
event plus transactional outbox record. Inputs include subject/group/grant
state, Organization/Project/resource status, Deployment access mode/revision,
Project compute bindings, integration capability bindings, Service Principal
delegation/binding, and every other row consulted by authorization. The
authorization-engine version is also part of decision/cache digests so a role
map or evaluator release cannot reuse old allows.

A coarse Organization revision is simplest and safest for 100–1,000 people; a
SCIM reconciliation transaction increments it once. Cache either independent
initiator/executor entitlements and intersect them, or key a final execution
decision by Organization revision, authorization-engine version, initiator,
`executed_as`, Project, Deployment Revision/binding digest, resource, and
action. TTL never passes the next subject, group-edge, grant, delegation, or
binding validity transition.

Runtime and gateway tickets carry the authorization revision and remain
short-lived. No eventually delivered event stream is the sole revocation
guard. Before every privileged broker/model/integration issuance or effect,
gateways compare the ticket against the authoritative current revision through
the authorization service/Postgres; a mismatch rejects or reauthorizes it.

The revocation stream accelerates connection closure. It has a durable
per-Organization monotonic sequence and consumer checkpoint. A consumer that
sees a gap, reconnects, or loses its checkpoint fails closed for that
Organization and rereads authoritative revision before serving. The IAM
mutation is not acknowledged as successfully revoked until the authoritative
revision is committed. Long streams close or refresh on revision change. This
coarse approach may refresh unaffected users after any IAM edit, which is
acceptable at this scale.

Suspension/removal immediately blocks new model, integration, Git, effect, and
runtime capability use. Organization policy may decide whether inert compute is
quiesced, retained read-only for recovery, or destroyed; it may not allow a
suspended/removed principal to keep making privileged external effects. The scheduler
revalidates authorization/admission evidence before dispatch.

### 12.11 Tenant-safe relational constraints

For every Organization-owned parent table:

~~~
unique (organization_id, id)
~~~

For every Organization-owned reference:

~~~
foreign key (organization_id, parent_id)
  references parent (organization_id, id)
~~~

The redundant Organization column is intentional. It makes a cross-tenant
Project/grant/compute/Workflow binding structurally impossible instead of
depending on every caller to remember a check. PostgreSQL row-level security
using request Organization context is defense in depth, not the primary policy
engine.

Use `RESTRICT` or soft lifecycle transitions for resources referenced by
Executions, usage, credentials, and audit. `CASCADE` is reserved for truly
derivative, unused configuration. Common list paths require pagination,
normalized-name indexes, active partial indexes, and Organization-prefixed
indexes from the beginning.

### 12.12 Directory provisioning and deprovisioning

SSO proves an identity; SCIM provisions organizational standing. They are
separate systems:

~~~
directory_connection
directory_user
  connection_id, external_id, membership_subject_id, active, version
directory_group
  connection_id, external_id, access_group_subject_id, active, version
directory_group_member
directory_change_event
directory_sync_run
~~~

External immutable IDs, not email addresses, are directory identity. SCIM
changes are idempotent per resource, use provider versions/cursors when
available, and are repaired by periodic authoritative reconciliation; the
architecture does not assume one portable global event order across providers.
A deactivate synchronously suspends the authorization subject, increments the
authorization revision, and emits revocation work. Cleanup of group edges may
be asynchronous because the inactive subject already authorizes nothing.

Manual removal is sticky and terminal: JIT login must never reactivate a
removed Membership. A new invitation or explicit reprovision creates a new
subject. Membership removal or suspension must fan out to model-gateway keys,
runtime tickets, integration capabilities, active sessions, pending
reservations, and unattended work according to Organization policy.

Directory automation can never remove the final break-glass owner. Required
SSO still needs a separately protected recovery path. Invitations may have
initial group-assignment join rows, but acceptance creates/claims the
Membership, activates it, adds the groups, increments authorization revision,
and audits atomically.

If a previously removed external directory ID is reprovisioned, the directory
link moves explicitly to a new current Membership subject while retaining the
old subject in history. Nested directory groups are either rejected with a
clear diagnostic or flattened into direct membership edges at the directory
boundary with provenance; they never create nested Proliferate Access Groups.

### 12.13 Authorization and audit evidence

Every sensitive decision persists or emits bounded evidence:

~~~
authorization_decision_event
  organization_id
  authenticated_actor_id
  requesting_subject_id nullable before Membership resolution
  executed_as_subject_id nullable
  trigger_kind and trigger_resource_id nullable
  workflow_deployment_revision_id nullable
  action
  resource_kind and resource_id
  allowed
  reason_code
  matching_grant/group-edge IDs or decision_digest
  authorization_revision
  authorization_engine_version
  request_id and execution_id nullable
  occurred_at

audit_event
  organization_id
  authenticated_actor_id nullable
  actor_subject_id nullable
  source manual | scim | system
  action
  resource_kind and resource_id
  before/after digest or bounded metadata
  request_id
  occurred_at
~~~

Generic resource references are acceptable in append-only audit because audit
is historical evidence, not authorization authority. Secrets, prompts, source
content, and raw provider tokens are excluded. High-volume tables are
partitionable by time and Organization.

### 12.14 Current-state delta and safe migration

The Current repository has useful Organization, Membership, Invitation,
partial SSO, and payer foundations, but it does not yet implement this
authorization model:

- [OrganizationMembership](../../server/proliferate/db/models/organizations.py)
  is unique per Organization/User and carries only owner/admin/member plus
  active/removed.
- [permissions.py](../../server/proliferate/permissions.py) resolves only the
  selected personal/Organization ownership scope, coarse Membership role, and
  payer context.
- [Workflow](../../server/proliferate/db/models/cloud/workflows.py),
  [CloudWorkspace](../../server/proliferate/db/models/cloud/workspaces.py),
  repositories, and the current Cloud Sandbox application path remain
  fundamentally user-owned. Older Cloud Sandbox migration history briefly
  introduced profile/Target/billing/generation shapes, but later cleanup
  migrations intentionally removed them and restored the personal model. Treat
  those abandoned columns as migration archaeology, not latent team schema.
- Hosted Organization SSO with `jit_policy=create_member` can currently
  reactivate an existing removed Membership. Single-Organization mode has a
  guard, but hosted manual removal must also become sticky before enterprise
  use.
- The SSO schema represents OIDC/SAML and optional/required policy, but the
  current Organization enable path supports optional OIDC only. Enforced OIDC
  is a gate before a large customer expands beyond a named pilot cohort; SAML,
  SCIM, and directory group mapping remain later customer-driven gates.
- Membership removal does not yet fan out to every Organization model-gateway
  enrollment/key, runtime ticket, and active workload.
- Organization suspension is representable but is not yet one universal
  authorization/admission kill switch.
- Row-level tenant policy is not broadly applied across shared resources.

Migrate additively:

1. Remove all "first/current Membership" inference from execution, usage, and
   billing. Require explicit Organization, Membership subject, Billing Subject,
   and Project context.
2. Treat existing personal resources as unassigned. User ownership and
   Organization Membership do not prove which tenant/Project owns a Workflow,
   repository, Workspace, or sandbox. Require an explicit user/admin migration
   choice or retain it in a legacy personal tenant; never choose the first
   Organization or synthesize grants from mere Membership.
3. Add `authorization_subject` and backfill existing Membership IDs as the same
   subject IDs. Replace permanent Organization/User uniqueness with the
   current-membership pointer, tombstone removed subjects/grants, mirror old
   status temporarily, then make subject status authoritative.
4. Inventory and dual-write every downstream Membership consumer—not only API
   authorization—including seat reconciliation, gateway enrollment/signup,
   invitations, SSO JIT, usage payer resolution, and member/admin UI. Shadow
   reads must agree before subject status becomes authoritative.
5. Remove destructive identity cascades before enterprise history depends on
   them. Make Membership `user_id` nullable with `SET NULL` or `RESTRICT` before
   account deletion can occur. User deletion must detach/anonymize, not erase
   Membership, WorkflowRun, Workspace, usage, or audit authority.
6. Add Project, Project Repository binding, ProjectGrant, Organization revision,
   and decision audit. Create only the grants required to preserve proven
   current access; never grant all Organization members by accident. Secrets,
   integration capabilities, model keys, and privileged compute are
   quarantine-first and require administrator-confirmed grants/bindings.
7. Add Service Principal, flat Access Group, typed compute/integration grants,
   and Workflow Deployment.
8. Inventory an endpoint/resource/action authorization matrix. Dual-write and
   shadow-evaluate the central decision beside every scattered legacy check;
   record mismatches until each resource has parity.
9. Backfill only proven Organization/Project keys, add composite foreign keys
   as `NOT VALID`, validate them, then make required columns non-null.
10. Define a cut line for active legacy work: drain/quiesce it or retain it as a
   non-continuable legacy Execution with unknown dimensions. At cutover, bump
   authorization revision, revoke/rotate legacy gateway and integration
   credentials, reauthorize active work, and reject old bearer tickets.
11. Flip endpoints resource by resource to the central evaluator; delete each
    legacy user/role ownership path after parity.
12. Add directory sync only after flat group and sticky deprovision semantics
    are stable. Run reconciliation in dry-run mode before enforcement.

The minimum design-partner cut is Project + ProjectGrant, one flat Access
Group, Service Principal + durable narrow Deployment binding, Compute Class
entitlement plus Project allowlist, restricted/inherited Deployment access, frozen execution
tenant/attribution, Organization authorization revision, and append-only
decision audit. Full SCIM administration and custom organizational reporting
must not delay that cut; sticky removal, full credential revocation fanout, and
revision-aware runtime/gateway tickets are pre-pilot gates.

## 13. Execution identity

Execution is the canonical identity/attribution authority. WorkflowRun,
WorkspaceActivation, and Task each carry one unique `execution_id` foreign key;
Execution does not also point back and create a circular one-to-one pair. Any
denormalized identity fields are immutable projections written in the same
transaction and covered by equality tests.

Every Execution freezes:

~~~
Organization and Project
trigger kind and trigger resource
initiated_by_subject_id
executed_as_subject_id
approved_by_subject_id when applicable
charged_cost_center_id
billing_subject_id
authorization revision and decision digest
admission/policy revisions
~~~

The Organization-facing portion of the canonical row is:

~~~
execution
  id UUID primary key
  organization_id UUID not null
  project_id UUID not null
  workload_kind workspace_activation | workflow_run | task
  execution_mode local | remote
  workflow_deployment_revision_id UUID nullable
  initiated_by_subject_id UUID not null
  executed_as_subject_id UUID not null
  approved_by_subject_id UUID nullable
  billing_subject_id UUID not null
  charged_cost_center_id UUID not null
  attribution_effective_at
  environment_revision_id UUID not null
  runner_pool_policy_revision_id UUID nullable only when local
  compute_class_revision_id UUID nullable only when local
  current_admission_generation bigint nullable
  created_at

execution_admission
  organization_id UUID not null
  execution_id UUID not null
  generation bigint
  authorization_revision bigint
  authorization_engine_version
  authorization_decision_id UUID
  dispatch_policy_revision_digest
  admission_decision_id UUID
  current_policy_renewal_generation bigint
  status held | committed | superseded | denied
  created_at
  unique (organization_id, execution_id, generation)

execution_policy_renewal
  organization_id UUID not null
  execution_id UUID not null
  execution_admission_generation bigint
  renewal_generation bigint
  effective_policy_revision_digest
  budget_admission_decision_id UUID
  status held | active | superseded | denied | revoked
  created_at
  unique (organization_id, execution_id, execution_admission_generation,
          renewal_generation)
~~~

Constraint triggers require exactly one typed workload child matching
`workload_kind`, enforce subject kinds, and enforce remote compute requirements.
`current_admission_generation` is the one mutable pointer on the otherwise
immutable Execution identity row. Attempt Assignment and committed Concurrency
slots reference the exact ExecutionAdmission. A capacity readmission creates a
new Admission generation without rewriting the Execution or prior decisions.

Budget holds and renewable policy slices reference an
ExecutionPolicyRenewal beneath that Admission. Ordinary policy renewal creates
no new Attempt and no second Concurrency slot; it atomically revalidates the
existing committed slots. Admission generation changes only for dispatch,
replacement, or capacity readmission. Runtime lifecycle state belongs to the
fuller Execution/Attempt schema; immutable identity fields do not change when an
Attempt is replaced.

A human may execute as themselves or an approved Service Principal. A human
may never execute as another human, and an Access Group may never execute.

An active Workflow Deployment Revision chooses `caller_self` or binds one
Service Principal. Caller-self resolves `executed_as` to the initiating human
at each manual run and is invalid for unattended triggers. Creating or changing
a Service Principal binding needs a distinct durable `bind_to_deployment`
capability or Service Principal administration plus the configured approval
policy. A temporary ad hoc `act_as` grant cannot create permanent delegation.
Binding creates a new immutable Deployment Revision, records
authorization/approval evidence and validity, and is revalidated on activation.

A caller who later executes the approved Deployment needs Project and
Deployment execute capability; the caller does not receive a general-purpose
credential or unrestricted ability to impersonate the Service Principal. The
delegation is confined to that exact Workflow Version, typed input policy,
environment, compute/integration/effect capabilities, and Deployment Revision.
Ad hoc use outside a Deployment requires the explicit, expiring,
Project-scoped `service_principal_delegate_grant`.

For interactive work:

- `initiated_by` is the human Membership
- `executed_as` is normally the same Membership
- an approved Service Principal is an exceptional explicit mode

For scheduled, webhook, or poll work, the trigger is recorded separately and
the Deployment's Service Principal is the accountable initiator/executor. The
platform scheduler is transport machinery, not the business identity.

The `executed_as` principal must itself hold Project, compute, and integration
authorization. Model, network, region, and isolation restrictions are evaluated
independently by admission policy. Caller authorization cannot lend the
principal capabilities it does not hold. Service Principal credentials and
provider tokens are issued through short-lived brokers and never become
ordinary Workspace secrets visible to the agent.

## 14. Cost centers, budgets, and metering

Access and cost are separate.

Usage attribution should include:

~~~
Organization
Cost Center
Project
Workflow Deployment and WorkflowRun
Workspace
initiated_by
executed_as
Execution and Attempt
Runner Pool and Compute Class
provider and model
quantity, unit, cost, and timestamp
idempotency key
~~~

Budget policy may exist at:

- Organization
- Cost Center
- Project
- Workflow Deployment
- Service Principal
- Membership subject

The admission service resolves and freezes effective policy. The scheduler
verifies current evidence and requests readmission when it is stale; it never
invents product policy.

### 14.1 Reservation and reconciliation

For autonomous work:

1. Estimate or cap expected model and compute use.
2. Reserve budget before dispatch.
3. Meter append-only actual usage and apply it to frozen rules continuously.
4. Renew bounded slices or quiesce when renewal fails/overruns.
5. Close remaining reservation only after terminal quiescence.
6. Keep late provider reconciliation append-only.

Consumption-only enforcement is insufficient because multiple autonomous runs
can overshoot simultaneously.

### 14.2 Controls

Budget and policy can limit:

- model families
- maximum model cost
- token or dollar spend
- compute class
- concurrent runs
- daily or monthly usage
- maximum wall time
- network class
- privileged integrations

The UI must distinguish permission denial, budget exhaustion, capacity
unavailability, and environment failure.

Model/network allowlists, integration privilege, and isolation requirements
are admission policies rather than accounting budgets. Expensive models use
both: policy answers whether they are allowed; budget answers how much may be
spent.

### 14.3 Cost Center model

The Organization Billing Subject is the payer. Cost Centers are internal
allocation identities beneath that payer:

~~~
cost_center
  id UUID primary key
  organization_id UUID not null
  code
  display_name
  status active | frozen | archived
  created_by_subject_id UUID
  created_at
  archived_at nullable

principal_cost_center_assignment
  id UUID primary key
  organization_id UUID not null
  principal_subject_id UUID not null
  cost_center_id UUID not null
  effective_from
  effective_until nullable
  assigned_by_subject_id UUID
  created_at
~~~

`principal_subject_id` must be a Membership or Service Principal, never a
group. A partial unique index permits at most one current assignment per
principal. Effective-dated assignments preserve historical attribution when an
engineer moves from one team to another.

The database checks `effective_until IS NULL OR effective_until >
effective_from` and uses a PostgreSQL exclusion constraint to prevent
overlapping `[effective_from, effective_until)` ranges for one Organization and
principal, including bounded future assignments. Resolution records one exact
`attribution_effective_at`. The deferred subject-kind invariant also covers
Cost Center assignments and Execution identity; `approved_by` must be a human
Membership.

Keep Cost Centers flat in Pilot and Platform V1. An optional reporting parent
can be added later, but it must not silently create budget inheritance. If
hierarchical enforcement becomes necessary, budget policy bindings explicitly
define it and reservations apply to every selected ancestor rule.

Cost attribution is configuration, not caller input. Project carries:

~~~
cost_attribution_mode initiator | executing_principal | fixed
fixed_cost_center_id nullable
~~~

Workflow Deployment Revision carries:

~~~
cost_attribution_mode inherit_project | initiator | executing_principal | fixed
fixed_cost_center_id nullable
~~~

`fixed` requires a Cost Center. `initiator` and `executing_principal` resolve
the effective-dated assignment at initial admission. The exact algorithm is:

~~~
effective_mode =
  Deployment mode == inherit_project ? Project mode : Deployment mode

principal =
  initiator           -> initiated_by_subject_id
  executing_principal -> executed_as_subject_id

charged_cost_center =
  fixed     -> configured fixed Cost Center
  otherwise -> principal assignment at attribution_effective_at
  otherwise -> configured Organization default Cost Center
  otherwise -> not admitted
~~~

Capacity readmission reuses the already frozen Cost Center; it never reroutes a
queued run because an engineer changed assignments. Readmission fails if the
frozen Cost Center is no longer chargeable.

Project mode is the default. A Deployment override requires `billing_admin` or
an explicit `manage_cost_attribution` capability and is revisioned/audited. If
Finance requires mandatory Project attribution, a separate admission policy
forbids overrides. An initiating client may never submit an arbitrary Cost
Center UUID.

Cost Center lifecycle means:

- `active`: may receive new assignments, bindings, and charges
- `frozen`: configuration/assignment changes are blocked; existing approved
  bindings may continue charging
- `archived`: historical reporting only; no new admission or binding

Cost Center code is unique within Organization. Composite foreign keys enforce
same-Organization defaults/bindings. Checks require `fixed_cost_center_id` if
and only if the corresponding mode is `fixed`.

Every Execution freezes `charged_cost_center_id`. Later personnel or Project
changes affect only future Executions.

### 14.4 Versioned Budget Policies

Do not extend one mutable limit row into an unbounded scope/JSON policy. Use a
mutable policy identity with immutable revisions and typed scope bindings:

~~~
budget_policy
  id UUID primary key
  organization_id UUID not null
  name
  status draft | active | retired
  current_revision_id UUID nullable

budget_policy_revision
  id UUID primary key
  organization_id UUID not null
  budget_policy_id UUID not null
  revision_n
  mode observe | warn | enforce
  effective_at
  created_by_subject_id UUID
  created_at

budget_rule
  id UUID primary key
  organization_id UUID not null
  budget_policy_id UUID not null
  stable_key
  meter total_usd | compute_usd | model_usd | compute_seconds |
        gpu_seconds | input_tokens | output_tokens | executions
  window execution | hour | day | month | billing_period
  unit
  status active | retired

budget_rule_revision
  id UUID primary key
  organization_id UUID not null
  budget_policy_revision_id UUID not null
  budget_rule_id UUID not null
  cap_amount NUMERIC
  enforcement_kind soft | hard
  warning_threshold nullable
~~~

Scope bindings have one real relational supertype so enforcement rows never
point at an untyped UUID:

~~~
budget_policy_binding
  id UUID primary key
  organization_id UUID not null
  budget_policy_id UUID not null
  scope_kind organization | cost_center | project | workflow_deployment |
             service_principal | membership
  status active | disabled | retired
  created_at

organization_budget_policy_binding (binding_id primary key, organization_id)
cost_center_budget_policy_binding (binding_id primary key, organization_id,
                                   cost_center_id)
project_budget_policy_binding (binding_id primary key, organization_id,
                               project_id)
workflow_deployment_budget_policy_binding
  (binding_id primary key, organization_id, workflow_deployment_id)
service_principal_budget_policy_binding
  (binding_id primary key, organization_id, service_principal_subject_id)
membership_budget_policy_binding
  (binding_id primary key, organization_id, membership_subject_id)
~~~

Deferred invariants require exactly one subtype matching each binding and real
composite same-Organization foreign keys on that subtype. This lets one
reusable policy bind to several scopes without combining their counters
accidentally. A unique policy/scope identity is reactivated rather than
recreated, so unbind/rebind cannot reset consumption.

Access Groups are deliberately absent. If Finance wants a budgeted
organizational grouping, that grouping is a Cost Center, not a repurposed ACL.

Every applicable active rule is evaluated independently against its own scope,
meter, window, consumed amount, and reserved amount. Every hard rule must pass;
a Cost Center cap and Organization cap have different populations and are not
collapsed into one numeric minimum. Accounting consumption is applied to every
matching rule/window. Any future waiver is a separate explicit, expiring,
audited resource rather than hidden precedence.

Policy mode and rule enforcement combine exactly:

- `observe`: record breaches only
- `warn`: emit warnings for breached soft or hard rules
- `enforce`: hard rules block/stop renewal; soft rules warn

Checks enforce nonnegative caps, `0 <= warning_threshold <= cap_amount`, and a
valid meter/unit pair. Stable Budget Rule identity survives Policy Revision
changes so publishing a new cap does not reset a monthly counter. A newly added
rule is seeded from canonical usage plus active reservations during activation,
or activates at the next window boundary. A removed rule stops new admission
but continues reconciling existing holds.

Meter, window, and unit are immutable properties of the stable Budget Rule.
Changing any of them creates a new Rule; only cap, warning threshold, and
enforcement behavior change across Rule Revisions. Counters therefore never
reuse quantities with incompatible meanings.

An execution evaluates bindings for the Organization, frozen charged Cost
Center, Project, Workflow Deployment, and every distinct principal in
`{initiated_by, executed_as}` using the Membership or Service Principal subtype.
Caller-self deduplicates the one Membership; scheduled work applies its Service
Principal once. All resulting hard rules must pass.

### 14.5 Race-free reservation model

Append-only consumption alone cannot protect an autonomous fleet. Concurrent
Executions can all observe remaining budget and overshoot it. Add:

~~~
budget_window_counter
  organization_id
  budget_policy_binding_id
  budget_rule_id
  window_key
  window_start
  window_end
  consumed_amount NUMERIC
  reserved_amount NUMERIC
  version bigint
  primary key (organization_id, budget_policy_binding_id, budget_rule_id,
               window_key)

budget_reservation
  id UUID primary key
  organization_id UUID not null
  execution_id UUID not null
  admission_generation bigint
  policy_renewal_generation bigint
  status held | committed | reconciling | reconciled | released | expired |
         overrun
  idempotency_key
  dispatch_expires_at
  created_at
  closed_at nullable
  unique (organization_id, execution_id, admission_generation,
          policy_renewal_generation)
  unique (organization_id, idempotency_key)

budget_reservation_hold
  organization_id
  reservation_id
  budget_policy_binding_id
  budget_rule_id
  budget_rule_revision_id
  window_key
  reserved_amount NUMERIC
  consumed_amount NUMERIC
  unique (reservation_id, budget_policy_binding_id, budget_rule_id, window_key)

execution_budget_rule
  organization_id
  execution_id
  admission_generation
  policy_renewal_generation
  budget_policy_binding_id
  budget_rule_id
  budget_rule_revision_id
  reservation_mode envelope | per_event

usage_budget_application
  organization_id
  usage_ledger_entry_id
  budget_policy_binding_id
  budget_rule_id
  window_key
  applied_amount NUMERIC
  reservation_hold_id nullable
  unique (usage_ledger_entry_id, budget_policy_binding_id, budget_rule_id,
          window_key)

budget_request_allocation
  id UUID primary key
  organization_id UUID not null
  execution_id UUID not null
  admission_generation bigint
  policy_renewal_generation bigint
  gateway_receipt_id UUID
  status held | consumed | released | uncertain
  idempotency_key
  unique (organization_id, gateway_receipt_id)
  unique (organization_id, idempotency_key)

budget_request_allocation_hold
  organization_id UUID not null
  allocation_id UUID not null
  reservation_id UUID not null
  reservation_hold_id UUID not null
  budget_policy_binding_id UUID not null
  budget_rule_id UUID not null
  window_key
  mode envelope_child | per_event
  amount NUMERIC
  status held | consumed | released | uncertain
  unique (allocation_id, budget_policy_binding_id, budget_rule_id, window_key)

budget_admission_decision
  id UUID primary key
  organization_id UUID not null
  execution_id UUID nullable for a denied start
  admission_generation bigint nullable
  policy_renewal_generation bigint nullable
  request_id
  decision allowed | denied
  reason_code
  policy_digest
  requested_amounts bounded JSON
  evaluated_at
~~~

Every slot lease and Attempt Assignment uses a composite foreign key to the
exact `(organization_id, execution_id, admission_generation)`
ExecutionAdmission. Every Budget reservation, frozen rule, and request
allocation additionally references the exact ExecutionPolicyRenewal generation.

Admission locks all applicable counter rows in deterministic Budget Rule ID
and binding order and atomically checks each hard rule:

~~~
consumed_amount + reserved_amount + requested_amount <= cap_amount
~~~

It then inserts all frozen rule applications and holds or none. Fixed
autonomous work reserves a declared envelope or conservative bound. Interactive
and long-lived work lease small renewable slices.

Each rule uses exactly one model-spend reservation mechanism. With `envelope`,
gateway requests allocate inside the Execution hold without increasing global
reserved totals again. With `per_event`, the Execution takes no envelope for
that rule and the gateway acquires a hold before provider dispatch. Every
gateway hold attaches to a durable receipt; an uncertain provider outcome keeps
the hold until provider-log reconciliation. `budget_request_allocation` gives
each concurrent request one durable receipt/idempotency identity; its child hold
rows own the amount against every applicable rule. Envelope-child rows divide
an existing hold without increasing the global reserved counter; per-event rows
increase it before dispatch. Only the affected request allocation stays
uncertain when one provider response is ambiguous.

Calendar hour/day/month windows use explicit UTC boundaries. Billing-period
windows use payer-period identity; execution windows use Execution UUID. A
renewable slice cannot cross a window boundary: it closes in the old window and
acquires a hold in the new one. `window_key` is therefore durable identity, not
just a derived timestamp.

The scheduler atomically revalidates authorization/policy evidence, verifies
the unexpired reservation, compare-and-swaps `held -> committed`, and creates
the immutable Attempt Assignment plus outbox work. The expiry path may expire
only `held` reservations with no committed Attempt. Controller acceptance binds
the same admission generation. If capacity is unavailable, the hold expires or
releases, the Execution remains awaiting capacity, and admission runs again.

Usage reconciliation is continuous, not terminal-only. Each compute slice or
model receipt atomically appends usage, inserts its frozen
`usage_budget_application` rows, consumes hold remainder, and increments every
matching counter. Failed renewal or overrun blocks new privileged work and
starts quiescence. Terminal reconciliation releases remainder and closes the
reservation. Late events apply against the frozen `execution_budget_rule`
set—not current policy—and may push a counter over cap and block future work.

Already committed envelope capacity remains governed by its frozen Rule
Revision unless an explicit emergency policy revokes it. Every new renewable
slice, per-event hold, or envelope expansion re-runs admission against currently
effective Policy/Rule Revisions and receives a new ExecutionPolicyRenewal
generation beneath the existing dispatch Admission; it does not create a new
Attempt or acquire duplicate Concurrency slots. Existing committed slots are
revalidated atomically. Long-lived work cannot retain an obsolete unlimited
policy indefinitely. Historical usage continues applying to the stable
binding/rule counters.

Concurrency uses parallel versioned admission resources rather than a field on
the Project/Compute binding:

~~~
concurrency_policy
  id, organization_id, name, status, current_revision_id

concurrency_policy_revision
  id, organization_id, concurrency_policy_id, revision_n, created_at

concurrency_rule
  id, organization_id, concurrency_policy_id, stable_key, status

concurrency_rule_revision
  id, organization_id, concurrency_policy_revision_id, concurrency_rule_id,
  maximum_active

concurrency_policy_binding
  id, organization_id, concurrency_policy_id, scope_kind, status

organization_concurrency_policy_binding
project_concurrency_policy_binding
workflow_deployment_concurrency_policy_binding
compute_class_concurrency_policy_binding
service_principal_concurrency_policy_binding
membership_concurrency_policy_binding

concurrency_slot_counter
  organization_id, concurrency_policy_binding_id, concurrency_rule_id,
  held_or_committed, version

concurrency_slot_lease
  organization_id
  concurrency_policy_binding_id
  concurrency_rule_id
  concurrency_rule_revision_id
  execution_id
  admission_generation
  status held | committed | released | expired
  expires_at
~~~

The binding uses the same supertype-plus-exactly-one-typed-subtype pattern as
Budget Policy bindings, with composite Organization foreign keys. A Deployment
stores stable binding identity; each admission/renewal freezes the effective
Rule Revision.

Admission locks counters and acquires slots for every applicable rule atomically
in deterministic order. Leases are truth and counters are transactionally
maintained/rebuildable projections. Dispatch commits leases with the Attempt
Assignment; active work renews them; only terminal quiescence releases committed
slots. Capacity waiting does not hold an execution slot indefinitely.

### 14.6 Canonical usage ledger

Provider collectors and existing usage tables can feed one Organization-aware,
append-only accounting ledger:

~~~
usage_ledger_entry
  id UUID primary key
  organization_id UUID not null
  billing_subject_id UUID not null
  attribution_quality exact | legacy
  charged_cost_center_id UUID nullable only when legacy
  project_id UUID nullable only when legacy
  workflow_deployment_id UUID nullable
  workflow_run_id UUID nullable
  workspace_id UUID nullable
  execution_id UUID nullable only when legacy
  attempt_id UUID nullable
  initiated_by_subject_id UUID nullable only when legacy
  executed_as_subject_id UUID nullable only when legacy
  runner_pool_id UUID nullable
  compute_class_revision_id UUID nullable
  provider
  provider_account_id
  model nullable
  meter
  quantity NUMERIC
  unit
  model_price_revision_id UUID nullable
  source
  source_event_id
  occurred_at
  usage_started_at nullable
  usage_ended_at nullable
  ingested_at
  correction_of_entry_id UUID nullable
  idempotency_key
  unique (organization_id, idempotency_key)
  unique (organization_id, source, provider_account_id, source_event_id, meter)
~~~

Money and billable quantities never use floating point. One row contains one
normalized meter: input tokens, output tokens, and model USD are separate rows;
USD is the `quantity` of the USD meter, so cost is not duplicated on token
rows. Compute-rate lineage comes from Compute Class Revision; model-cost
lineage comes from Model Price Revision.

Compute emits append-only `[usage_started_at, usage_ended_at)` slices that are
positive-duration and split at budget-window boundaries. Point events use
`occurred_at`. Model calls emit per-request entries. Provider uniqueness is
tenant- and account-safe as shown above. Corrections append compensating entries
referencing the original rather than mutating accounting history.

A database check requires the Cost Center, Project, Execution, initiator, and
executor dimensions when `attribution_quality=exact`. Only a bounded legacy
import may omit them; every new team execution is exact.

Point-event budget windows use `occurred_at`, never ingestion time. Interval
meters use the split usage interval/window key. Window counters and dashboard
rollups are rebuildable projections; usage ledger entries plus their
exactly-once rule-application rows are the accounting truth.

### 14.7 Start-time transaction

The start path is one ordered decision:

1. Authenticate an active Membership or Service Principal.
2. Authorize Project, Deployment, `executed_as`, compute, and integrations.
3. Resolve and freeze Billing Subject and Cost Center.
4. Pin immutable Workflow, Deployment, Environment, Pool Policy, Compute Class,
   model, network, and pricing revisions.
5. Allocate IDs and begin one transaction. Revalidate all authorization,
   policy, resource, and principal revisions; insert WorkflowRun/Workspace
   activation plus canonical Execution; lock Budget/Concurrency counters;
   evaluate and insert the ExecutionAdmission, initial ExecutionPolicyRenewal,
   frozen rule applications, reservation holds, slot leases, and
   admission-ready outbox event; commit all or none.
6. A denied admission commits bounded request/decision evidence and a denied
   ExecutionAdmission, but no holds, slot leases, or dispatch outbox.
7. Let the scheduler select compatible capacity. In one compare-and-swap
   transaction it revalidates evidence, commits holds/slots, creates the
   Attempt Assignment, activates the initial PolicyRenewal, and emits dispatch
   work. If capacity is unavailable,
   release/expire holds and return to awaiting-capacity readmission.
8. Attach all gateway and controller usage using the server-issued Execution
   identity. Each usage receipt continuously updates frozen rule applications;
   the client or agent never supplies authoritative attribution.
9. After terminal quiescence, close remaining holds/slots. Append late usage or
   corrections against the frozen admission generation.

The scheduler may report only one of the real outcomes: unauthorized, not
admitted, awaiting capacity, environment failure, or executing. It must not
collapse them into a generic start failure.

### 14.8 Current schema is a migration input

The existing `BillingSubject` remains useful as payer identity. The current
`BillingBudgetLimit`, `UsageSegment`, and model-usage rows are not the target
team accounting model:

- limits cover only Organization/user by compute/LLM by day/month
- consumption enforcement is not reservation-based
- current usage lacks Project, Deployment, Service Principal, Cost Center,
  Execution, Attempt, and immutable Compute Class Revision attribution
- nullable user scope permits duplicate Organization-wide limit rows unless a
  partial unique index or `NULLS NOT DISTINCT` invariant is added
- the managed-compute segment-open path can use a user's alphabetically first
  active Organization to choose both attribution and payer instead of using an
  explicit Execution tenant

No new team execution may infer payer or Organization from "the current" or
first Membership. Organization, Billing Subject, Project, and Cost Center are
resolved from the authenticated request/Deployment and frozen on Execution
before any resource is provisioned.

Every Organization-owned Execution uses that Organization's Billing Subject.
A human's personal Billing Subject is never an implicit fallback for shared
work.

Historical migration must remain honest:

- establish a canonical-ledger start timestamp; retain older source tables or
  import them with nullable unavailable dimensions plus
  `attribution_quality=legacy`, never invented default Projects/Cost Centers
- at that exact cut time, split/close every open Usage Segment, checkpoint all
  LiteLLM/provider importer cursors and watermarks, fence old collectors, and
  start new collectors with idempotent overlap; reconcile no gap/no overlap
  before enabling enforcement
- reconcile/deduplicate Organization-wide limits and preserve original payer
  values before enforcing new constraints; do not silently "correct" ambiguous
  old billing history
- validate every bare `billing_subject_id` in usage, grant, subscription, hold,
  and export tables; quarantine orphaned/ambiguous payer rows and snapshot
  reconciliation totals before import or counter seeding
- seed each active Budget Window Counter from reconciled usage when policy
  activates mid-window, or activate only at the next explicit window boundary
- define decimal precision and rounding for legacy floating-point compute/model
  values, retain source quantity, and use compensating corrections so totals
  remain reproducible

## 15. Project and source model

A Project is the durable context around work. Repositories are optional
bindings.

### 15.1 Project Repository binding

A Project may bind:

- one primary repository
- additional repositories
- default branches
- subdirectory roots
- read/write policy
- source provider connection
- checkout and branch behavior

Runs snapshot the exact source commit or a content-addressed workspace
checkpoint. Mutable branch labels are not sufficient execution identity.

### 15.2 Repository-optional Projects

A Project with no repository may use:

- object/document inputs
- databases
- APIs and integrations
- generated artifacts
- a base environment with no source checkout

This is the extension path from coding to broader knowledge work.

### 15.3 Relational Project model

~~~
project
  id UUID primary key
  organization_id UUID not null
  slug
  display_name
  description nullable
  status draft | active | suspended | archived
  cost_attribution_mode initiator | executing_principal | fixed
  fixed_cost_center_id UUID nullable
  default_project_compute_class_id UUID nullable
  policy_revision bigint
  created_by_subject_id UUID
  created_at
  archived_at nullable

repository
  id UUID primary key
  organization_id UUID not null
  provider_connection_id UUID not null
  provider_repository_id
  display_name
  status active | unavailable | archived

project_repository_binding
  id UUID primary key
  organization_id UUID not null
  project_id UUID not null
  repository_id UUID not null
  role primary | secondary
  mount_path
  writable boolean
  default_ref_policy
  created_at

project_environment_binding
  organization_id UUID not null
  project_id UUID not null
  environment_definition_id UUID not null
  is_default boolean
  status active | disabled
~~~

Unique indexes enforce one Organization/slug, one repository binding per
Project/mount path, and at most one active default environment. A Project
default Compute Class references an active `project_compute_class` row rather
than an arbitrary Compute Class ID.

`draft` permits configuration but not execution. `suspended` denies new work
and applies an explicit active-work policy. `archived` preserves read-only
history. A Project referenced by Workspaces, Executions, usage, or audit is
never hard-deleted.

## 16. Environment and devcontainer model

The environment system is a first-class platform subsystem, not a small runner
feature.

### 16.1 Product promise

An Environment Revision describes a reproducible place where agents can work
and authorized humans can inspect and control the same workspace state.

This does not require installing VS Code in every sandbox.

Human access through Proliferate includes:

- the same filesystem and worktree
- the same terminal environment
- the same installed tools and dependencies
- the same running services and forwarded ports
- the same git status and changed files
- the agent transcript and workflow state

Optional external-editor attachment may later include VS Code Server, Remote
SSH, Cursor, or code-server. These are access adapters, not the core
architecture.

### 16.2 Environment Definition

Mutable authoring may include:

- devcontainer configuration
- base image or Dockerfile
- features and tool installation
- setup and lifecycle commands
- services
- mounts and caches
- repository bindings
- environment variables
- port declarations
- health checks
- supported architecture
- symbolic secret or connection requirements

Environment configuration does not own model policy, compute entitlement,
execution identity, concrete secret selection, or Runner Pool placement. Those
belong to Deployment and execution policy.

### 16.3 Environment Revision

Resolution freezes:

- schema and compiler version
- pinned definition source repository, commit SHA, path, and source-context hash
- canonical configuration
- source configuration references
- image digest or Dockerfile/context/target and literal build inputs
- operating system, CPU architecture, workspace folder, and normalized run user
- required features
- services
- non-secret environment literals
- symbolic secret slots and requirements, never concrete secret bindings
- content hash and compatibility metadata

Runs and Workspaces point to an immutable revision. Editing an Environment
Definition creates a new revision.

Runtime binaries are versioned separately as a Runtime Bundle Revision covering
Supervisor, Worker, AnyHarness, and their compatibility contract. Model,
harness, network, isolation, compute, and concrete secret/connection bindings
belong to Deployment or Work Manifest policy rather than the Environment
Revision content hash.

Every Target and Attempt pins a reproducibility tuple:

~~~
Environment Revision
Environment Build and immutable artifact digest
Runtime Bundle Revision and signed manifest digest
~~~

The Environment Revision is portable customer workload truth. An Environment
Build is one replaceable realization for an architecture or provider. The
Runtime Bundle is trusted Proliferate software and evolves independently from
the customer's image. Do not add Runner Pool, Compute Class, provider,
credentials, model, budget, or Proliferate binary fields to the portable
Environment Revision.

### 16.4 Environment build and prebuild

Customer Dockerfiles, devcontainer features, lifecycle hooks, and package setup
are untrusted code. They never execute on the Runner Controller host or any
process holding pool/provider authority.

The build subsystem introduces:

~~~
EnvironmentBuild
  -> BuildAttempt
  -> signed EnvironmentArtifact
  -> optional provider/pool-local cache replica
~~~

There may be many Environment Builds for one Environment Revision. OCI image
digests are the normal portable output. An E2B template may be a provider-local
output. A VM is normally a runner host for OCI workloads, not a custom machine
image built once per Project.

An isolated builder receives no controller/provider credentials. It has
explicit network, resource, timeout, and cache policy. The resulting portable
OCI/content artifact is digest-addressed and carries signature, provenance, and
where practical an SBOM. A Runner Controller verifies digest/signature and
policy before using it.

The environment subsystem needs:

- deterministic build identity
- provider-independent build request
- build logs and terminal status
- cache and layer reuse
- prebuild registry
- architecture and Compute Class compatibility
- isolated build identity and network policy
- signed digest-addressed output
- provenance and SBOM
- tenant/project-scoped mutable caches
- vulnerability and policy hooks
- bounded retention and cleanup

A useful prebuild identity includes:

~~~
Environment Revision
CPU architecture
relevant source revision when source-aware
build implementation revision
~~~

Runner Pool indexes artifact availability but does not normally change the
portable Environment Revision or artifact content hash. Compute Class enters a
build key only when the produced artifact genuinely depends on it.

Exported artifacts and caches contain no platform-supplied build credential or
secret-mount value. If private-package installation is required during build, a
future builder may use ephemeral secret mounts that are unavailable after the
exact operation and are proven not to enter layers, logs, provenance payloads,
or exported caches. Until that path is implemented and tested, private build
secrets are a V1 non-goal. Customer-authored source may itself contain sensitive
content; scanning and policy are defense in depth and the resulting artifact is
classified as customer data.

Mutable caches are scoped by Organization, Project, and trust domain to prevent
cross-tenant poisoning. Only verified immutable public layers may be shared
globally.

The existing `SandboxProvider` is a Current E2B lifecycle adapter. It is not the
future Environment Builder, Runner Controller, or portable Environment model.
Those contracts remain separate rather than growing provider-specific fields
on mutable repository configuration.

### 16.5 Outer environment versus workspace container

The stable abstraction is:

~~~
Execution Environment
  isolation, lifecycle, volumes, network

Workspace Environment
  devcontainer-compatible files, tools, services, and human/agent processes
~~~

Some providers may implement these as a VM containing an inner container.
Others may use a pod or microVM whose primary container is the workspace
environment. The product contract should not require nested Docker everywhere.

The Target trust split is explicit:

~~~
Outer trusted Target namespace
  Supervisor
  Worker
  AnyHarness control/state
  target-side relay component
  credential and effect broker clients
  protected runtime home and control sockets

Inner untrusted workspace namespace
  repository and worktrees
  devcontainer setup/lifecycle hooks
  agent CLIs and shell
  human terminal processes
  development services and ports
~~~

Runner Controller remains outside both and holds pool/provider authority.
AnyHarness reaches the workspace through controlled mounts and launches agent,
shell, and service processes through a sandbox executor into the untrusted
namespace. Supervisor owns outer trusted process lifecycle and the inner
workspace-container lifecycle.

Humans and agents share the workspace data plane, not the trusted control
identity. The same repository bytes, tools, processes, services, ports, and git
state are visible through agent sessions and human terminals. Neither receives
Worker identity, AnyHarness data keys, relay identity, provider credentials, or
outer control sockets.

A provider-specific implementation may realize equivalent namespaces without
nested Docker, but it must pass the same adversarial conformance tests. If a
Compute Class cannot prevent the untrusted workspace from reading runtime state,
credentials, sockets, or process memory, label it weak/unprivileged and forbid
privileged capabilities.

### 16.6 Workspace Executor and process boundary

AnyHarness remains in the trusted outer namespace because it owns control APIs,
session and workflow state, transcripts, authorization context, and runtime
credentials. Agent CLIs do not run as direct children in that namespace.

AnyHarness depends on one target-local `ExecutionBackend` interface. The
Current direct implementation remains valid for user-trusted local Desktop
work. Remote strong-isolation Compute Classes use a trusted Workspace Executor
that enters the inner namespace.

The minimum executor contract is versioned and Target-fenced:

~~~
create or inspect workspace environment
exec with argv, relative cwd, run user, bounded env, limits, and operation ID
exec with PTY
stream stdin, stdout, stderr, and PTY frames with ordering and backpressure
signal, resize, inspect, and terminate
stop and destroy the workspace environment
~~~

Every request binds Target ID, an opaque executor-environment handle, Workspace
or Execution identity, and an idempotency key. The handle is target-local, not
a new Cloud epoch. The executor rechecks that the handle belongs to the active
Target. It does not interpret workflows, authorize product actions, choose
compute, schedule work, or hold pool/provider credentials.

The recommended strong topology uses a very small privileged target-local
executor process, provisionally called `sandboxd`, rather than giving
AnyHarness a Docker/containerd socket. Supervisor starts and monitors it and the
workspace environment; AnyHarness owns execution semantics over a protected
local transport. This name is an implementation recommendation, not a durable
Cloud resource.

The protected transport is a Unix socket, inherited file descriptor, vsock, or
provider-equivalent channel that is not mounted or reachable inside the
workspace. ACP still terminates in AnyHarness, but its stdio pipes come from an
executor-launched agent. Human terminals use executor-provided PTYs. Workflow
shell steps, setup hooks, tests, hosting CLIs, MCP subprocesses, and git commands
all use the same backend. A cloud execution path with a stray direct
`Command::new` is a boundary violation.

Files may be served by AnyHarness from a shared workspace volume only through
root-confined, symlink-safe operations. Git commands execute in the inner
environment so hooks, config, credentials, and tool versions match the agent
and human terminal environment. The outer namespace never executes repository
code.

The storage-lifetime split is explicit:

~~~
ephemeral Target identity state
  Worker database, Target enrollment, bootstrap material, relay identity
  dies with the Target and is never restored into a replacement Target

outer runtime-ledger state
  AnyHarness database, session/workflow cursors, effects, observation outbox
  protected prompt attachments and required runtime-owned agent artifacts
  durable across process restart in one Target
  portable across Targets only through an explicit verified ledger snapshot
  never mounted inner

shared workspace volume
  repository and worktrees
  outer file APIs plus inner agent/human processes

inner ephemeral state
  container overlay, HOME, /tmp, /run, processes, PTYs, and services

scoped cache volumes
  explicit Project/trust-domain cache policy; never control state
~~~

Do not place Worker identity and recoverable AnyHarness state in one
indivisible snapshot. Restoring the first would resurrect stale Target
authority; restoring the second may be legitimate only after recovery fencing,
version migration, and effect reconciliation.

The inner environment has separate PID, mount, IPC, user, cgroup, and network
boundaries where the provider supports them. It receives no host container
socket, metadata-service path, outer process visibility, outer runtime home, or
unrestricted private-network access. Approved workspace services are forwarded
only through declared ports and short-lived scoped tickets.

Control credentials remain outer. If an agent must call a model or tool, it
receives only a short-lived, audience-bound, budget-bound capability for that
session or the endpoint is exposed through a broker. Git uses a repository- and
operation-scoped credential broker instead of a plaintext upstream token.
Platform-materialized secrets intentionally needed by customer code are
explicitly classified as agent-visible, mounted into inner ephemeral storage,
and excluded from logs, checkpoints, caches, and artifacts by path/transport
policy. Customer-authored files may still contain sensitive content and remain
classified accordingly.

If AnyHarness or the executor dies, Supervisor must terminate or prove the
quiescence of inner children before restarting the control runtime. V1 recovery
promises durable transcripts, artifacts, and recoverable workspace bytes—not
survival of live agents, PTYs, or development services.

### 16.7 Devcontainer compatibility boundary

V1 must publish an explicit supported subset and fail unsupported fields rather
than silently ignoring them. The decision covers:

- image and Dockerfile
- features
- lifecycle hooks
- services or Compose
- mounts and host mounts
- ports
- user and UID behavior
- architecture
- Docker socket or Docker-in-Docker
- privileged mode, run arguments, Linux capabilities, and devices

Setup/build hooks are adversarial and execute only in isolated build or
workspace namespaces. Host mounts, privileged mode, Docker sockets, devices,
and equivalent authority are denied by default and require an explicitly weaker
Compute Class or customer-owned policy.

The honest initial subset is image or Dockerfile/context, one normalized run
user, workspace folder, literal non-secret environment, a bounded
after-checkout/post-create hook, and declared ports. Compose, arbitrary host
mounts, Docker-in-Docker, privileged mode, devices, capabilities, host-dependent
substitution, IDE customization, and unsupported lifecycle hooks fail with
structured errors rather than being silently ignored. Features enter only when
their versions and artifacts can be resolved immutably.

## 17. Common work model

Product-level objects remain distinct but compile into shared execution
contracts.

### 17.1 Interactive Workspace

A Workspace is durable. When active, it has a current Execution Environment.
When stopped or replaced, its sessions, artifacts, review state, and recoverable
workspace state survive according to policy.

A prompt sent to an active Workspace does not schedule a new sandbox. It enters
the existing AnyHarness session through the Runtime Gateway.

A prompt sent to a dormant Workspace creates or waits for an activation, then
delivers the command after the new Target is ready.

### 17.2 Workflow

Target: a trigger creates a WorkflowRun. The server freezes the selected
version, inputs, policy, exact source intent, and Deployment binding.
AnyHarness interprets the resolved plan.

Current: authenticated manual StartRun plus authored schedule and poll paths
exist, but there is no Workflow Deployment, exact source/binding and secret
separation are incomplete, and webhook/chat/agent/service API triggers are not
complete production paths.

The server does not advance individual workflow steps.

### 17.3 Generic Task

A repository-optional Task has a goal, typed inputs, an output contract,
environment, identity, capability policy, and budget. It uses the same
Execution and Attempt substrate.

### 17.4 Persistent Agent Service

A future long-lived functional agent should normally be:

~~~
Agent Deployment
  durable inbox
  memory and checkpoints
  identity and capabilities
  policy and budget
  triggers
  repeated bounded activations
~~~

It should not initially be modeled as an immortal VM. A persistent agent can
sleep, resume, upgrade, revoke capabilities, and recover through the same
Execution substrate. Truly continuous work may hold a longer lease when
justified.

## 18. Immutable execution contracts

Do not collapse all execution information into one giant specification.

The architecture has four conceptual durable layers. Bootstrap and
materialization use separate fenced transport envelopes before the final
private execution envelope; those messages are not additional sources of
truth.

### 18.1 Work Manifest

Work Manifest is a conceptual cross-workload view, not a fifth workflow
mega-contract and not permission to persist one unbounded JSON blob. It
describes the immutable, secret-free authorized work:

~~~
workload kind and payload
Organization and Project
initiated-by and executed-as
source intent
workflow version/plan when applicable
typed inputs
capability references
model and network policy
output and retention policy
budgetReservationId and policy revision
idempotency identity
~~~

For workflows, the authoritative four-contract model remains:

- authored definition
- Resolved Plan
- Execution Binding
- private Execution Envelope

The Work Manifest references or contains the relevant hashes; it does not
replace those contracts.

### 18.2 Environment Revision

The immutable description of the tools and workspace environment required by
the work.

### 18.3 Attempt Assignment, lease, and placement

Attempt Assignment is immutable:

~~~
Attempt ID and number
Runner Pool
Compute Class
work and environment hashes
assignment hash
~~~

Attempt Lease is mutable and renewable:

~~~
lease ID
attempt_lease_generation
owner controller identity
expiry
last renewal
~~~

Provider environment identity and observed state are recorded separately as
placement results. Assignment is stable; leases rotate. Placement is
replaceable only under the recovery rules. The logical work is not.

### 18.4 Bootstrap Envelope

Before Target enrollment, the Runner Controller places a one-use
BootstrapEnvelope into protected outer bootstrap storage. It contains:

- Attempt and pool identity
- attempt_lease_generation
- one-use Target enrollment credential
- expected Runtime Bundle Revision
- assignment/environment hashes
- expiry

It is bound to the currently active Attempt lease, inaccessible to the inner
workspace, rejected after lease loss or redemption, and deleted after use.

### 18.5 Materialization Offer

After Target enrollment but before final binding, the control plane sends a
one-use Materialization Offer containing:

- immutable assignment and source intent
- materialization-only source capability
- Attempt and Target identity
- active fence/expiry

The trusted target executor materializes or restores source and proposes the
exact Execution Binding. The offer is a transport message, not a mutable source
of truth.

### 18.6 Private Execution Envelope

The short-lived, private material delivered only after placement and binding:

- run-report credential
- scoped integration issuance handles
- private callbacks
- credential generation and expiry
- accepted binding

It never appears in ordinary list/detail APIs, prompts, transcripts, workspace
files, analytics, or durable public plans.

## 19. Execution lifecycle

### 19.1 Start and dispatch

1. A human, schedule, poll item, or another supported trigger requests work.
2. The control plane authenticates the actor.
3. Authorization and admission policy evaluate resource access, compute
   entitlement, execution identity, integration policy, network/model policy,
   budget, and concurrency.
4. Source intent and immutable configuration are resolved.
5. A logical WorkflowRun or Workspace activation and Execution are committed.
6. A budget reservation record and transactional outbox event are committed in
   the same transaction; the immutable work references the reservation ID and
   policy revision.
7. The scheduler creates or offers an Execution Attempt.

### 19.2 Placement

1. The scheduler filters authorized/admitted work to compatible pools by
   isolation, region, architecture, network, policy, and capacity.
2. A Runner Controller claims the Attempt with a renewable lease and
   attempt_lease_generation.
3. Every provider resource uses an idempotency/metadata identity containing
   pool ID, Attempt ID, and attempt_lease_generation.
4. Before create, the controller looks up and adopts an existing matching
   resource when valid.
5. Before every mutating provider call, it revalidates the active lease.
6. It provisions an environment, attaches the Workspace materialization or
   approved checkpoint storage, and verifies the Environment Artifact and
   Runtime Bundle.
7. It places the one-use Bootstrap Envelope in protected outer storage.

Lease loss requires the controller to stop new mutations, attempt immediate
safe cleanup, and report observed provider state. Ready, complete, and destroy
reports use compare-and-swap against the active lease generation. The control
plane owns lease expiry and orphan state; the controller is a replaceable
provider reconciler.

Persistent Workspace storage also uses a storage-level single-writer generation
or fence. Heartbeat-based exclusivity is insufficient.

### 19.3 Target readiness

1. Trusted bootstrap validates the active lease-bound Bootstrap Envelope.
2. Supervisor starts the outer trusted processes and inner workspace boundary.
3. Worker enrolls one fresh Target identity for this environment lifetime.
4. Duplicate enrollment with the same active bootstrap identity is idempotent;
   it cannot create two live Targets. Any stale or different enrollment fails.
5. Worker receives the immutable assignment and Materialization Offer.
6. Trusted materialization prepares source without exposing credentials to the
   inner workspace.
7. The executor proposes an exact Execution Binding.
8. The control plane accepts one binding for the active Attempt/Target.
9. The final private Execution Envelope is issued.
10. AnyHarness starts or restores the Workspace/Workflow execution.
11. A target-side relay component, whose exact process owner must be ratified
    in the Worker/Target spec, establishes outbound interactive routing.
12. Worker begins observation projection.
13. The Target becomes ready only after health, policy, binding, and read-back
    checks.

### 19.4 Execution

- AnyHarness owns sessions and workflow progress.
- Worker reconciles control intent and projects observations.
- Interactive clients connect through short-lived tickets.
- Model and tool calls pass through policy boundaries.
- Usage is metered with full attribution.
- Cancellation is desired state until the runtime reaches quiescence.

### 19.5 Completion

1. AnyHarness enters quiescing, closes admission, and stops all turns, process
   groups, background jobs, and pending execution work.
2. Every started external effect is persisted and reconciled, safely completed,
   or classified outcome-uncertain. Uncertainty determines terminal failure; it
   can never be discovered after an immutable success snapshot.
3. Required local checkpoint and artifact candidates are captured.
4. AnyHarness atomically persists terminal observed state plus the authenticated
   quiescence receipt.
5. Worker delivers the ordered terminal Workflow observation and required
   runtime projections.
6. Required artifacts/checkpoints are uploaded, verified, and accepted; the
   control plane durably acknowledges their receipts and terminal observation.
7. Usage is finalized, budget reservation reconciled, and execution authority
   revoked. Retained sessions are reassembled and acknowledged before release.
8. The WorkflowRun or Workspace activation projection becomes finalized.
9. Only then is the environment hibernated, retained, or destroyed according
   to policy.

### 19.6 Replacement and retry

A dead environment never reuses the same Target identity.

~~~
Execution
  Attempt 1
    Target target-a, lost
  Attempt 2
    Target target-b, current
~~~

Pre-acceptance provisioning failure may safely create a replacement Attempt
after fencing and provider reconciliation.

Post-acceptance runtime loss is different. A lease fence does not prove the old
agent or external effect stopped. The logical execution remains orphaned unless
the system proves runtime quiescence and has an accepted resume-safe recovery
manifest plus fully reconciled, non-uncertain effect state. In the future Target
architecture, only then may a new Attempt become continuation-eligible under a
fresh Target and binding. Pilot V1 never continues an accepted lost execution;
the user starts an explicit replacement WorkflowRun or read-only recovery
Workspace.

Late reports from target-a are rejected and audited. Non-idempotent uncertain
effects are never blindly repeated.

### 19.7 Epoch and fence meanings

Use exactly these identities:

- **attempt_lease_generation** fences Runner Controller provisioning ownership.
- **target_id** identifies one environment incarnation. It survives
  Worker/Supervisor process restart inside that environment and changes when
  the environment is replaced.
- **runtime_connection_generation** optionally changes when the AnyHarness or
  relay endpoint/credentials rotate within the same Target.

Controller provider mutations bind to attempt_lease_generation. Runtime
observations bind to target_id. Client tickets and stream/cache identity bind to
target_id plus runtime_connection_generation. Do not add a Target-level slot or
fence generation.

## 20. Truth and authority

The sandbox is authoritative for observed execution, but a replaceable physical
machine cannot be the only durable record.

| Concern | Authority |
| --- | --- |
| Organizations, resources, policy, access, budgets | Control-plane Postgres |
| Desired WorkflowRun/Execution state, Attempt assignment, lease, and recorded placement | Control-plane Postgres |
| Live session identity, workflow ordering, and observed agent execution | AnyHarness in the active Target |
| Active Workspace materialization, storage generation, and accepted recovery-manifest pointer | Control-plane Postgres plus storage-provider fencing evidence |
| Live file/worktree bytes | the attached filesystem/materialization |
| Recoverable AnyHarness ledger bytes | protected runtime-ledger storage or accepted encrypted ledger snapshot |
| Target identity, enrollment, and relay authority | active Target only; never a restored snapshot |
| Live processes and PTYs | ephemeral physical environment; not durable truth |
| Physical provider resources and capacity | provider API observed reality |
| Provider reconciliation | replaceable Runner Controller; never durable product truth |
| Accepted checkpoints and artifacts | approved artifact/customer storage |
| Team-visible status and history | monotonic server projection |
| Message delivery | broker/outbox only; never truth |
| Client UI state | never authoritative product truth |

### 20.1 Observations

Workflow observations follow the authoritative whole-ObservedRun durable outbox
contract. The workflow contract's immutable delivery identity remains exactly:

~~~
(run_id, plan_hash, binding_hash, execution_generation)
~~~

Attempt ID, Target ID, stream kind, and report sequence belong to the
authenticated Worker report envelope and server acceptance/CAS context unless
the focused Workflow contract and its Rust/Python/TypeScript fixtures are
deliberately revised. They do not silently alter the four-contract fixture.

Worker sends the observation plus its authenticated report context:

- stable WorkflowRun, step, slot, session, Attempt, and Target identity
- strictly increasing observation revisions
- whole ObservedRun snapshots for Workflow execution
- outputs and typed errors
- checkpoints and worktree identities
- timing and cost summaries
- terminal and quiescence state

Other runtime streams may use separately sequenced events. The server
compare-and-swaps the active Attempt/Target before accepting any stream.
Sequences do not continue implicitly across replacement Targets. Stale,
future-gap, or conflicting reports are rejected or resynchronized according to
their focused contract and are audited.

When the active Target is unreachable, the server reports unreachable or
unknown. It does not invent success or failure.

### 20.2 Projection policy

An Organization may select:

- full transcript and result projection
- redacted content projection
- metadata and approved artifacts only

Passive clients read projections without waking an environment. Live clients
connect to AnyHarness.

### 20.3 Durability model

Durability is hybrid:

- interactive Workspaces use persistent encrypted workspace and runtime-ledger
  storage plus immutable recovery manifests
- automated Workflow Attempts use ephemeral storage by default and export only
  acknowledged artifacts and recovery/rescue checkpoints; resume-safe
  continuation is not a Pilot V1 capability
- provider pause, memory snapshot, disk snapshot, or clone is an acceleration
  mechanism, never the canonical portable recovery contract

A persistent volume is not a backup. A server projection is not enough to
reconstruct AnyHarness workflow cursors, effect rows, session affinity, or
unprojected workspace bytes.

The physical states have different lifetimes:

| State | Interactive Workspace | Automated Workflow Attempt |
| --- | --- | --- |
| Product record and projected history | durable | durable WorkflowRun and observation history |
| Workspace data | persistent encrypted volume | ephemeral scratch from exact source/checkpoint |
| AnyHarness runtime ledger | protected persistent state for same-Target restart; checkpointed for recovery | ephemeral by default; same-Target crash recovery only in Pilot V1 |
| Target-private identity and credentials | ephemeral per Target | ephemeral per Target |
| Processes, PTYs, services, memory | never promised durable | never durable |
| Caches | disposable | disposable |
| Approved outputs | durable artifacts/checkpoints | durable artifacts/checkpoints |

An implementation may place interactive workspace data and runtime-ledger state
on one encrypted device, but they remain separate mount roots. Only workspace
data is mounted into the inner environment. Target-private state is never part
of either persistent root.

### 20.4 Materialization and single-writer fencing

One Workspace has historical Workspace Materialization generations over time.
At most one is current and writable. Pause/resume and same-Target process
restart retain the same identity with fenced lifecycle updates; new Target
rehydration creates a candidate row and storage generation rather than mutating
historical placement identity.

Every Workspace Materialization has:

~~~
materialization ID
Workspace ID
storage generation
desired and observed materialization state
assigned Attempt ID
current Target ID, nullable before enrollment or while detached
workspace-data storage reference
runtime-ledger storage reference
latest accepted recovery manifest
writer lease/fence metadata
last verified and checkpointed times
~~~

The monotonic `storage_generation` fences write ownership. It is distinct from
attempt_lease_generation, target_id, runtime_connection_generation, workflow
execution generation, and any session lease generation.

Activation follows this sequence:

1. Control plane creates non-current candidate generation N+1 for one intended
   Attempt and records replacement intent. The old current pointer remains, but
   new execution/effect admission closes during cutover. Target ID is null
   because enrollment has not occurred.
2. The controller proves the prior environment quiescent or destroyed, revokes
   its authority, and proves the prior volume detached.
3. The storage backend performs an exclusive read-write attach for the
   quarantined candidate where supported.
4. After Target enrollment, control plane compare-and-swaps that Target ID onto
   the candidate Attempt/materialization.
5. Supervisor validates Workspace, Target, and storage generation; restore and
   semantic read-back complete without public admission.
6. Only then does control plane atomically swap the Workspace's current-writable
   pointer to N+1, supersede the prior materialization, and issue fresh runtime
   and effect authority.
7. Every materialization report, checkpoint, detach, and recovery receipt binds
   the same identities and is rejected when stale.

A database lease or missed heartbeat never proves that an old writer stopped.
If the provider cannot prove exclusive detach or destruction, recovery is
blocked rather than risking two writers. Backend-native exclusive attachment,
process locks, and application fencing are complementary; none alone replaces
the others.

### 20.5 Recovery manifests and checkpoint contents

Two recovery-manifest classes have intentionally different promises.

These are acceptance classes on an aggregate recovery manifest. The manifest
references a Workspace Checkpoint and a separately encrypted Runtime Ledger
Snapshot. It does not merge workspace bytes and trusted runtime state into one
agent-readable archive. An interactive recovery manifest always includes both.

**Recovery manifest** references both a Workspace Checkpoint and a consistent,
encrypted Runtime Ledger Snapshot for an interactive Workspace. It restores
inspectable files and protected AnyHarness state. Previously live sessions
become interrupted. Terminals, processes, and services are gone. A human may
continue in a new session, but autonomous work does not silently resume.

**Resume-safe recovery manifest** additionally proves a workflow barrier, runtime
quiescence, reconciled effects, exact cursor/lease state, and a safe continuation
point. Only this class can make a future automated cross-Target resume eligible.
Pilot V1 does not claim this capability.

The immutable manifest binds at least:

- Organization, Project, Workspace or WorkflowRun, Execution, and Attempt
- source Target ID and storage generation
- Environment Revision, Environment Build artifact digest, and Runtime Bundle
- exact repository base and worktree/checkpoint content hash
- runtime-ledger backup digest and AnyHarness schema version when present
- required attachment and artifact digests
- last accepted observation revision and execution identity
- workflow step/lane cursor and effect-receipt frontier when applicable
- recovery-manifest class, encryption/key reference, retention class, and expiry

The Git worktree portion reuses the canonical workflow checkpoint contract:
base object, index state, worktree state, staged/unstaged changes, every eligible
non-ignored untracked file, symlinks, executable bits, and gitlinks. It does
not substitute `git status` text or only a branch tip.

The base commit must be reachable from an authorized durable remote or the
checkpoint must carry the required Git object closure. Ignored files, caches,
oversized files, registered secret-materialization paths, dirty submodules,
conflicts, and unsupported special files follow the focused checkpoint profile.
The exporter reports every excluded or blocking path; the UI does not claim
complete portable recovery when required data was omitted.

Checkpoint content excludes Worker database/token, Target identity,
enrollment/bootstrap material, runtime bearer and relay credentials, private
execution envelopes, broker capabilities, sockets, process memory,
platform-materialized ephemeral agent-visible secrets, and undeclared caches. A
runtime-ledger checkpoint uses a consistent SQLite online backup and a restore
scrub/migration; copying a live database and WAL files is not a checkpoint
protocol.

A Runtime Ledger Snapshot is subject-scoped. The strong remote topology uses
one unrelated Workspace activation or automated Attempt per AnyHarness ledger.
On a Current shared personal/Desktop runtime, a whole SQLite backup is never a
per-Workspace snapshot; recovery requires a logical subject-scoped exporter
that includes the complete required relational graph and proves that no
unrelated Workspace/session data escapes.

### 20.6 Recovery-manifest acceptance protocol

Only an accepted recovery manifest can be a recovery source:

~~~
requested -> exporting -> uploaded -> verified -> accepted
                                  -> rejected
~~~

The configured **Checkpoint Authority** constructs and signs the canonical
accepted Recovery Manifest. In managed/hybrid deployments it is a control-plane
service; in full self-hosting it is deployed with the customer's control plane.
The Target does not become its own acceptance authority. Worker sends
Target-authenticated reports and protected Workspace Executor evidence; hosted
or customer storage gateways send separately signed storage receipts. The
Checkpoint Authority verifies both and constructs the canonical immutable
manifest. In one fenced acceptance operation it signs and atomically records the
accepted manifest while advancing the accepted pointer. If the compare-and-swap
fails, the candidate remains unaccepted; a signature without an accepted
authority record is not a recovery source.

Checkpoint-Authority and customer-storage-gateway verification keys are
enrolled, Organization/deployment scoped, versioned, rotated, revocable, and
audience-separated. Signatures bind schema/version, manifest or receipt hash,
immutable object versions and digests, Organization, Workspace/WorkflowRun,
Attempt, Target, storage generation, nonce/idempotency identity, issue/expiry
times, signer key ID, and audience. A stale Target, expired/revoked signer, wrong
audience, or replayed receipt fails acceptance and restore. Current Worker bearer
identity is authentication input, not an implicit signing key.

1. Control plane allocates immutable proposed manifest/component IDs and
   requests export for the active Target and storage generation.
2. AnyHarness closes new execution admission.
3. A resume-safe request reaches a workflow barrier and reconciles effects.
4. Workspace processes stop or reach the required frozen boundary.
5. Workspace Executor attests the relevant cgroup/PID namespace empty or
   destroyed and AnyHarness persists the local Quiescence Receipt.
6. AnyHarness flushes state and creates a consistent runtime-ledger backup.
7. Workspace Executor captures the Workspace Checkpoint/snapshot.
8. A trusted outer uploader writes encrypted blobs through one-use scoped
   storage authority.
9. Worker reports Target-authenticated candidate metadata, component digests,
   Quiescence Receipt, and protected Workspace Executor evidence. It does not
   sign or accept the canonical Recovery Manifest.
10. Verification follows the selected storage topology. A hosted store uses
   checksum-enforced conditional upload plus authenticated read-back/decrypt
   verification. A customer-private store returns a signed customer storage
   gateway receipt binding immutable object version, digest, size,
   encryption/key metadata, Target ID, storage generation, and successful
   read-back. Existence or `HEAD` alone is insufficient.
11. Checkpoint Authority constructs the canonical Recovery Manifest, signs it,
    and atomically compare-and-swaps the signed accepted record and
    recovery-manifest pointer for that generation.
12. Only after acceptance may a durability-dependent detach, destroy, prune, or
    archive complete.

Failed export never advances the accepted pointer. A later checkpoint is a new
immutable object, not an in-place mutation.

#### 20.6a Restore protocol

Restore is separately fenced and fail-closed:

1. Control plane creates a non-current Workspace Materialization generation and
   issues scoped outer-only download authority.
2. Trusted restore code downloads exact immutable object versions into fresh,
   quarantined volumes with bounded size, decompression, path, symlink, and
   resource handling.
3. It verifies manifest signature, ciphertext and plaintext digests, Git object
   closure, source lineage, and every referenced object before extraction is
   trusted.
4. Runtime-ledger state is scrubbed and schema-migrated offline. Target-scoped
   rows, credentials, claimed leases, report authority, ephemeral integration
   bindings, and live-process status are removed or re-resolved.
5. AnyHarness and Workspace Executor start without public admission and perform
   health, filesystem, ledger, and semantic read-back checks.
6. Only after every check passes does control plane compare-and-swap the new
   Target/materialization to current and issue fresh capabilities.

A failed restore leaves the accepted recovery manifest immutable and the new
generation non-current and non-writable by users/agents. Cleanup can retry or
remove that failed generation without altering the previous source.

### 20.7 Pause, hibernate, archive, and purge

These operations are not synonyms.

- **Provider pause** retains the same environment and Target. It may accelerate
  resume, but the product does not promise live PTY/process survival. An abrupt
  timeout pause enters suspect state until the same Target recovers.
- **Graceful suspend** closes admission, quiesces or checkpoints, then pauses
  the same Target. Resume uses the same storage writer and Target identity;
  endpoint rotation may advance runtime_connection_generation.
- **Hibernate/dehydrate** accepts a recovery manifest, detaches storage, and
  ends the Target. Rehydration creates a fresh Target and storage generation.
- **Archive** changes the durable Workspace lifecycle and requests safe
  dehydration. A cleanup blocker does not erase history or undo the archive.
- **Purge** is the only destructive product operation. It revokes access,
  destroys wrapped keys subject to legal hold, and asynchronously deletes live
  volumes, checkpoints, artifacts, and product history under policy.

The existing Workspace versus Worktree distinction in
[`../codebase/primitives/workspace-lifecycle.md`](../codebase/primitives/workspace-lifecycle.md)
remains authoritative. Cloud archive, AnyHarness retire, mobility export, and a
recovery manifest are four different operations and must not be conflated.

### 20.8 Recovery decision model

Recovery is derived from independent desired, delivery, observed, health,
storage, and checkpoint evidence. Do not add one overloaded recovery status.

~~~
unaccepted
  -> replaceable after pre-accept fencing

active
  -> suspect
       -> recovering on the same Target
       -> orphaned

active
  -> quiescing
  -> quiescent
  -> finalized

orphaned
  -> replacement eligible only after every proof gate
~~~

Same-Target process recovery requires the same Target and exclusive storage
generation, valid/migrated AnyHarness ledger, contiguous observation outbox,
matching session/execution leases, and classification of every started effect
before admission reopens.

Every external effect uses a stable logical identity derived from WorkflowRun,
step key, step attempt, effect sequence, and kind; producer Attempt/Target are
recorded separately. The runtime freezes destination/payload/policy hashes,
persists intent fail-closed before invocation, and persists or reconciles the
result before advancing the cursor. Recovery may reattach/resume the same
process, or reconcile/query the same durable external operation. A fresh replay
is permitted only with provider-enforced idempotency or a proven no-effect
boundary. An arbitrary author-provided replay string is not proof.

Quiescence is an authenticated durable receipt, not a boolean inferred from a
terminal run row. It binds the immutable delivery identity, Target ID, storage
generation, cancel/control command when applicable, active session lease
generations, an empty process-registry revision/hash backed by Workspace
Executor attestation that the entire cgroup/PID namespace is empty or destroyed,
effect-ledger
revision/hash, last session and observation sequences, and locally captured
checkpoint/artifact candidate identities when applicable. It proves that
nothing can still execute independently of object-store or control-plane
availability. The server validates quiescence before projecting cancellation as
terminal; separately accepted checkpoint/artifact receipts are required for
finalization, session release when applicable, cleanup, and cross-Target
recovery.

A separate Finalization Receipt binds the acknowledged terminal observation,
required server-accepted recovery manifest/artifacts, finalized usage, revoked
authority, and retained-session reassembly/release. Quiescence can therefore
succeed while artifact storage is unavailable without permitting premature
cleanup.

An interactive Workspace may recover on a new Target from its latest accepted
recovery manifest. Restore scrubs every old Target credential, report authority,
claimed workflow/session lease, and live-process status. Nonterminal
WorkflowRuns remain orphaned; old sessions become interrupted read-only history,
and new interactive work receives new session identity. The client loads
permitted durable history from the configured projection or customer store
immediately, then shows restoring/recovered state, checkpoint time, and any
possible uncheckpointed interval. A new AnyHarness workspace/runtime identity is
explicitly bridged to the stable Workspace identity.

Before that recovered Workspace becomes the authoritative writable
materialization, the old Target must be hard-destroyed or positively quarantined,
every revocable model/tool/Git/relay/integration capability revoked, and every
non-revocable authority expired or accounted for. If an old agent may still
perform an external effect, authoritative recovery is blocked and uncertainty
is shown. A separately labeled read-only rescue copy may be created with weaker
proof because it cannot become the current writer or receive effect authority.

An accepted automated execution lost with its Target becomes orphaned in Pilot
V1. It is never automatically resumed or retried. A user may create a distinct
replacement WorkflowRun or recovery Workspace after reviewing uncertain-effect
risk.

Future cross-Target workflow continuation requires all of:

- authenticated old-Target quiescence or provider hard-destroy evidence plus
  revocation of every old execution authority
- accepted resume-safe recovery manifest referencing both the Workspace
  Checkpoint and Runtime Ledger Snapshot
- every effect completed, safely replayable with enforced idempotency,
  or reconcilable by durable external identity; any outcome-uncertain effect
  categorically blocks continuation of that WorkflowRun
- exclusive transfer to a new storage generation
- exact original plan and source lineage plus Environment and Runtime Bundle
  compatibility
- accepted observation cursor and fresh capability issuance
- explicit portability for every bound session

The continuation uses a fresh Attempt, Target, execution generation, and
immutable Execution Binding. This future capability requires a deliberately
versioned Workflow `ExecutionBinding` contract and shared fixture extension for
recovery-manifest identity and parent-binding lineage; V1 binding fields cannot
encode it and mutable transport metadata may not smuggle it in. The new binding
never mutates or pretends to reuse the old materialization/executor identity.
Until that contract is ratified—or if any proof is absent—the execution stays
orphaned. Lease expiry alone satisfies none of these gates.

### 20.9 Finalization, retention, and provider mapping

A successful automated materialization may be removed only after terminal and
quiescent observation, required checkpoint/artifact receipt, effect
reconciliation, usage finalization, capability revocation, and server
acknowledgment. Failed, conflicted, outcome-uncertain, and orphaned rescue state
uses a bounded operator-visible retention policy rather than silent deletion.

Provider mapping preserves the same semantics:

| Provider | Interactive live state | Portable recovery | Fencing rule |
| --- | --- | --- | --- |
| Current E2B | same-sandbox filesystem and pause/resume | application checkpoint required for killed/replaced sandbox | no cross-Target recovery claim until checkpoint and exclusive-writer contract exist |
| Kubernetes | separate protected runtime and workspace `ReadWriteOncePod` PVCs for the strong class; ephemeral Target state | application checkpoint; CSI snapshot only after quiescence as an optimization | exclusive pod attachment plus generation and confirmed prior-pod termination; ordinary `ReadWriteOnce` is insufficient |
| Customer Docker | separate named volumes/mount roots | customer object storage such as S3-compatible storage | destroy/verify prior container; no automatic cross-host failover without exclusive volume driver |
| Customer VM/microVM | persistent encrypted block storage plus inner container | application checkpoint plus optional volume snapshot | provider-exclusive attach and confirmed prior-VM destruction |

Customer-hosted checkpoint bytes and keys may remain entirely in customer
storage. Hosted Cloud needs only identities, hashes, policy, health, and approved
projections.

Recovery manifests, Workspace Checkpoints, and Runtime Ledger Snapshots are more
sensitive than ordinary build artifacts. List, read, restore, delete, legal-hold,
and policy-management capabilities are separately authorized and audited.
Checkpoint blobs use envelope encryption with explicit Organization/Workspace
or Execution key ownership, versioning, rotation, restore availability, and
per-object/subject DEK lifecycle. Purge and cryptographic deletion respect
shared-object references rather than assuming removal of one wrapped key erases
all copies.

Retention and garbage collection account for incremental/base dependencies,
legal holds, quotas, failed uploads, objects orphaned by a lost acceptance CAS,
customer-storage outages, and restore tests. Live-volume retention and
checkpoint retention are independent policies.

## 21. Runner architecture

### 21.1 Runner Pool

A Runner Pool describes a capacity/trust domain:

- managed or customer-owned
- provider and region
- allowed Organizations/Projects
- available Compute Classes
- isolation and network characteristics
- controller identity
- health, drain, and capacity
- update channel

A pool is not one machine and never one shared developer sandbox.

### 21.2 Compute Class

Compute Classes make resource and policy choices explicit:

~~~
CPU and memory
disk and persistence
GPU
architecture
region
isolation class
network/egress profile
maximum duration
price/metering
prewarm eligibility
~~~

The named class and Pool are mutable administrative shells. Project approval
and every Execution pin immutable Pool Policy and Compute Class Revisions.
Controller capacity advertisements may report support for those revisions; they
never create or mutate product policy.

### 21.3 Runner Controller

The controller:

- enrolls and rotates its pool identity
- advertises Compute Classes and capacity
- claims and renews Attempt leases
- provisions and destroys environments
- reports provider state
- drains and updates capacity
- injects one-use Target enrollment material
- performs orphan detection and cleanup

The controller does not:

- interpret workflows
- own product policy
- expose provider credentials to the workload
- serve as the per-Target Worker
- connect directly to the product database or RabbitMQ

### 21.4 Provider drivers

The same controller contract supports:

- E2B as the first managed adapter
- AWS VM or microVM capacity
- Kubernetes
- Docker/static hosts for constrained self-hosting
- future cloud or on-premise providers

Provider-specific provisioning stays behind a driver. Product resources and
execution semantics do not branch by provider.

The Runner Plane is not an attempt to replace every generic sandbox provider
immediately. E2B and future providers supply physical isolation primitives.
Proliferate owns the higher-level contract tying Projects, environments,
workflow/workspace lifecycle, identity, policy, human access, observations, and
cost to that capacity.

The same logical contracts map to providers as follows:

| Concern | E2B | Kubernetes | Customer Docker or VM |
| --- | --- | --- | --- |
| Environment artifact | provider template or compatible OCI artifact | OCI digest | OCI digest; VM is the runner host |
| Trusted Runtime Bundle | converged after boot even if a bootstrap bundle is prebaked | trusted init/sidecars or host layer | host/controller mounts or installs signed bundle |
| Workspace storage | sandbox disk or attached volume | `emptyDir` or PVC by policy | per-Workspace/Attempt volume |
| Inner boundary | provider-supported namespace/container; otherwise weak class | hardened pod/microVM with separated control and workspace containers | inner OCI container inside isolated host/VM |
| Control | outbound Worker plus runtime relay | same | same |

E2B is the first managed adapter, not the semantic baseline. Its current
single-user template may be represented as a synthetic legacy Environment
Build while the immutable contracts land. If the provider cannot pass the
outer/inner isolation suite, the resulting Compute Class remains
`cohosted_unprivileged`: it may support beta workflows with least-privileged
credentials but not Service Principals, production integrations, customer
private-network access, or hardened-enterprise claims.

### 21.5 Isolation and economics

The security boundary is one unrelated Workspace activation or automated
Attempt.

Multiple intentionally cooperating agents and worktrees inside one workflow
may share one environment. Unrelated Runs or users do not share mutable
runtime processes or disks.

The platform does not require one EC2 instance per agent. Economics come from:

- shared underlying pool nodes
- containers, microVMs, or pods by isolation class
- prebuilt images
- warm capacity
- hibernated interactive Workspaces
- ephemeral automated environments
- shared immutable caches
- right-sized Compute Classes

Plain containers may be an explicitly weaker isolation class. Sensitive
managed workloads should use VM, microVM, Kata, gVisor, or comparable
boundaries according to threat model.

## 22. Worker and Supervisor boundaries

### 22.1 Proliferate Worker

One Worker represents one Target.

It owns:

- Target enrollment and credential rotation
- desired-state command polling/reconciliation
- assignment and materialization coordination
- AnyHarness event tail
- monotonic projection delivery
- heartbeat and inventory
- checkpoint and shutdown coordination
- update coordination with Supervisor

Interactive relay establishment belongs to a target-side relay component. Its
exact process owner is not ratified by this memo because the authoritative
Worker contract currently owns only control polling, event tail, and heartbeat.
Do not add relay ownership to Worker without amending that focused contract.

It does not own:

- pool capacity
- provider scheduling
- multi-environment placement
- product authorization policy
- workflow interpretation

### 22.2 Supervisor

Supervisor owns:

- start AnyHarness
- start Worker
- start and monitor the Workspace Executor when the Compute Class uses one
- restart Worker independently
- restart both when the runtime fails
- trusted outer process lifecycle
- inner workspace-container lifecycle
- local health
- versioned apply/rollback mechanics
- graceful shutdown

It does not own:

- Cloud API policy
- runner scheduling
- product resource CRUD
- integration authorization

Supervisor is the sole component that applies outer Runtime Bundle updates. A
target update drains new admission, asks AnyHarness to checkpoint/quiesce,
terminates inner work, verifies the signed bundle, atomically switches versions,
health-checks, advances the runtime connection generation, and rolls back on
failure. Worker reports and requests desired state; it does not independently
replace itself or sibling binaries in the Target design.

### 22.3 Workspace Executor

The Workspace Executor is target-local infrastructure, not a product domain.
It owns only namespace/container creation and the narrow process/PTY lifecycle
contract in Section 16.6. It receives immutable local launch material from the
trusted Target, never Cloud policy or pool/provider authority.

It does not own:

- workflow or session meaning
- authorization or integration policy
- source-of-truth state
- Target enrollment or Cloud communication
- build orchestration or runner placement

### 22.4 AnyHarness

AnyHarness owns:

- Workspace and Session APIs
- HTTP, SSE, and WebSocket runtime surfaces
- transcripts and events
- files, git, terminals, and tools
- the logical ExecutionBackend abstraction used by every executable action
- harness adapters
- workflow interpretation
- workflow step attempts and emitted state
- local execution truth

There is one workflow interpreter. Server/Celery code must never become a
second interpreter.

## 23. Background orchestration

The background plane manages durable product work, not agent execution.

Target design:

~~~
Postgres = durable intent and state
transactional outbox = committed delivery intent
RabbitMQ/Celery = delivery and bounded background tasks
Beat = periodic discovery
Runner protocol = external capacity claims
AnyHarness = long-running agent execution
~~~

Schedules and polling:

1. Discover due work.
2. Commit an idempotent WorkflowRun or activation intent.
3. Commit an outbox row when external follow-up is required.
4. Deliver after commit.
5. Advance schedule/poll cursor only after durable representation.

No workflow-specific infinite scheduler loop should become permanent
architecture. Network I/O does not occur while holding a database transaction
or row lock.

Every external operation uses:

~~~
prepare durable intent
  -> commit
  -> perform external I/O
  -> apply result with compare-and-swap
~~~

## 24. Workflow architecture

### 24.1 Definition

A Workflow Definition contains:

- typed inputs
- ordered agent roles and parallel groups
- harness/model selection
- prompt, emit, shell, branch, include, SCM, and notification steps
- goals and deterministic verification
- declared capability requirements
- failure behavior

### 24.2 Version

Target: saving a meaningful change creates an immutable Workflow Version. A
WorkflowRun pins the complete expanded version and included-version provenance.

Current: include expansion occurs at StartRun, but explicit complete child
version provenance/hash retention remains a migration item.

### 24.3 Deployment

A Workflow Deployment binds:

~~~
Organization and Project
Workflow Version
Environment Revision
execution principal
integration/capability bindings
Runner Pool constraints
default Compute Class
model/network policy
triggers
visibility and access
Cost Center and budget
projection and retention policy
status
~~~

Triggers attach to Deployments, not portable Definitions.

The relational shape is a mutable installation identity plus immutable
operational revisions:

~~~
workflow_deployment
  id UUID primary key
  organization_id UUID not null
  project_id UUID not null
  slug
  display_name
  status draft | active | paused | retired
  access_mode inherit_project | restricted
  current_revision_id UUID nullable
  created_by_subject_id UUID
  created_at

workflow_deployment_revision
  id UUID primary key
  organization_id UUID not null
  workflow_deployment_id UUID not null
  revision_n
  workflow_version_id UUID not null
  environment_revision_id UUID not null
  execution_identity_mode caller_self | service_principal
  execution_principal_binding_id UUID nullable
  service_principal_subject_id UUID nullable
  cost_attribution_mode inherit_project | initiator | executing_principal | fixed
  fixed_cost_center_id UUID nullable
  default_compute_class_revision_id UUID not null
  model_policy_revision_id UUID not null
  network_policy_revision_id UUID not null
  concurrency_policy_binding_id UUID not null
  result_visibility
  retention_policy_revision_id UUID not null
  binding_digest
  created_by_subject_id UUID
  created_at

workflow_deployment_principal_binding
  id, organization_id, project_id, workflow_deployment_id
  service_principal_subject_id
  valid_from, expires_at nullable, revoked_at nullable
  authorized_by_subject_id, approved_by_subject_id nullable
  authorization_decision_id

workflow_deployment_compute_class_revision
workflow_deployment_integration_binding
workflow_deployment_budget_policy
workflow_deployment_trigger
~~~

Checks require both principal-binding fields exactly when mode is
`service_principal`; `caller_self` leaves both null. At run time the executed-as
subject must resolve to an active Membership or Service Principal, and
unattended activation requires Service Principal mode. The principal binding
requires durable `bind_to_deployment` authority, is separately
revocable/expirable, and is revalidated at Deployment activation, every
StartRun, scheduler dispatch, and every privileged credential/effect issuance
through revision-aware tickets. Deployment Compute Class Revisions
must be a subset of the Project's exact approved revisions. Integration rows
bind exact Connection capabilities; triggers and input presets reference a
Deployment Revision or cause a new revision when their operational meaning
changes.

Every WorkflowRun pins the Deployment Revision, Workflow Version, Environment
Revision, exact Compute Class Revision selected at admission, identities, Cost
Center, payer, and decision evidence. Editing the Deployment never changes a
queued or historical run.

### 24.4 WorkflowRun

Target: manual, schedule, poll, webhook, API, chat, and agent triggers all call
one StartRun service. A trigger never interprets a step or constructs a partial
plan.

Current: authenticated manual StartRun and authored schedule/poll paths exist.
Webhook, service API, chat, and agent trigger paths are not complete production
callers.

### 24.5 Execution

AnyHarness interprets:

- ordered sequential steps
- session/slot affinity
- parallel lanes and worktrees
- structured emitted state
- deterministic branches
- attempt and effect identity
- crash recovery
- cancellation and quiescence

The server owns:

- definitions, versions, deployments, and triggers
- WorkflowRun intent and desired state
- immutable policy and bindings
- delivery and claim state
- monotonic observations
- external effect brokering
- budget, usage, and audit

### 24.6 Team results

A team-visible WorkflowRun should expose:

- status and current stage
- initiating and execution identities
- Project, environment, source, and compute
- sessions and live connection when permitted
- structured outputs
- changed files and diffs
- tests and verification
- artifacts and PRs
- cost and duration
- errors, intervention, and cancellation
- audit and policy decisions

### 24.7 Evaluation and improvement

A software factory must measure quality, not only execution.

Target Workflow Deployments may attach:

- historical/golden cases
- deterministic checks
- human acceptance labels
- quality and intervention metrics
- cost/latency targets
- model/harness comparison
- candidate Workflow Version shadow runs
- promotion and rollback policy

The platform records which Workflow Version, harness, model, environment, and
policy produced an accepted or rejected outcome. This creates an improvement
loop without requiring customer content to become global training data.

## 25. Integrations, capabilities, and secrets

### 25.1 Integration policy

An Integration Connection is Organization-owned. Access can be granted to:

- Projects
- Access Groups
- Service Principals
- Workflow Deployments
- interactive users

Workflow Definitions declare exact capability requirements. Deployments bind
those requirements to approved connections and policy.

Effective authority is:

~~~
principal and Organization policy
  intersect environment ceiling
  intersect Workflow-declared exact capabilities
  intersect slot/session subset
  intersect current-step activation
  intersect live revocation policy
~~~

Namespace-wide grants are a Current migration exception, not the Target.

### 25.2 Secret handling

Persistent contracts store only symbolic requirements or authorized binding
references, never secret values. More precisely:

- Environment Revisions declare symbolic secret/connection slots.
- Workflow Deployments and interactive policy bind those slots to approved
  Integration Connections or secret references.
- Work execution resolves only the authorized binding after placement.

Secrets are:

- resolved only after scheduling and binding
- scoped to principal, WorkflowRun/Execution, step/session, target_id, and
  destination
- short-lived where the provider allows
- held in trusted brokers and outer Target storage, outside agent-readable files
  and process environment
- rotated and revoked
- never logged or projected

Only explicitly approved short-lived capabilities reach an agent-facing tool
boundary. Raw privileged secrets do not. Exported Environment Artifacts,
prebuilds, and shared caches contain no platform-supplied credential or
secret-mount value; customer-authored artifacts remain sensitive customer data.

### 25.3 Trusted effect broker

Privileged actions use a trusted effect plane.

Examples:

- production database query
- exact SSH diagnostic command
- create/update pull request
- deploy or rollback
- Slack/email/customer message
- IAM or infrastructure change

An effect records:

~~~
WorkflowRun/Execution, step, and Attempt
workflow/version/plan/binding hashes
target_id and runtime_connection_generation where relevant
initiated-by, executed-as, approved-by
exact destination and payload hash
policy decision
idempotency/reconciliation identity
credential issue/use/revoke
result or outcome-uncertain
~~~

Approval is exact-payload, one-use, short-lived, and server-authenticated. Agent
prose or a native harness permission dialog is not a trusted approval.

## 26. Communication planes

Keep four channels separate.

### 26.1 Control plane channel

~~~
Control Plane <-> Worker
~~~

Desired revisions, start, cancel, suspend, resume, checkpoint, shutdown, health,
and acknowledgements. At-least-once and idempotent.

### 26.2 Interactive runtime channel

~~~
Web/Desktop/API -> Runtime Gateway/Relay -> AnyHarness
~~~

Chat, sessions, files, git, terminal, SSE, WebSockets, and approved ports.

### 26.3 Model and integration channel

~~~
AnyHarness/agent -> Model or Integration Gateway -> provider
~~~

Routing, policy, credentials, receipts, model usage, and tool execution.

### 26.4 Projection channel

~~~
Worker -> Control Plane
~~~

Sequenced events, complete snapshots, artifacts, usage, health, and completion.

Schedules are not a fifth runtime channel. They create durable WorkflowRun or
activation intent in the control plane.

## 27. Runtime Gateway and Relay

Retain the gateway model and generalize its resolver.

Current:

~~~
authenticated user -> personal sandbox
~~~

Target:

~~~
authorized Workspace, WorkflowRun, or Execution
  -> current active Target
  -> runtime connection generation
  -> short-lived scoped connection ticket
~~~

The resolved connection contains:

- gateway/relay address
- Workspace, WorkflowRun, or Execution scope
- AnyHarness Workspace identity
- Target identity
- runtime connection generation
- stable connection key derived from Target plus connection generation
- allowed capabilities
- short-lived connection ticket and expiry
- WebSocket authentication transport

Clients never receive the permanent AnyHarness bearer.

Target ID plus runtime_connection_generation participates in query, stream, and
cache identity. Replacing an environment changes Target ID. Rotating an
endpoint or credential inside one Target changes the connection generation.
Either change closes stale streams and invalidates stale runtime state.

Token rotation alone does not fragment client caches. A Target or connection
generation change does. On ticket expiry the client re-resolves once; on Target
replacement it closes old HTTP/SSE/WebSocket state, invalidates runtime caches,
and follows the Workspace recovery policy. Passive projected reads never
resolve a live ticket and never wake compute.

Customer-hosted Targets and controllers connect outbound so customers do not
need inbound firewall openings.

For high-security deployments, code/file/terminal traffic may remain inside a
customer-hosted relay or private endpoint. The hosted control plane may retain
only metadata and approved projections.

### 27.1 Services and ports

The runtime contract includes declared development services rather than raw
provider URLs. A service has a stable logical identity, source/command,
health/status, internal protocol and port, and exposure state. A port is
reachable only through an authenticated, short-lived ticket scoped to actor,
Target, service, port, protocol, and expiry.

Clients cannot select an arbitrary upstream host or outer loopback address.
The relay exposes only declared and policy-approved inner workspace ports. A
stale Target or revoked grant invalidates the ticket. Service processes run
through the Workspace Executor in the same workspace environment as agents and
human terminals.

## 28. Client architecture

Desktop and Web are clients of one product, not separate products. They share
contracts and product semantics while retaining platform-specific controllers.

### 28.1 Shared layers

- design: shared tokens, DOM CSS, and React Native-safe token values; no product
  concepts.
- ui: the canonical Desktop/Web DOM primitives; no product concepts, access,
  stores, routes, or platform code.
- Cloud SDK: transport contracts for Organization, Project, access, compute,
  Workflows, Runs, budgets, and audit.
- Cloud SDK React: shared query/mutation keys, caching, and invalidation.
- AnyHarness SDK and SDK React: sessions, files, git, terminals, and runtime
  connections.
- product-domain: pure vocabulary, validation, policy view models, and
  projections. It may consume contract types but no SDK clients, React, access
  helpers, or app state.
- product-ui: shared Desktop/Web presentation with props and callbacks only.
  It owns no hooks, SDK access, stores, routes, or AnyHarness wiring.
- product-surfaces: connected shared Cloud CRUD using Cloud SDK React. It owns
  no AnyHarness runtime wiring, app stores/routes, telemetry, Tauri, or
  platform-specific lifecycle.

AnyHarness SDK React is shared access machinery, but the runtime connection and
live lifecycle controllers remain app-local: Desktop owns local/remote
resolution and Web owns its browser/gateway controller.

### 28.2 Desktop

Desktop owns:

- Tauri/native integration
- local AnyHarness lifecycle
- local sessions and workspaces
- native filesystem/editor actions
- rich local authoring
- local runtime resolution

Desktop may also connect to remote Workspaces through the same gateway contract
as Web.

### 28.3 Web

Web owns:

- browser auth and routing
- browser persistence
- gateway-only runtime resolution
- live stream/reconnection lifecycle
- Web-specific optimistic command handling

V1 Web product parity means:

- administer Projects, access, compute, deployments, and budgets
- list and execute approved Workflows
- observe live and passive WorkflowRun state
- cancel when permitted
- inspect sessions, changed files, diffs, and artifacts
- use one terminal after the core slice is stable
- inspect declared service health and open authenticated forwarded ports

It does not mean porting the complete Desktop shell or editor.

### 28.4 Mobile

Mobile is later. It consumes Cloud SDK and pure product-domain contracts. It
does not import DOM packages.

## 29. Deployment topologies

One product architecture supports three topologies.

### 29.1 Proliferate-managed

Proliferate operates:

- control plane
- gateways and relay
- model/integration gateway
- Runner Controllers and pools
- artifacts and projections

### 29.2 Hosted control plane with customer Runner Pools

Proliferate operates:

- control plane and selected management services

Customer operates:

- Runner Controller
- execution capacity
- code and runtime environment
- optionally relay, secret broker, integration gateway, and artifact storage

This is the preferred initial enterprise topology because it combines a
manageable control-plane product with customer-controlled code and compute.

With a hosted relay, model/integration gateway, projections, or artifact store,
this topology provides **compute sovereignty**, not complete data-plane
sovereignty. Exact claims depend on the selected component placement.

### 29.3 Fully self-hosted

Customer operates:

- control plane and database
- broker/outbox/Celery/Beat
- gateways and relay
- model/integration gateway
- secret store/KMS and signing keys
- trusted effect broker
- isolated environment build plane and artifact registry
- artifact storage
- Runner Controllers and pools
- backup and restore for every durable component

Managed, hybrid, and self-hosted modes use the same product resources and wire
contracts. They are deployment topologies, not separate architectures.

### 29.4 Topology data-flow matrix

Every deployment offer must publish where each data class travels and rests.

| Data class | Managed | Hosted control plane + customer runner and hosted relay | Full customer data-plane locality |
| --- | --- | --- | --- |
| Repository/workspace bytes | Proliferate-managed environment/storage | customer compute; file/terminal bytes may traverse hosted relay | customer compute/storage and customer relay/private endpoint |
| Prompts/model payloads | hosted model gateway/provider | hosted gateway/provider unless customer supplies its own | customer gateway or explicitly selected provider path |
| Tool arguments/results | hosted integration/effect gateway | hosted unless customer deploys gateway/broker | customer integration/effect gateway |
| Credentials | hosted brokers and target capabilities | hosted and/or customer brokers according to binding | customer secret/KMS/brokers |
| Transcript/projections | hosted according to policy | hosted metadata/redacted/full content according to policy | customer store; optional metadata export |
| Diffs/artifacts/checkpoints | hosted artifact store | hosted or customer store according to policy | customer artifact/checkpoint store |
| Terminal/file traffic | hosted relay | traffic traverses and may terminate at the hosted relay according to the selected protocol | customer relay/private endpoint or separately designed end-to-end payload encryption |
| Telemetry/audit | hosted | configured hosted projection/audit | customer storage with optional export |
| Backups | Proliferate | split by component ownership | customer |

The product and sales claim must name the actual topology. A customer Runner
Pool alone does not guarantee that code, prompts, transcripts, tool data, or
artifacts never traverse Proliferate infrastructure.

## 30. Security requirements

### 30.1 Tenancy

- Every shared resource is Organization-scoped.
- Every lookup scopes by Organization and resource identity.
- Cross-tenant references fail structurally or at the store boundary.
- Runtime tickets bind actor, resource, Target, generation, capability, and
  expiry.
- Organization kill switch and resource revocation propagate to active work.

### 30.2 Runtime isolation

- One unrelated Workspace activation or automated Attempt per environment.
- No pool/provider credentials in the workload.
- Metadata-service access blocked.
- Private-network access denied unless explicitly granted.
- Agent process cannot inspect control process memory, environment, sockets,
  credential store, or runtime-home control metadata.
- Persistent Workspace volumes use customer/Workspace-scoped encryption policy.
- Customer code and untrusted repository setup are assumed adversarial.

### 30.3 Credential security

- Platform-managed credentials, private envelopes, broker capabilities, and
  registered secret-mount values never enter Work Manifests, Workflow plans,
  Environment Revisions, Workspace Checkpoints, projections, prompts, or
  analytics.
- Customer-authored code, files, prompts, transcripts, terminal output, and
  checkpoints may themselves contain sensitive or secret content. Treat those
  as encrypted, access-controlled customer data. Secret scanning and redaction
  are defense in depth, not the correctness boundary.
- One-use enrollment tokens.
- Rotating controller and Target identity.
- Short-lived integration and runtime credentials.
- Audience-separated credentials.
- Revocation and expiry fail closed.

### 30.4 Audit

Append-only audit covers:

- resource and policy changes
- authorization allow/deny
- run initiation and execution identity
- budget decision
- runner placement and Target enrollment
- credential issue, use, rotation, and revocation
- privileged effect intent, approval, result, and uncertainty
- cancellation and cleanup
- denied and stale Target actions

Sensitive payloads are redacted or referenced by hash. Secrets and unredacted
production rows are never audit content.

## 31. Reliability requirements

- Postgres is durable control truth.
- Every correctness-sensitive enqueue is coupled transactionally to state.
- Tasks are idempotent.
- Attempt claims are leased and fenced.
- Target identity is the runtime epoch.
- Runtime observations are monotonic and replayable.
- Duplicate delivery cannot create duplicate logical WorkflowRuns or
  Executions.
- External effects have idempotency, reconciliation, or explicit uncertainty.
- Cancellation waits for runtime quiescence.
- Expired provisioning leases and safe unaccepted provider resources are
  reaped. Accepted runtime loss follows the explicit orphan/quiescence policy;
  it is not automatically retried or destroyed merely because a lease expired.
- Environment provisioning and teardown are idempotent.
- Passive reads do not wake compute.
- Environment replacement does not retain stale client streams.
- No terminal WorkflowRun or Workspace activation loses its required artifacts
  or audit.

## 32. Current repository map

The repository already contains valuable pieces. Every statement in this
section is a snapshot of the review baseline named at the top of this memo, not
a permanent architecture claim.

### 32.1 Current foundations

- AnyHarness exposes Workspace, Session, transcript, files, git, terminal, tool,
  HTTP, SSE, and WebSocket runtime surfaces.
- The workflow actor and workflow-domain SQLite state live in AnyHarness.
- Workflow Definitions, immutable Versions, WorkflowRuns, manual/schedule/poll
  triggers, cost fields, and current delivery logic exist in the server.
- Supervisor has the intended narrow process relationship with AnyHarness and
  Worker.
- A Proliferate Worker binary, enrollment, heartbeat, catalog, and update
  foundations exist.
- The server gateway proxies HTTP/SSE/WebSocket traffic and substitutes runtime
  authorization.
- Organizations, memberships, SSO foundations, billing subjects, compute
  usage, LLM usage, and basic budgets exist.
- Desktop has the richer Workflow editor and local/cloud runtime abstractions.
- Web already consumes shared chat presentation and parts of the Cloud product.
- E2B is the current managed sandbox provider seam.
- AGPL-3.0 licensing and beta self-hosted control-plane deployment exist.

### 32.2 Current gaps

- Workflows, repositories, Workspaces, and sandboxes remain strongly
  owner-user scoped.
- There is no canonical Project resource.
- There are no Access Groups, typed resource grants, Cost Centers, or Service
  Principals.
- There is no Workflow Deployment binding.
- Current CloudSandbox is one active E2B sandbox per user.
- Current E2B materialization is server-driven and cohosts AnyHarness, Worker,
  agent processes, terminals, repositories, runtime state, and credentials in
  one user/filesystem trust domain. Supervisor is not yet the mandatory owner
  of that lifecycle.
- Current durability is same-sandbox only: E2B pause/process restart retains
  the filesystem and AnyHarness SQLite, but a killed/replaced sandbox loses
  unexported workspace and runtime-ledger state. Existing Cloud Workspace rows
  then retain stale AnyHarness workspace IDs.
- Current AnyHarness does reload nonterminal workflow actors from same-disk
  SQLite after process restart, which is useful groundwork, but it reopens work
  without the full admission barrier for lease consistency, contiguous
  observations, process quiescence, and fail-closed effect classification.
- `CloudWorkspace` has no first-class Target, Workspace Materialization,
  storage generation, checkpoint, cleanup, or recovery identity. The current
  sandbox value projects runtime generation as a constant rather than a fence.
- Current Cloud archive/restore changes Postgres metadata only. AnyHarness
  retire can remove a managed worktree after safety preflight, but no matching
  identity-preserving rehydrate path exists. Mobility export is a transfer
  bundle, not an accepted recovery manifest.
- Workflow checkpoint shapes exist as contract groundwork, but no production
  checkpoint object/blob acceptance path exists and current observations do
  not carry real checkpoint identities.
- AnyHarness runtime home currently mixes the runtime database with agent,
  secret, log, and temporary roots. It is not yet split into Target-private,
  recoverable runtime-ledger, and workspace-data lifetimes.
- Current personal E2B may contain multiple Workspaces in one AnyHarness
  database. A whole-database online backup would leak unrelated subjects; use
  one subject per remote ledger or a complete subject-scoped logical exporter.
- Current cloud worktree paths and AnyHarness's default managed-worktree root
  can disagree, which can make safe retire refuse a cloud worktree. Align this
  before wiring Cloud archive to runtime dehydration.
- Current Cloud Workspace creation crosses repo materialization, Postgres row
  creation, AnyHarness worktree creation, and ID write-back non-atomically. A
  crash can leave a stalled row whose current recovery is delete-and-recreate.
- Current Cloud Workspace delete removes only the Postgres row; it does not
  purge AnyHarness sessions/artifacts or remove the worktree, so runtime state
  can be orphaned.
- Current sandbox destroy revokes Worker authority and marks Postgres destroyed
  without proving provider destruction/quiescence. It is not hard-destroy
  evidence for recovery fencing.
- Current AnyHarness agent, terminal, workflow shell, process, hosting, and
  many git paths execute directly on the runtime host. Environment-variable
  filtering is not a namespace boundary.
- Current Git, model/gateway, workspace, and session credential material can be
  written under the same home/runtime tree visible to workload processes. It
  does not satisfy the Target broker model.
- Current gateway resolution is user-to-personal-sandbox rather than
  Workspace/WorkflowRun-to-Target-and-connection-generation.
- Target and runtime-connection generation are not meaningfully enforced in
  the Current personal path.
- The current Worker does not yet implement the full control, event-tail,
  materialization, and projection architecture. Target-side interactive relay
  ownership is not yet ratified.
- There is no pool-level Runner Controller.
- There are no Runner Pool, Compute Class, Execution Attempt, Execution
  Environment, or durable Target resources matching this proposal.
- Environment configuration is mutable and user/repository oriented rather
  than an immutable Project Environment Revision.
- Production background deployment does not yet realize the full
  RabbitMQ/Celery/Beat/outbox target.
- Web Workflows still route through legacy Automation surfaces.
- The new Workflow API and complete Workflow product are not fully shared
  through the common Cloud SDK.
- Web runtime access still follows the personal-sandbox path and polling rather
  than the Target/connection-generation live contract.
- Shared AnyHarness client normalization/cache identity does not yet preserve
  Target plus runtime-connection generation, so a replacement runtime can
  retain stale browser query/stream state.
- There is no first-class declared Service/Port runtime contract or scoped
  forwarded-port ticket.
- Current resolved workflow plans persist a plaintext run gateway credential
  and do not yet implement the canonical secret-free plan/private-envelope
  split.
- Current cloud delivery can perform external materialization/delivery before
  the durable after-commit/outbox boundary required by the target.
- Manual local workflow execution defaults to the selected mutable workspace;
  exact dirty/unpushed source binding is incomplete.
- Local parallel workflows are rejected; current parallel execution is
  personal-cloud specific.
- Workflow capability enforcement is namespace-wide and flattened to a run
  union rather than the target exact per-session/step model.
- Required invocation relies on observed tool-name heuristics rather than a
  trusted gateway receipt.
- Current result projection loses some stable step/slot identity.
- Schedule and poll use bespoke loops rather than the complete
  Celery/Beat/outbox target.
- Poll can advance after an item StartRun failure and leave that item sealed as
  seen.
- Cancellation/ownership release can precede proven runtime quiescence.
- Current effect-ledger writes and portions of session event persistence are
  best-effort. Some recovery adapters treat an in-flight local process or SCM
  action as replayable without durable reattachment/reconciliation evidence.
  Cross-Target workflow recovery is therefore forbidden until those paths fail
  closed.
- Current terminal Workflow observations infer quiescence from terminal run
  state rather than an authenticated process/effect/checkpoint receipt.
- Customer-hosted execution is not yet equivalent to the current self-hosted
  control-plane claim.

### 32.3 Current paths that must remain migration inputs, not permanent law

- personal owner or Organization XOR ownership
- one sandbox per user
- user-keyed gateway routing
- direct server provisioning of E2B
- legacy Automation ownership and Web UI
- synchronous workflow delivery to personal cloud
- bespoke workflow schedule/poll loops
- broad integration namespace grants

Do not build new enterprise concepts by extending those assumptions.

## 33. Pilot V1 and Platform V1

V1 is staged. The smallest design-partner pilot must not be confused with the
complete reusable enterprise control plane.

### 33.1 Pilot V1 vertical slice

> One Organization has one Project, one repository, one immutable minimal
> environment, one managed compute profile, one deployed Workflow, and an
> explicit small set of pilot members. An authorized ordinary teammate opens
> Web, runs it as themselves or through one narrow Service Principal, watches it live,
> reviews its files/diff/output/cost, and cancels it. An unauthorized teammate
> is denied by the server.

Pilot V1 may use fixed product configuration behind general contracts:

- one Project and Project Repository binding
- one minimal Environment Revision/materializer
- one authorization-subject-backed ProjectGrant and one minimal flat Access
  Group
- one managed Runner Pool/Compute Class profile, Project allowlist, and use
  entitlement
- self execution or one narrow Service Principal
- one Cost Center plus one simple reserved spend/concurrency cap
- one Workflow Deployment
- Execution, Attempt, Environment, and Target identity
- frozen Organization, payer, Project, initiator, executor, and Cost Center on
  every Execution
- Organization authorization revision, sticky revocation, and decision audit
- Target/connection-generation runtime access
- same-Target AnyHarness restart from its existing disk, with fail-closed effect
  reconciliation before workflow admission reopens
- explicit orphan state for an accepted lost Target; no automatic cross-Target
  workflow resume claim
- minimum actor/source/compute/cost audit
- Web execute, observe, cancel, changed-file/diff review

Full Workflow authoring may remain Desktop-first. Pilot setup may be
founder/FDE-assisted, but authorization and runtime safety may not depend on
manual database edits.

### 33.2 Platform V1 expansion

Platform V1 generalizes the pilot into reusable organization administration:

- Organization viewer context
- multiple Projects and repositories
- Environment Definition/Revision catalog
- flat Access Groups and typed resource grants
- reusable Service Principals
- Cost Centers, reservations, and layered typed-scope budget policy
- multiple Runner Pools and Compute Classes
- generation-fenced Workspace Materializations and accepted recovery
  checkpoints for interactive Workspaces
- general Workflow Deployment catalog and trigger binding
- integration connection/capability administration
- append-only usage and fuller audit
- Project, access, compute, workflow, and budget administration in Web

Customer-owned Runner Pools may begin during Platform V1, but are not required
to call the first managed design-partner pilot successful.

### 33.3 Enterprise topology gate

The first pilot may use Proliferate-managed compute for non-sensitive
validation. The first credible sensitive enterprise topology is hosted control
plane plus customer-owned Runner Pool and an explicitly documented relay,
gateway, artifact, and projection placement.

## 34. Public launch versus enterprise readiness

The public launch can truthfully ship before the full team architecture.

Public launch:

- strong individual product
- supported agents and models
- useful personal/local/cloud workflow beta
- accurate open-source and self-hosting claims
- founder-led onboarding
- clear shipping/beta/roadmap truth

Enterprise design partner:

- one Project
- one recurring workflow
- controlled identity and integrations
- approved compute
- small authorized user group
- observable output and cost
- founder/FDE-assisted configuration

Enterprise rollout:

- durable customer Runner Pools
- resource-level authorization
- budgets and audit
- failure-tested background orchestration
- Web team administration and review
- SSO/SCIM and compliance depth as required

Do not delay public learning until the entire enterprise control plane exists.
Do not call the public beta enterprise-ready before its gates pass.

## 35. Dependency-ordered implementation projects

### Project 0: contract ratification

Freeze:

- canonical nouns
- tenant and ownership model
- authorization subject, flat group, typed grant, and Organization revision
- payer, Cost Center, charge-resolution, and execution-attribution model
- stable Budget Rule identity, Policy Revision activation, and typed scope
  binding
- budget-window identity, dispatch Admission versus PolicyRenewal generation,
  reservation/dispatch fence, and continuous usage-to-rule application
- model-request reservation ownership and concurrency-slot authority
- Project and Environment Revision
- Environment Revision, Environment Build, and Runtime Bundle pinning tuple
- Definition versus Deployment
- Execution, Attempt, Environment, Target
- Runner Controller protocol
- Runtime Connection Ticket
- Work Manifest and private envelope boundaries
- observation and usage contracts
- trusted outer Target versus untrusted workspace boundary
- Workspace Executor/ExecutionBackend contract and direct-local exception
- Workspace Materialization, storage generation, recovery-manifest, and
  resume-safe-manifest contracts
- Attempt, Target, storage, and runtime-connection epoch meanings

Amend focused authoritative specifications before code treats these as law.

### Project 1: workflow and execution correctness

- complete stable observation identity
- secret-free plan/envelope split
- source binding and checkpoint correctness
- fail-closed effect intent/result transaction, stable effect identity, frozen
  payload hash, and honest uncertain outcomes
- real process registry/group cancellation and authenticated Quiescence Receipt
- ordered Worker observation reporter plus strict Attempt/Target/terminal CAS
- schedule/poll durability
- cancellation through quiescence
- result/artifact inspection
- reliable local and personal-cloud vertical slice

Do not redesign the AnyHarness workflow interpreter.

### Project 2: minimal pilot resource and environment contracts

- explicit Organization/Billing Subject/Membership context on every start path;
  remove first/current-Membership inference
- backfilled authorization subject for current Memberships
- one Organization-scoped Project and Repository binding
- one typed ProjectGrant and central effective-capability evaluator
- minimal immutable Environment Revision
- provider-specific Environment Build identity and immutable artifact digest
- separate Runtime Bundle Revision
- symbolic secret requirements
- one minimal flat group and one active group edge
- one narrow Service Principal and durable Deployment-binding authority
- one logical managed Runner Pool, one immutable approved Pool Policy/Compute
  Class Revision, Project binding, and use entitlement
- one Cost Center with deterministic execution attribution
- Organization authorization revision, decision audit, and revocation fanout
- effective-capability API
- migration adapter for Current personal resources

General group/Cost Center/catalog CRUD, directory synchronization, delegated
Organization roles, and rich reporting may start in parallel but are Platform
V1 expansion. Their final-shaped IDs and execution fields are prerequisites for
freezing the pilot contract.

### Project 3: Execution persistence and scheduler

- Execution, Attempt, Environment, Target schema
- immutable Attempt Assignment
- renewable Attempt Lease and attempt_lease_generation
- target_id and runtime_connection_generation
- Workspace Materialization/storage-generation or Attempt scratch binding
- outbox-driven scheduler
- one fixed Budget Policy, stable Rule/Revision, typed binding, Window Counter,
  ExecutionAdmission/PolicyRenewal-fenced reservation, and holds
- one atomic Concurrency Rule/slot lease
- minimal canonical usage ledger, frozen execution-rule applications, and
  continuous compute/model reconciliation
- per-request gateway allocation/receipt identity for envelope and per-event
  reservation modes
- reservation-expiry versus dispatch compare-and-swap and stale-evidence
  readmission
- simultaneous-start, duplicate-receipt, expiry/dispatch, window-rollover,
  late-usage, and reconciliation-idempotency tests
- placement decision and audit
- failure classification and retry

### Project 4A: minimal environment builder and materializer

- supported devcontainer subset
- isolated EnvironmentBuild/BuildAttempt
- immutable artifact resolution, signing, and hashing
- source checkout/mount
- minimal tools/services/ports
- trusted outer Target and untrusted workspace namespace
- shared workspace versus protected control volume layout
- split Target-private state, recoverable runtime-ledger state, workspace data,
  inner ephemeral state, and caches
- monotonic storage generation and exclusive-attach/detach proof
- Workspace Executor protocol and adversarial isolation conformance suite
- Runtime Bundle installation
- Workspace materialization/checkpoint policy

### Project 4B: minimal Target Worker and Supervisor

- durable record of one ephemeral Target identity
- Bootstrap Envelope enrollment
- command/control reconcile
- materialization and binding
- AnyHarness event tail
- monotonic snapshot delivery
- checkpoint, cancellation, and shutdown
- consistent AnyHarness online-backup/restore-scrub seam and immutable
  checkpoint upload/report protocol
- Supervisor update/apply/rollback contract
- mandatory Supervisor ownership of AnyHarness, Worker, executor, and inner
  environment lifecycle

Interactive relay is a parallel target-side component with owner TBD until its
focused contract is ratified.

### Project 4C: Runner Controller and E2B adapter

- controller enrollment and rotating pool identity
- capacity and Compute Class publication
- Attempt claim/renew/complete protocol
- provider idempotency and lease revalidation
- E2B provider driver
- protected bootstrap delivery
- teardown, orphan observation, and safe cleanup
- metrics and drain/update

### Project 4D: checkpoint storage and restore substrate

- checkpoint/recovery-manifest metadata and immutable object-version registry
- managed and customer-private storage-gateway adapters
- scoped one-use upload/download authority
- envelope encryption, KMS/key ownership, rotation, and cryptographic deletion
- Checkpoint Authority manifest signing plus storage-gateway verification-key
  enrollment, rotation, revocation, audience, and replay handling
- conditional write, digest/read-back verification, and signed customer receipt
- active Target/storage-generation acceptance compare-and-swap
- failed-upload and lost-CAS orphan-object cleanup
- retention, quotas, legal hold, incremental/base dependency tracking, and
  garbage collection
- quarantined restore orchestration, ledger scrub/migration, and semantic
  read-back
- checkpoint list/read/restore/delete authorization and audit
- provider storage conformance for exclusive attachment, POSIX/SQLite locking,
  crash consistency, snapshot/read-back, and stale-writer rejection

Projects 4A, 4B, 4C, and 4D proceed in parallel behind the frozen Project 0 and
3 contracts. The Pilot managed runner can initially use only the 4D artifact
receipt subset needed for terminal rescue/output, but interactive replacement
or any continuation claim requires the complete relevant 4D gates.

### Project 5: one generation-aware managed execution

- integrate 4A/4B/4C and the required 4D receipt subset end to end
- Workspace/WorkflowRun authorization route
- Target and runtime-connection-generation resolver
- short-lived runtime tickets
- generation-aware client connection
- stable Target/generation client cache keys and ticket refresh
- declared service/port tickets through the relay
- projection content policy
- passive versus live read path
- terminal observation/artifact acknowledgement
- safe teardown and post-acceptance orphan behavior
- same-Target restart recovery barrier; no cross-Target workflow resume

### Project 6: team Workflow Deployment binding

- one shared Workflow Version
- Project-scoped immutable Deployment Revision
- Service Principal plus durable binding/approval evidence
- exact approved Compute Class Revision
- Cost Center resolution mode plus stable Budget/Concurrency Policy bindings;
  each Execution admission/renewal freezes effective Rule Revisions
- integration capability bindings
- trigger binding
- typed input/effect limits
- team result/review

### Project 7: Web execute, observe, cancel, and review

- shared Workflow and team Cloud SDK
- minimal shared Project/access/compute surfaces
- Web app-local live AnyHarness connection controller
- Web execute/observe/cancel/review
- initiated-by/executed-as and charged Cost Center
- reserved/consumed cost and budget-denial reason
- awaiting-capacity versus not-admitted state
- changed files and diffs
- one terminal after core review
- declared service status and authenticated forwarded-port links
- remove legacy Web Automation path after migration

### Project 8: customer-owned Runner Pool

- outbound customer controller packaging
- Docker/Kubernetes/AWS deployment paths
- customer-side relay and secret options
- control/data projection policy
- upgrade, backup, diagnostics, and support

### Project 9: Platform V1 generalization

- multiple Projects and environment catalog
- full flat Access Groups and typed grants
- reusable Service Principals
- multi-scope Cost Center/Budget administration, additional meters/windows,
  reusable policies, reporting, forecasting, and override workflows
- multiple Runner Pools and Compute Classes
- workflow catalog/deployment administration
- integration capability administration
- isolated prebuild depth, cache policy, and artifact registry
- persistent interactive Workspace volumes, accepted recovery manifests,
  rehydration bridge, retention, and recovery UX
- fuller Web administration and audit

### Project 10: enterprise hardening and full self-hosting

- high-scale load, partition, concurrency, and accounting chaos tests
- runner loss and network partition tests
- permission revocation during active work
- budget exhaustion and concurrency limits
- required SSO, SCIM provisioning/group sync, sticky deprovisioning, and
  break-glass recovery
- audit export and retention
- backup and disaster recovery
- security review and isolation tests
- operator dashboards and alerts
- self-hosted build plane, background plane, gateways, KMS/secret store,
  artifact registry/storage, signing, and backup/restore

## 36. Parallelism and critical path

The critical path is:

~~~
contracts
  -> workflow correctness in the Current path
  -> minimal Project/access/Environment contract
  -> Execution/Attempt/Target ledger and scheduler
  -> environment materializer + Target Worker + E2B Runner Controller
     + checkpoint/artifact receipt substrate
  -> one generation-aware managed execution through gateway/projection
  -> team Workflow Deployment binding
  -> Web execute/observe/review
  -> customer Runner Pool
~~~

After contracts freeze, work can proceed in parallel:

- environment builder/materializer, Target Worker, and Runner Controller
- Platform V1 IAM/budget data model behind the pilot contract
- shared Cloud SDK and Web surfaces
- workflow correctness and observations
- customer-runner packaging after the controller protocol freezes

No track should optimize itself ahead of the first complete vertical slice.

## 37. Acceptance gates

### Gate 0: launch truth

- Every claim is shipping, beta, or roadmap.
- Clean setup and first useful result work.
- No legacy Automation language contradicts the Workflow position.

### Gate 1: workflow reliability

- Repeated real runs require no database repair.
- Source and configuration are identifiable.
- Structured outputs survive projection.
- Failure and cancellation remain inspectable.
- No silent duplicate external effects.
- Effect-intent persistence failure stops execution before the effect.
- Cancel remains requested until process/effect quiescence is authenticated.
- Killing and restarting AnyHarness on the same Target either reconciles each
  started effect or ends it as outcome-uncertain before admission reopens.

### Gate 2: one isolated managed execution

- A WorkflowRun or Workspace activation commits immutable intent.
- Scheduler creates a fenced Attempt.
- Controller provisions one isolated environment.
- Target enrolls and becomes ready.
- AnyHarness executes.
- Agent, terminal, and setup-hook processes run only through the Workspace
  Executor and cannot read, signal, connect to, or mount outer control state.
- A bypass/full-access agent cannot obtain Worker/relay/provider credentials,
  raw upstream model or Git credentials, metadata service access, another
  Target's data, or unrestricted private-network access.
- Web/Desktop can connect.
- Results project and required artifacts persist.
- Losing an accepted Target produces visible orphan state and never launches an
  automatic replacement Attempt in Pilot V1.
- Environment cleans up.

### Gate 3: environment reproducibility

- A clean Environment Revision builds twice.
- No platform-supplied build credential or secret-mount value enters an exported
  layer, artifact, cache, provenance payload, or log.
- Human and agent observe the same workspace files/tools/services.
- Unsupported devcontainer fields fail with exact structured errors.
- Replacement restores according to declared policy.

### Gate 4: team authorization

- Admin grants explicit pilot members or one flat group one Project and Compute
  Class Revision from one logical Runner Pool.
- Authorized ordinary member succeeds.
- Unauthorized member fails even through a direct URL.
- Project access, compute entitlement, identity, and budget are independently
  tested.
- Simultaneous starts cannot oversubscribe the Pilot spend or concurrency cap;
  duplicate usage receipts do not double-charge.

### Gate 5: team Workflow

- Admin deploys one Workflow Version for caller-self execution or one narrow
  Service Principal.
- Non-admin executes it.
- User cannot edit or widen compute/integrations.
- WorkflowRun records initiator, principal, source, environment, compute,
  charged Cost Center, reservation/consumption, and minimum audit. Generic Cost
  Center administration is a Platform V1 expansion.

### Gate 6: Web runtime and review

- Web opens an authorized remote Workspace.
- SSE/live transcript works.
- Prompt and cancel work.
- Browser refresh reconnects. Environment replacement reconnects only for
  Workspaces or executions whose focused recovery policy proves safe state.
- Changed files and diffs are reviewable.
- One terminal uses the same inner environment as the agent.
- Declared service health and an authenticated forwarded port work; an
  arbitrary, expired, revoked, or stale-Target port request fails closed.
- Permission revocation closes or denies access.

### Gate 7: durable automation

- Schedule/poll survives control-plane restart.
- Duplicate queue/feed delivery does not duplicate logical work.
- Failed item is retryable or visibly dead-lettered.
- Pre-acceptance Runner loss fences provisioning and permits safe replacement.
- Every accepted lost Target becomes orphaned in Pilot V1. Quiescence,
  recovery-manifest, storage-fence, and effect-reconciliation work is groundwork
  for a later continuation gate, not permission to resume in Pilot V1.
- Replacement is an explicit new WorkflowRun or read-only recovery Workspace.
- Cancellation reaches quiescence and cleanup.

### Gate 8: customer Runner Pool

- Customer controller enrolls outbound.
- Work executes without inbound firewall access.
- Customer code/secrets remain in the selected boundary.
- Hosted control plane receives only configured projections.
- Update, drain, orphan cleanup, and diagnostics work.

### Gate 9: Platform V1 enterprise rollout

- Fresh 100-plus-member Organization can be configured without database edits.
- Five to twenty pilot users operate.
- Ten to twenty concurrent environments behave predictably.
- Access, budget, runner loss, gateway reconnection, and audit are tested.
- Interactive Workspace Target replacement restores from an accepted encrypted
  recovery manifest under a fresh storage generation, marks live processes
  interrupted, and exposes the checkpoint/RPO interval.
- Stale Targets cannot attach or write the current authoritative
  materialization, publish an accepted recovery manifest, update current
  projections, acquire fresh capabilities, or perform brokered effects after
  storage-generation transfer. Hard-destroy/capability-expiry tests cover
  unbrokered external-effect risk separately.
- Every terminal WorkflowRun and Workspace activation is explainable.

### Future gate: cross-Target Workflow continuation

- The old Target is authenticated quiescent or hard-destroyed/quarantined and
  all prior authority is revoked or expired.
- One accepted resume-safe recovery manifest binds the exact source lineage,
  runtime ledger, effect frontier, observation cursor, and compatible runtime.
- No outcome-uncertain effect exists.
- Storage ownership transfers exclusively to a fresh generation.
- A fresh Attempt, Target, execution generation, binding, sessions, and
  capabilities are created with explicit parent lineage.
- Crash injection proves no duplicate effect and no stale report/write can
  become authoritative.

## 38. Failure scenarios that must shape the design

- duplicate StartRun request
- duplicate queue delivery
- schedule fires during deployment
- poll page replay
- poll item StartRun failure
- controller claims then disconnects
- provider creates environment but response is lost
- Target enrolls twice
- old Target reports after replacement
- runtime becomes unreachable while agent effect is in flight
- model/tool credential expires
- permission revoked during an open session
- budget exhausted between reservation and use
- environment build partially succeeds
- source branch moves after WorkflowRun creation
- Workspace volume attaches to two generations
- checkpoint upload completes but acceptance CAS is lost
- runtime-ledger backup is corrupt or incompatible with the desired bundle
- restored snapshot contains stale Target credentials or broker bindings
- prior storage writer returns after replacement attachment
- user cancels while tool call or PR creation is uncertain
- Slack/email/provider accepts a request but times out before response
- server restarts during terminal observation
- runner cleanup fails
- customer relay is partitioned
- active Organization is disabled

For each, the implementation must answer:

- which system owns truth
- which identity/fence rejects stale work
- whether retry is safe
- what the user sees
- what is audited
- how resources are cleaned up

## 39. Explicit V1 non-goals

- complete Workflow editor parity on Web
- Web local execution
- complete Desktop shell/tab/store port
- arbitrary editable Web filesystem
- multiple advanced persistent terminals
- nested Access Groups
- custom role builder
- generic polymorphic grant explorer
- sophisticated multi-region bin packing
- every sandbox/cloud provider
- distributed workflow graph across multiple environments
- full air-gapped packaging for every customer topology
- mobile
- broad visual redesign
- foundation-model training
- generic all-knowledge-work product UI
- immortal business-function agents

These are future directions, not prerequisites for the first team vertical
slice.

## 40. Open architecture decisions

### 40.1 Workspace and runtime-state durability

Ruling:

- use the hybrid model in Sections 20.3 through 20.9
- interactive Workspaces use generation-fenced persistent encrypted workspace
  and runtime-ledger storage plus accepted recovery manifests
- automated WorkflowRuns default ephemeral, support same-Target process
  restart, and export approved checkpoints/artifacts
- accepted Target loss is orphaned in Pilot V1; cross-Target workflow resume is
  not a V1 claim
- Target-private identity is never included in recoverable state
- do not introduce a catch-all ExecutionHome resource before the focused
  Workspace/materialization/cache/archive ownership model is ratified

Before recovery implementation, ratify the subject-scoping/export format,
logical export versus encrypted database backup boundary, restore scrub and
schema-compatibility contract, object/manifest format beyond the existing Git
profile, and key ownership/lifecycle. These are correctness contracts because
some formats cannot preserve tenant isolation or cross-version restore.

Managed storage vendor, initial retention defaults, and which customer
storage/KMS adapters ship first remain implementation/product choices. They do
not reopen the lifetime, fencing, or recovery semantics.

### 40.2 Runtime isolation implementation

Question:

- VM plus inner container
- pod/microVM with separate trusted and untrusted containers/namespaces
- another provider-specific equivalent

Recommendation:

- preserve the locked outer-trusted/inner-untrusted boundary
- prototype the simplest secure VM plus inner workspace-container topology
- do not require nested Docker for all providers
- require the same adversarial conformance suite from every equivalent

### 40.3 Multi-agent isolation

Question:

- all lanes in one environment
- child environments for selected lanes

Recommendation:

- one environment per Pilot V1 WorkflowRun with isolated worktrees/sessions
- introduce child Executions only when workload or security evidence requires
  them

### 40.4 Projection content

Question:

- full transcript in hosted Cloud
- redacted transcript
- metadata/artifacts only

Recommendation:

- policy-selectable projection with a metadata-safe minimum

### 40.5 Customer runtime relay

Question:

- hosted relay
- customer-hosted relay
- direct private endpoint

Recommendation:

- support hosted relay first for speed
- freeze a connection-ticket contract that permits customer-hosted relay

### 40.6 Workflow catalog ownership

Question:

- Organization-owned Definitions
- Project-owned Definitions
- private drafts plus promoted shared versions

Recommendation:

- Organization catalog with private drafts and Project-scoped Deployments

### 40.7 First privileged effects

Question:

- SCM
- read-only database
- exact SSH diagnostic
- Slack/email

Recommendation:

- scoped draft-PR/SCM effect and read-only diagnostics before production
  mutation or external outreach

### 40.8 First enterprise topology

Question:

- managed compute only
- customer Runner Pool
- full self-hosted control plane

Recommendation:

- validate product on managed compute
- make hosted control plane plus customer Runner Pool the first serious
  enterprise architecture

### 40.9 Target-side relay process ownership

Question:

- dedicated relay sidecar
- trusted AnyHarness-adjacent component
- expanded Worker responsibility after its focused contract is amended

Recommendation:

- keep the wire and connection-ticket contract independent of the process owner
- do not silently assign interactive relay to Worker

### 40.10 Devcontainer V1 subset

Question:

- which image/Dockerfile/features/hooks/services/mounts/ports/user settings are
  supported
- which privileged, Docker socket, host mount, device, and capability settings
  are denied or restricted to customer-owned weak Compute Classes

Recommendation:

- ratify the smallest subset required by real design partners
- reject unsupported fields explicitly
- expand only behind isolated build/workspace conformance tests

## 41. Agent implementation rules

When an implementation agent uses this memo:

1. Label Current, V1, and Target behavior explicitly.
2. Read the focused authoritative spec before editing code.
3. Do not create a second Workflow interpreter.
4. Do not make Celery workers host agent execution.
5. Do not turn the per-Target Worker into a pool scheduler.
6. Do not treat a Runner Pool as one sandbox.
7. Do not use one sandbox per Organization or Access Group.
8. Do not make a physical environment the durable Workspace identity.
9. Do not expose raw runtime/provider credentials to clients or agents.
10. Do not use Access Groups for cost attribution.
11. Do not use Cost Centers for authorization.
12. Do not implement run-as-another-human.
13. Do not collapse Definition and Deployment.
14. Do not collapse Work Manifest, Environment Revision, placement, and private
    credentials into one mutable blob.
15. Do not put platform-managed secret material in plans, checkpoints, logs,
    projections, or analytics; classify customer-authored content as sensitive
    even when it may contain unknown secrets.
16. Do not rely on client-side visibility for authorization.
17. Do not route remote runtimes by user once Workspace/Target routing exists.
18. Do not extend legacy Automations as a competing product model.
19. Do not share unrelated mutable work inside one environment.
20. Do not blindly retry uncertain external effects.
21. Prefer one complete vertical slice over disconnected resource CRUD.
22. Preserve a migration path for Current personal/local behavior.
23. State every accepted temporary exception and its removal gate.
24. Update the owning focused spec when a proposed contract is ratified.
25. Do not turn conceptual Work Manifest or execution state set into a
    catch-all mega-contract/resource.
26. Keep Attempt assignment, Attempt lease generation, Target ID, and runtime
    connection generation distinct.
27. Do not automatically replace a post-acceptance orphaned WorkflowRun without
    proven quiescence, checkpoint, and effect reconciliation.
28. Do not execute customer Dockerfiles/devcontainer hooks on Runner Controller
    hosts.
29. Revalidate an active Attempt lease before every provider mutation and use
    provider-side idempotency/metadata.
30. Keep trusted Target control/state outside the untrusted workspace process,
    UID, mount, and socket boundary.
31. Preserve server ownership boundaries: API is transport, services
    orchestrate, stores own SQL, and integrations own vendor I/O.
32. Preserve frontend package boundaries: product-domain is pure, product-ui is
    presentation-only, product-surfaces is Cloud CRUD only, and app-local
    controllers own AnyHarness runtime lifecycle.
33. Route every remote executable action through AnyHarness's
    ExecutionBackend; direct host subprocesses are local-trusted compatibility
    behavior only.
34. Do not give AnyHarness or an inner workspace a raw Docker/containerd socket
    when a narrow Workspace Executor can hold that authority.
35. Do not evolve the Current E2B `SandboxProvider` or mutable
    `RepoEnvironment` into the Environment Builder, Runner Controller, or
    portable Environment Revision.
36. Pin Environment Revision, Environment Build artifact digest, and Runtime
    Bundle Revision on every Target and Attempt.
37. Keep storage_generation distinct from Attempt, Target, connection,
    workflow-execution, and session-lease generations.
38. Never restore Worker DB, Target identity, enrollment/bootstrap material, or
    runtime/relay credentials into a replacement Target.
39. Never copy a live SQLite database/WAL pair as a runtime-ledger checkpoint;
    use a consistent backup plus restore scrub and migration.
40. Never call a checkpoint accepted until its blobs and manifest are verified
    and the accepted pointer compare-and-swaps against the active Target and
    storage generation.
41. Never infer quiescence from a terminal status, missing heartbeat, expired
    lease, or sent cancel request. Require the focused authenticated receipt.
42. Never make Cloud archive metadata-only once runtime dehydration is claimed;
    preserve Workspace identity and report cleanup/checkpoint blockers.

## 42. Ratification and promotion plan

This memo is intentionally broad and non-authoritative.

After ratification, split durable law into focused specifications:

- Projects and Environments
- Team Authorization and Service Principals
- Runner Pools and Execution
- Workspace Materialization, Storage Fencing, Checkpoints, and Recovery
- Runtime Gateway and Relay
- Metering and Budgets
- Team Workflow Deployments
- Customer-hosted Runner Deployment

Update the existing Workflow feature spec rather than duplicating its execution
semantics. Update Worker, Supervisor, Server, Frontend, SDK, and deployment
structure specs in their owning areas.

A later compact authoritative platform index may link the promoted focused
specs. It should not duplicate their contracts.

## 43. Final synthesis

Proliferate is not merely an IDE, workflow builder, sandbox provider, or agent
gateway.

It is one product composed of:

~~~
AnyHarness
  the execution runtime

Proliferate Worker and Supervisor
  the per-environment runtime bridge and process lifecycle

Runner Plane
  managed and customer-owned capacity

Control Plane
  Projects, Workflows, policy, identity, budget, orchestration, and audit

Web and Desktop
  human interfaces into the same product
~~~

The product wins if it becomes the trusted place where an organization:

- chooses its agents and models
- defines reusable work
- gives agents reproducible environments
- runs them on appropriate compute
- grants exact access and identity
- keeps control of code, secrets, and infrastructure
- observes and reviews every important result
- measures cost and quality
- improves the system over time

The immediate implementation goal is not to build the entire future. It is to
make one end-to-end team workflow work through architecture that can become the
future without being replaced.
