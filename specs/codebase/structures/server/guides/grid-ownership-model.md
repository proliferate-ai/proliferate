Status: target

# Server Grid Ownership Model

What an engineer needs to know to reason about the target server architecture.

## Scope

This document owns the cross-layer ownership model for the Python control plane
under [server/proliferate](../../../../../server/proliferate). The current source
router and enforced rules remain in [Server Standards](../README.md); the
focused [domain](domains.md), [database](database.md), [auth](auth.md),
[integration](integrations.md), [library](lib.md), [error](errors.md), and
[background](background.md) guides own the detail for their rows. Product
behavior remains in the owning platform or system document.

## The Core Idea

The server is a **grid**: columns are business domains such as Billing, Cloud,
Workflows, Accounts, and Organizations; rows are technical layers such as API,
service, domain, models, and stores. A piece of code lives at one coordinate.

**Legality is a pure function of coordinates.** Whether code at `(service,
billing)` can call code at `(store, cloud)` depends only on those coordinates
and an explicit ownership declaration. It does not depend on review history or
an undocumented exception. That makes the boundary searchable, testable, and
enforceable in CI.

Three principles hold the grid stable:

1. **Ownership stops the blast radius.** Only an owning domain writes its
   resources. Foreign reads exist only in a declared consumer ledger.
2. **Import audiences are inverse to knowledge.** Code importable by everyone
   knows nothing about product policy; code that knows product policy has a
   narrow audience.
3. **Layers own their seams.** A row answers one question—how data is loaded,
   how access is resolved, or how an error crosses transport—and every column
   uses that row's answer.

## The Layers

**API** is the HTTP boundary. It parses requests, receives authentication and
access dependencies, calls services, and shapes responses. It contains no
business logic, authorization decisions, or database operations.

**Service** is orchestration. It calls its own stores, foreign public services,
declared foreign-read stores, integrations, and allowed libraries. It receives
resolved access context and returns domain-typed data.

**Domain** is pure product policy. It performs no I/O. Its rules could move to a
different runtime without changing their inputs or outputs.

**Models** have two distinct audiences. Public models in a domain's `models.py`
are wire vocabulary; models under `db/models/**` are private ORM shapes. The
pipeline is ORM → frozen dataclass → Pydantic. A service never receives an ORM
object.

**Stores** are the only layer that knows SQL. A store receives the caller's
session, returns frozen dataclasses, and never opens, commits, or rolls back a
session. Each store has one owning domain. Foreign reads require an exact ledger
entry; foreign writes go through the owner's public service.

## Shared Coordinates

**`lib/infra`** contains generic machinery: time, IDs, pagination, batching,
strings, and cryptography. Every layer may import it because it knows nothing
about products, vendors, or persistence.

**`lib/product`** contains cross-domain pure product logic. Only domain rows may
import it; product policy never leaks into stores or integrations.

**`lib/capabilities`** contains reusable orchestration over integrations. Each
capability has an explicit domain-consumer map. A concern enters `lib/**` only
after a second real consumer exists.

**Integrations** contain vendor mechanics: raw SDKs, HTTP, protocol models, and
vendor errors. They are leaves below product domains. Services translate vendor
failures into product meaning.

**Seams** own cross-cutting request lifecycle. Authentication and
dependency-free authorization vocabulary sit below product domains; request
owner/org resolution composes at the endpoint; resource access remains in each
owning domain; one global error handler translates product errors.

**Background** has one durable execution model: thin Celery tasks fired by Beat
or the transactional outbox. Domain worker services own the work. There are no
domain schedulers, process-owned periodic loops, or `worker.py` entry points.
Only the outbox relay below `background/**` reads a store directly.

## Why Each Rule Exists

### Store ownership (`SRV-STORE`)

**Problem:** unrestricted foreign writes make responsibility and schema-change
impact unknowable.

**Rule:** writes cross domains only through the owner's public service. Reads
cross only through an exact, reviewable consumer ledger.

**Result:** a store owner can query every consumer before changing its contract,
and invariant enforcement has one write boundary.

### Error ownership (`SRV-ERR`)

**Problem:** protocol-shaped errors scattered through services make response
translation inconsistent and hard to test.

**Rule:** services raise product errors; the global handler translates them to
HTTP. `HTTPException` is legal only at authentication, org/resource-access, and
explicitly declared non-JSON transport boundaries. Error codes are globally
unique.

