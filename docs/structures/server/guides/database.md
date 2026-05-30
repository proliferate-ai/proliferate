# Database

Status: authoritative for `db/store/`, `db/models/`, transactions, and the
type pipeline between persistence, internal logic, and wire format.

Read after `docs/structures/server/README.md`. This guide details how database access is
organized, how data flows from ORM to dataclass to Pydantic, how transactions
are owned, and the column conventions that apply across the schema.

## Ownership

The database layer has three concerns:

- **`db/models/`** owns ORM table definitions. Persistence schema only.
- **`db/store/`** owns DB access — query construction, `db.execute(...)`,
  reads, writes. The only place SQLAlchemy is used.
- **The type pipeline** maps each persistence row through three layers: ORM
  (mutable, session-coupled) → dataclass (frozen, internal) → Pydantic (wire
  format).

Transactions, dataclass conventions, and DB column conventions all live in
this guide because they're all aspects of the database layer.

## `db/models/`

ORM tables. Nothing else.

### Folder shape

```text
db/models/
  __init__.py
  base.py
  <resource>.py        # one ORM file per resource cluster
```

Examples: `cloud.py`, `billing.py`, `automations.py`, `auth.py`,
`organizations.py`. A single ORM file may declare multiple related table
classes (a primary entity plus its junction tables).

### Allowed

- SQLAlchemy `Mapped[...]` declarations.
- `__tablename__`, columns, indexes, constraints.
- Foreign-key relationships.
- Type-only enum imports (the Python enum lives in `domain/`).
- Inheritance via the shared `Base` from `db/models/base.py`.

### Banned

- API request or response models.
- Service logic.
- Computed properties that do business work. Simple derived properties
  (e.g., `is_active = Column(...)`) are fine.
- Deep `BaseFoo → BaseBar → Concrete` hierarchies. Use composition, not
  inheritance trees.
- Importing `db/store/**`, `service.py`, integrations, or business code.

## `db/store/`

All DB access lives here.

### Folder shape

Default: flat file per resource.

```text
db/store/
  __init__.py
  <resource>.py
```

Each store file owns DB access for **one ORM resource** (and its tightly-related
supporting tables — e.g., a junction table for many-to-many). The boundary is
the ORM model, not the product concept.

When ≥4 closely-related stores cluster, use a folder:

```text
db/store/<area>/
  __init__.py
  <resource>.py        # un-prefixed inside the folder
```

Inside the folder, file names drop the area prefix because context lives in
the folder name. Example: `db/store/cloud_mcp/connections.py`, not
`db/store/cloud_mcp/cloud_mcp_connections.py`.

Pick one shape per area. A folder either has all of its area's stores inside,
or none.

### Allowed

- `async def` functions taking `db: AsyncSession` as a parameter.
- `select(...)`, `insert(...)`, `update(...)`, `delete(...)`,
  `db.execute(...)`.
- ORM model imports from `db/models/**`.
- Frozen dataclasses returned to services (read-result snapshots).
- Internal SQL helpers as private functions (`_build_filter_clause`).
- Resource-specific constants (table aliases, query fragments) as module-level
  constants.

### Banned

- Opening a session inside a store function (`async with
  async_session_factory() as db`). Stores take a session; they don't open
  one.
- Calling `db.commit()` or `db.rollback()`. Callers own commits.
- Calling another store function from within a store. Stores are leaves;
  they don't call peers. If you need cross-store logic, that's service work.
- Importing `service.py`, integrations, FastAPI, or business code.
- Returning ORM objects to services. Always return frozen dataclasses.
- Mixing parameter-injected and self-opening patterns in the same file.

### Standard function shape

```python
@dataclass(frozen=True)
class WorkspaceSnapshot:
    id: UUID
    status: WorkspaceStatus
    runtime_generation: int
    created_at: datetime

async def get_workspace_snapshot(
    db: AsyncSession, workspace_id: UUID
) -> WorkspaceSnapshot | None:
    workspace = await db.get(CloudWorkspace, workspace_id)
    if workspace is None:
        return None
    return WorkspaceSnapshot(
        id=workspace.id,
        status=workspace.status,
        runtime_generation=workspace.runtime_generation,
        created_at=workspace.created_at,
    )

async def list_workspaces_for_owner(
    db: AsyncSession, owner_id: UUID
) -> tuple[WorkspaceSnapshot, ...]:
    rows = await db.execute(
        select(CloudWorkspace)
        .where(CloudWorkspace.owner_id == owner_id)
        .where(CloudWorkspace.deleted_at.is_(None))
    )
    return tuple(
        WorkspaceSnapshot(...)
        for w in rows.scalars().all()
    )
```