**Result:** the HTTP format changes once, while product failures remain typed
and independently testable.

### Library purity (`SRV-LIB`)

**Problem:** a shared folder that imports everything becomes a junk drawer and
pulls single-domain policy out of its owner prematurely.

**Rule:** Infra is universal and product-blind; Product is pure and restricted
to domain rows; Capabilities are consumer-mapped. Reuse requires at least two
real consumers.

**Result:** a library's import audience and allowed knowledge are obvious from
its coordinate.

### Background unification (`SRV-BG`)

**Problem:** domain-owned loops and schedulers create multiple restart,
observability, and failure models.

**Rule:** scheduled work is a Beat-fired Celery task; durable follow-up work is
an outbox-fired Celery task. Tasks are thin and process state is disposable.

**Result:** work is restartable, observable, and scalable through one runtime.

### Auth as a seam (`SRV-SEAM`)

**Problem:** authorization scattered through services hides access decisions
and makes authentication changes cross domain boundaries.

**Rule:** endpoints compose four orthogonal boundaries: actor authentication in
[auth/dependencies.py](../../../../../server/proliferate/auth/dependencies.py),
org standing through
[permissions.py](../../../../../server/proliferate/permissions.py), concrete
resource access in the owning domain's `access.py`, and pure product policy in
the owning domain's `domain/policy.py`. Services receive the resolved result.

**Result:** access is visible in route signatures, product policy is testable
without FastAPI, and authentication mechanisms remain below product domains.

## The Architecture in One Breath

Columns are domains and rows are layers. Within a column, API calls service,
service orchestrates, domain decides, and store persists. Public `models.py` is
the wire handshake. Stores have one owner; writes cross through that owner's
service and reads cross only when ledgered. Shared code has an explicit import
audience. Integrations isolate vendors. Auth and errors are seams. Background
work is a Celery task. Anything importable by every coordinate knows no product
or persistence detail.

## What the Grid Prevents

| Failure mode | Grid rule | Prevention |
| --- | --- | --- |
| Foreign writes corrupt shared state | `SRV-STORE-3` | Only the owner's service writes |
| Store changes surprise foreign readers | `SRV-STORE-2` | Exact consumer ledger makes reads queryable |
| Errors vary by call site | `SRV-ERR-1` | Product errors plus one transport handler |
| Shared code becomes a junk drawer | `SRV-LIB-2/4/5/6` | Three audiences, two-consumer entry ticket, and reverse ratchet |
| Auth decisions hide in orchestration | `SRV-SEAM-1` | Four endpoint-composed boundaries |
| Background work has divergent failure models | `SRV-BG-3` | One Celery execution model |
| Service cycles block refactors | `SRV-TOPO-3` | Generated graph and acyclic-component gate |
| Third-party packages leak into product code | `SRV-PKG-2` | Explicit package-audience map |

## Foreign-Read Doctrine

Foreign reads are legal only when the exact consumer and store operation appear
in the ownership ledger. A ledger row grants no module-wide permission and
stale rows fail the checker. If a required read is not declared, the caller must
either add the reviewed read edge or consume an owner service contract.

The small declaration cost makes schema-change blast radius queryable: the
owner can answer “who reads this store?” without reconstructing history.

## How to Reason About a Change

Before code crosses domains or touches shared state, ask:

1. **Store ownership:** Does this domain own the store? If not, is this exact
   read ledgered, or is the write going through the owner's public service?
2. **Audience:** May this coordinate import the library or package? Does the
   imported code know more than its audience allows?
3. **Error shape:** Is a transport error legal at this seam, or must the code
   raise a product error?
4. **Background:** Is this durable work represented as a Celery task, with Beat
   or the outbox owning dispatch?
5. **Auth:** Is the decision visible in an endpoint dependency or pure policy,
   rather than buried in orchestration?

If every answer is yes or not applicable, the change aligns with the grid.

## Reading Order

1. This document for the target mental model.
2. [Server Standards](../README.md) for current source routing and enforced
   rules.
3. [Library ownership](lib.md) for import audiences.
4. [Domain ownership](domains.md) for cross-domain coordination.
5. [Auth ownership](auth.md) for the four authorization boundaries.
6. [Background ownership](background.md) for task and transaction rules.

## Current gaps

- [ ] **Coordinate enforcement is not present.** Current CI runs the bounded,
  path-classified
  [check_server_boundaries.py](../../../../../scripts/check_server_boundaries.py)
  from [ci.yml](../../../../../.github/workflows/ci.yml). There is no checked-in
  TOML coordinate map, general `check_grid.py`, package-audience map, generated
  service graph, or automatic owner/consumer map.
- [ ] **Store ownership and foreign-read declarations are not generally
  enforced.** The current [domain guide](domains.md#cross-domain-coordination)
  permits foreign reads through stores, while the checker has no complete store
  owner table or exact foreign-read ledger. Cross-domain write repair and
  enforcement therefore remain bounded migrations rather than a repository-wide
  coordinate law.
- [ ] **The ORM → dataclass boundary is incomplete.** Current stores such as
  [users.py](../../../../../server/proliferate/db/store/users.py) and
  [billing_subjects.py](../../../../../server/proliferate/db/store/billing_subjects.py)
  return ORM types. Accounts SSO also mutates a `User` and calls `db.flush()` in
  [user_resolution.py](../../../../../server/proliferate/server/accounts/sso/user_resolution.py).
- [ ] **Request transaction ownership is incomplete.** The migration allowlist
  records 30 route-owned session calls across the Accounts
  [Desktop](../../../../../server/proliferate/server/accounts/desktop/api.py),
  [Identity](../../../../../server/proliferate/server/accounts/identity/api.py),
  and [SSO](../../../../../server/proliferate/server/accounts/sso/api.py) APIs.
  Their exact count locks live in
  [server_boundaries_allowlist.txt](../../../../../scripts/server_boundaries_allowlist.txt).
- [ ] **Authorization dependency adoption is partial.** The current
  [Auth guide](auth.md) treats inline service checks as migration debt. Current
  examples include Organization role gates in
  [organizations/service.py](../../../../../server/proliferate/server/organizations/service.py),
  Cloud integration admin checks in
  [cloud/integrations/service.py](../../../../../server/proliferate/server/cloud/integrations/service.py),
  and Agent Run Config visibility checks in
  [agent_run_config/service.py](../../../../../server/proliferate/server/cloud/agent_run_config/service.py).
  In addition, `permissions.py` currently composes actor deps, stores, billing
  services, and request/RLS context; only `auth/authorization.py` is the
  dependency-free authorization leaf.
- [ ] **Error normalization is incomplete.** Organization SSO orchestration
  still raises `HTTPException` in
  [organizations/sso/service.py](../../../../../server/proliferate/server/organizations/sso/service.py),
  and the current checker does not enforce globally unique error codes or ban
  every non-boundary service raise.
- [ ] **Library audiences are not represented or enforced.** The current
  [lib tree](../../../../../server/proliferate/lib) contains only a Product
  workspace-naming concern; `lib/infra` and `lib/capabilities` do not exist, and
  the server checker does not scan `lib/**` for audience or purity rules.
- [ ] **Service topology and package audiences are not gated.** Cloud Sandbox
  imports Gateway service in
  [cloud_sandboxes/service.py](../../../../../server/proliferate/server/cloud/cloud_sandboxes/service.py),
  while Gateway imports Cloud Sandbox service in
  [gateway/service.py](../../../../../server/proliferate/server/cloud/gateway/service.py).
  No generated graph rejects that cycle, and no third-party package map limits
  imports by coordinate.
- [ ] **Background execution is not unified.** Periodic process loops remain in
  [Billing reconciliation](../../../../../server/proliferate/server/billing/reconciler.py),
  [anonymous telemetry](../../../../../server/proliferate/server/anonymous_telemetry/worker.py),
  and the Agent Gateway
  [worker](../../../../../server/proliferate/server/cloud/agent_gateway/worker.py),
  [usage importer](../../../../../server/proliferate/server/cloud/agent_gateway/usage_import.py),
  and [top-up worker](../../../../../server/proliferate/server/cloud/agent_gateway/topups.py).
  The Customer.io task also performs SQL and vendor work directly in
  [customerio_sync.py](../../../../../server/proliferate/background/tasks/customerio_sync.py).
  These paths require a deployed, behavior-equivalent background plane before
  loop removal can be safe.