Reads return dataclasses or tuples of dataclasses. Writes return primitive
result types (`UUID`, `bool`, `None`) or a small frozen dataclass when more
information is needed.

### Eager loading

Stores explicitly load relationships needed for the snapshot. No lazy
attribute access leaks past the store boundary.

```python
# Good
rows = await db.execute(
    select(CloudWorkspace)
    .options(selectinload(CloudWorkspace.runtime_environment))
    .where(...)
)

# Bad — implicit lazy load when the service reads workspace.runtime_environment
rows = await db.execute(select(CloudWorkspace).where(...))
```

If the dataclass needs a relationship's data, the store eager-loads it. If
the relationship is only needed sometimes, define a separate read function
that loads it.

### Locking

Row-level locks live in stores, named `acquire_<resource>_<purpose>_lock`.
They require an open transaction.

```python
async def acquire_billing_subject_repo_limit_lock(
    db: AsyncSession, billing_subject_id: UUID
) -> None:
    await db.execute(
        select(BillingSubject)
        .where(BillingSubject.id == billing_subject_id)
        .with_for_update()
    )
```

Callers must wrap in a transaction (request session or
`async with db.begin():`).

### Pagination

Default to cursor pagination. The store returns a tuple
`(items, next_cursor)`:

```python
@dataclass(frozen=True)
class WorkspacePage:
    items: tuple[WorkspaceSnapshot, ...]
    next_cursor: str | None

async def list_workspaces_page(
    db: AsyncSession, *, owner_id: UUID, cursor: str | None, limit: int
) -> WorkspacePage:
    ...
```

Cursor encoding is a store concern. Services and handlers pass cursors as
opaque strings.

## The Type Pipeline

```
   db/models/<x>.py            db/store/<x>.py             server/<domain>/models.py
   ┌──────────────┐           ┌──────────────┐            ┌──────────────────┐
   │  ORM model   │ ────────▶ │  dataclass   │ ─────────▶ │  Pydantic model  │
   │  (mutable,   │  store    │  (frozen,    │  payload   │  (wire format,   │
   │  session)    │  function │  internal)   │  function  │  validated)      │
   └──────────────┘           └──────────────┘            └──────────────────┘

   Mapping #1: in the store function. Reads ORM, returns frozen dataclass.
   Mapping #2: in models.py. Takes dataclass, returns Pydantic.
   Service code only ever sees the dataclass.
```

### Why three layers

ORM models are mutable, session-coupled, and lazy-loading. Service code that
operates on them accidentally triggers DB calls and can corrupt persistence
state. Pydantic models carry wire-format concerns (validation, serialization)
that don't belong inside services. The dataclass is the isolation layer:
immutable, no behavior, no I/O, easy to test.

### Where dataclasses live

Default rule: **colocated with what owns them**.

- **Read-result dataclass** (returned from a store function) → defined in
  that store file.
- **Service-internal dataclass** (intermediate result) → defined in
  `service.py`.
- **Pure-domain dataclass** (state machine state, parsed value) → defined in
  `server/<domain>/domain/<concern>.py`.
- **Cross-resource composed dataclass** (workspace + runtime joined for one
  read) → defined in the store file that owns the read.

### Dataclass conventions

- `@dataclass(frozen=True)` for read-result dataclasses. Immutability prevents
  accidental mutation across calls.
- Fields are only what the service needs, not every ORM column. Trim
  aggressively.
- Use enums on dataclass fields, not strings. Wire-format string mapping
  happens in the Pydantic constructor.
- Naming: `<Resource>Snapshot` for read-result dataclasses
  (`WorkspaceSnapshot`). `<Resource>Update` / `<Resource>Insert` for mutation
  parameter dataclasses. Pure-domain dataclasses use whatever name fits.

### Pydantic constructor functions

Live in `server/<domain>/models.py`. Take dataclasses, return Pydantic.

```python
# server/cloud/workspaces/models.py
class WorkspaceResponse(BaseModel):
    id: UUID
    status: str
    runtime_generation: int

def workspace_response(snapshot: WorkspaceSnapshot) -> WorkspaceResponse:
    return WorkspaceResponse(
        id=snapshot.id,
        status=snapshot.status.value,
        runtime_generation=snapshot.runtime_generation,
    )
```

The constructor is the only place enum-to-string conversion happens. Service
code stays on the enum side; wire stays on the string side.

### Forbidden type patterns

- Pydantic constructor functions taking ORM objects. Always take dataclasses.
- `model_config = ConfigDict(from_attributes=True)` to map ORM into Pydantic.
- Pydantic models reused as ORM substitutes or general internal containers.
- Services receiving ORM objects directly from any caller.
- Returning Pydantic from services to handlers. The handler calls the
  constructor function.

## Transactions

One pattern: **store functions take `db: AsyncSession` and never commit**.
Callers own transactions.

### HTTP handlers

The request session is provided by the FastAPI dep. The dep commits on
success and rolls back on exception:

```python
async def get_async_session() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

Multi-step writes within one request commit together because they share the
session.

### Workers and reconcilers

Open a session at the entry point, wrap operations in `async with db.begin():`:

```python
async def run_billing_reconcile_pass() -> None:
    async with async_session_factory() as db:
        async with db.begin():
            await store.repair_placeholders(db)
            await store.reconcile_segments(db)
        # commits on context exit, rolls back on exception
```

### Narrower atomicity within a request

When a service needs an inner transaction smaller than the request, use
`db.begin_nested()`:

```python
async def cancel_subscription_with_seat_reconcile(
    db: AsyncSession, subscription_id: UUID, subject_id: UUID
) -> None:
    async with db.begin_nested():
        await store.subscriptions.mark_cancelled(db, subscription_id)
        await store.seats.reconcile_after_cancel(db, subject_id)
    # if anything in the block raises, only this savepoint rolls back
```

### Forbidden transaction patterns

- Store functions opening their own session.
- Store functions calling `db.commit()` or `db.rollback()`.
- Services calling `db.commit()` directly.
- `async with db.begin():` inside a store function. If narrower atomicity is
  needed, the caller wraps the call in `db.begin_nested()`.
- Transaction boundaries hidden inside store function names (`commit_x`,
  `transactional_y`). The boundary is at the caller.

## DB Column Conventions

### Required columns on every resource table

```sql
id           UUID         PRIMARY KEY  DEFAULT gen_random_uuid()
created_at   TIMESTAMPTZ  NOT NULL     DEFAULT now()
updated_at   TIMESTAMPTZ  NOT NULL     DEFAULT now()
```

`updated_at` auto-bumps on row update. Use SQLAlchemy
`onupdate=func.now()` consistently across models.

### Timestamps

- **Always `TIMESTAMPTZ`** (timezone-aware). Never naive `TIMESTAMP`.
- **Always UTC** at the application boundary.
- **DB defaults `now()`** for `created_at` / `updated_at`. Don't set them in
  app code unless overriding.
- **Python:** `datetime.now(timezone.utc)`. Ban `datetime.utcnow()` (returns
  naive — silent timezone bug source).

### Soft delete

- **Only when needed.** Most resources don't need soft delete; default to
  hard delete.
- When used: `deleted_at TIMESTAMPTZ NULL`. No `is_deleted` boolean.
- **Reads filter `deleted_at IS NULL` by default.** A separate function
  (`load_x_including_deleted`) reads soft-deleted rows when explicitly needed.

### UUIDs and foreign keys

- **All primary keys are UUID** with DB default `gen_random_uuid()`.
- **Foreign key column naming:** `<resource>_id` singular (`user_id`,
  `workspace_id`).
- **Foreign keys are NOT NULL** unless the relationship is genuinely optional.

### Enums

- **Python:** `StrEnum` (or regular `Enum` for non-string).
- **DB:** native Postgres enum (preferred) or `VARCHAR` with a `CHECK`
  constraint. Pick one project-wide.
- **Enum changes require migrations.** Adding, renaming, or dropping a value
  → alembic migration each time.
- **Dataclasses use the Python enum** for the field type. Wire serialization
  happens in the Pydantic constructor.

### Index and constraint naming

Configure SQLAlchemy's metadata naming convention once so this is automatic:

- Indexes: `ix_<table>_<column>[_<column>...]`
- Unique: `uq_<table>_<column>[_<column>...]`
- Foreign keys: `fk_<table>_<column>`
- Primary keys: `pk_<table>`
- Check constraints: `ck_<table>_<description>`

### Forbidden DB patterns

- `TIMESTAMP` without timezone.
- `datetime.utcnow()` anywhere.
- `is_deleted` boolean.
- Foreign keys named without `_id` suffix.
- Raw integer primary keys for new resources.
- Lazy ORM attribute access leaking past the store boundary.

## Migrations

All schema changes go through alembic. Each schema migration is its own
revision. Data migrations and schema migrations are not mixed in one
revision unless the data migration is required for the schema change to land
safely.

Conventions:

- Migration revision filenames follow alembic's default scheme.
- Each migration's `upgrade()` and `downgrade()` are reviewed together.
- Adding a NOT NULL column to an existing table requires a backfill plan
  (default value at the DB level, or a multi-step migration that adds
  nullable, backfills, then sets NOT NULL).
- Renaming a column or table requires a multi-step migration when the
  application is running during the change.
