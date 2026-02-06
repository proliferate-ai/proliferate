# Architecture Overview

## Directory Structure

```
proliferate/
│
├── apps/                                    # DEPLOYABLE SERVICES
│   │
│   ├── web/                                 # Next.js (Vercel)
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── app/
│   │       │   ├── api/                     # Route entry points
│   │       │   │   ├── rpc/[[...rest]]/     #   └─ oRPC handler
│   │       │   │   ├── auth/[...all]/       #   └─ better-auth
│   │       │   │   ├── sessions/            #   └─ legacy session routes
│   │       │   │   └── webhooks/            #   └─ external webhooks
│   │       │   └── (pages)/                 # React pages
│   │       │
│   │       ├── server/                      # Server-side (API route handlers only)
│   │       │   ├── routers/                 #   └─ oRPC route handlers
│   │       │   └── lib/                     #   └─ auth helpers (web-specific)
│   │       │
│   │       ├── components/                  # React components
│   │       │   ├── ui/                      #   └─ design system (no logic)
│   │       │   ├── providers/               #   └─ context providers
│   │       │   └── {feature}/               #   └─ feature components
│   │       │
│   │       ├── hooks/                       # React Query hooks
│   │       ├── stores/                      # Zustand (UI state)
│   │       ├── lib/                         # Client utilities (orpc, utils)
│   │       └── types/                       # Shared frontend types
│   │
│   ├── worker/                              # BullMQ processor (ECS)
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.ts                     # Entry: creates workers, startup/shutdown
│   │       ├── trigger-worker.ts            # processTriggerEvent()
│   │       ├── polling-worker.ts            # processPollingJob()
│   │       ├── scheduled-worker.ts          # processScheduledJob()
│   │       ├── session-subscriber.ts        # Redis pubsub listener
│   │       └── clients/
│   │           └── slack/                   # Async client implementation
│   │               ├── index.ts             #   └─ SlackClient class
│   │               ├── client.ts            #   └─ message/receiver workers
│   │               ├── slack-api.ts         #   └─ Slack API helpers
│   │               └── handlers/            #   └─ message handlers
│   │
│   ├── gateway/                             # WebSocket server (Fly.io) ← MOVE HERE
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.ts                     # Entry: HTTP + WebSocket server
│   │       ├── session-manager.ts           # WebSocket connection handling
│   │       └── lib/                         # Redis clients
│   │
│   └── llm-proxy/                           # LLM routing (Fly.io) ← MOVE HERE
│       ├── Dockerfile
│       └── src/
│           └── index.ts                     # Proxy requests to providers
│
├── packages/                                # SHARED LIBRARIES
│   │
│   ├── shared/                              # Browser-safe (imported everywhere)
│   │   └── src/
│   │       ├── contracts/                   # oRPC API definitions
│   │       │   ├── index.ts                 #   └─ AppRouter export
│   │       │   ├── repos.ts                 #   └─ repos contract
│   │       │   ├── sessions.ts              #   └─ sessions contract
│   │       │   └── orgs.ts                  #   └─ orgs contract
│   │       ├── types/                       # Shared TypeScript types
│   │       ├── constants/                   # Shared constants
│   │       └── providers/                   # Provider configs (e2b, modal)
│   │
│   ├── services/                            # Server-only (Node.js)
│   │   └── src/
│   │       ├── db/
│   │       │   └── client.ts                # Shared Drizzle client
│   │       │
│   │       ├── repos/                       # Feature: repos
│   │       │   ├── db.ts                    #   └─ DB queries
│   │       │   ├── service.ts               #   └─ business logic (optional)
│   │       │   └── mapper.ts                #   └─ DB row → API type
│   │       │
│   │       ├── sessions/                    # Feature: sessions
│   │       │   ├── db.ts
│   │       │   ├── service.ts
│   │       │   └── mapper.ts
│   │       │
│   │       ├── triggers/                    # Feature: triggers
│   │       │   ├── db.ts
│   │       │   ├── service.ts
│   │       │   └── mapper.ts
│   │       │
│   │       ├── prebuilds/                   # Feature: prebuilds
│   │       │   ├── db.ts
│   │       │   └── service.ts
│   │       │
│   │       └── email/
│   │           └── service.ts               # No DB, just Resend
│   │
│   ├── queue/                               # Job definitions + enqueue client
│   │   └── src/
│   │       ├── index.ts                     # Queue/worker factories, job types
│   │       │                                #   └─ TriggerEventJob, PollingJob
│   │       │                                #   └─ createTriggerEventsQueue()
│   │       │                                #   └─ createTriggerEventWorker()
│   │       │                                #   └─ queueTriggerEvent()
│   │       └── slack.ts                     # Slack job types + factories
│   │
│   ├── gateway-sdk/                         # Client for Gateway API
│   │   └── src/
│   │       └── index.ts                     # createGatewayClient()
│   │
│   └── modal-sandbox/                       # Python (Modal)
│       └── src/
│           └── sandbox.py                   # Sandbox management
│
└── External Services
    ├── PostgreSQL                           # Database (via Drizzle ORM)
    ├── Redis (ElastiCache)                  # BullMQ queues + pubsub
    └── Modal                                # Sandbox compute
```

## Import Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              packages/shared/                                │
│                     (types, contracts, constants, providers)                 │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│  packages/services/ │ │   packages/queue/   │ │ packages/gateway-sdk│
│  - db/ (queries)    │ │  (job definitions)  │ │   (client library)  │
│  - email/           │ │                     │ │                     │
│  - prebuilds/       │ │                     │ │                     │
└──────────┬──────────┘ └──────────┬──────────┘ └──────────┬──────────┘
           │                       │                       │
           │            ┌──────────┴──────────┐            │
           │            │                     │            │
           ▼            ▼                     ▼            ▼
    ┌─────────────────────────┐        ┌─────────────────────────┐
    │       apps/web/         │        │      apps/worker/       │
    │  (Next.js - Vercel)     │        │    (BullMQ - ECS)       │
    │                         │        │                         │
    │  imports:               │        │  imports:               │
    │  - shared (contracts)   │        │  - shared (types)       │
    │  - services (db, email) │        │  - services (db)        │
    │  - queue (enqueue)      │        │  - queue (factories)    │
    └─────────────────────────┘        │  - gateway-sdk          │
                                       └─────────────────────────┘

    ┌─────────────────────────┐        ┌─────────────────────────┐
    │      apps/gateway/      │        │     apps/llm-proxy/     │
    │   (WebSocket - Fly.io)  │        │     (HTTP - Fly.io)     │
    │                         │        │                         │
    │  imports:               │        │  imports:               │
    │  - shared (types)       │        │  - shared (types)       │
    │  - services (db)        │        │                         │
    └─────────────────────────┘        └─────────────────────────┘
```

## Real-Time Flow (Sessions)

```
Browser                Gateway                 Sandbox (Modal)
   │                      │                         │
   │◄─── WebSocket ──────►│◄─────── SSE ──────────►│
   │                      │                         │
   │  1. Connect WS       │                         │
   │─────────────────────►│  2. Connect SSE         │
   │                      │────────────────────────►│
   │                      │                         │
   │  3. Send prompt      │  4. POST /prompt        │
   │─────────────────────►│────────────────────────►│
   │                      │                         │
   │                      │  5. Stream tokens (SSE) │
   │  6. Forward tokens   │◄────────────────────────│
   │◄─────────────────────│                         │
```

## Background Job Flow

```
API Route                  packages/queue/              apps/worker/
    │                           │                            │
    │  queueTriggerEvent()      │                            │
    │──────────────────────────►│                            │
    │                           │                            │
    │                     ┌─────┴─────┐                      │
    │                     │   Redis   │                      │
    │                     └─────┬─────┘                      │
    │                           │                            │
    │                           │  Worker polls              │
    │                           │───────────────────────────►│
    │                           │                            │
    │                           │                   ┌────────┴────────┐
    │                           │                   │ processTrigger  │
    │                           │                   │ Event()         │
    │                           │                   │                 │
    │                           │                   │ uses:           │
    │                           │                   │ - services/db   │
    │                           │                   │ - gateway-sdk   │
    │                           │                   └─────────────────┘
```

---

## Backend Best Practices

### Directory Rules

- **`apps/`** = deployable (has Dockerfile or Vercel)
- **`packages/`** = importable libraries

### Package Purposes

| Package | Contains | Imported By |
|---------|----------|-------------|
| `shared/` | Types, contracts, constants | Everything |
| `services/` | DB queries, email, prebuilds | web, worker, gateway |
| `queue/` | Job types, enqueue helpers | web (enqueue), worker (process) |
| `gateway-sdk/` | Gateway client | worker |

### What Goes Where

| Code | Location | Why |
|------|----------|-----|
| DB queries | `packages/services/{feature}/db.ts` | Used by web, worker, gateway |
| Business logic | `packages/services/{feature}/service.ts` | Reusable across apps |
| Type mapping | `packages/services/{feature}/mapper.ts` | DB row → API type |
| Shared types | `packages/shared/types/` | Frontend + backend need them |
| Email sending | `packages/services/email/` | Used by web, worker |
| Job types | `packages/queue/` | Shared between producer/consumer |
| Job processors | `apps/worker/` | Only worker runs them |
| oRPC handlers | `apps/web/src/server/` | Tied to Next.js |
| React components | `apps/web/src/components/` | Frontend only |

### Feature Folder Pattern (`packages/services/{feature}/`)

```
repos/
├── db.ts        # Drizzle queries (select, insert, update)
├── service.ts   # Business logic (validation, side effects, combines queries)
└── mapper.ts    # Transform DB rows → API response types
```

- **db.ts** — pure data access using Drizzle ORM, no business logic
- **service.ts** — orchestrates queries, handles permissions, triggers side effects
- **mapper.ts** — keeps DB schema separate from API contract

### Migrations

| From | To | Why |
|------|-----|-----|
| `packages/gateway/` | `apps/gateway/` | Deployable service |
| ~~`packages/llm-proxy/`~~ | ~~`apps/llm-proxy/`~~ | ✅ Done |
| DB code in `apps/web/src/server/` | `packages/services/{feature}/db.ts` | Shared by multiple services |
| Business logic in routes | `packages/services/{feature}/service.ts` | Reusable, testable |
| Inline type transforms | `packages/services/{feature}/mapper.ts` | Consistent mapping |

---

## Frontend Best Practices

### Colors & Theming

- HSL CSS variables in `globals.css`
- Semantic names: `background`, `foreground`, `primary`, `muted`, `accent`
- Never raw hex/rgb — always `bg-background`, `text-foreground`
- Dark mode via `class` strategy + `next-themes`

### Data Fetching

| Layer | Purpose |
|-------|---------|
| `oRPC` | Type-safe client from contracts |
| `React Query` | Caching, deduplication, loading states |

**Queries:**
```typescript
useQuery(orpc.repos.list.queryOptions({ input: { limit: 10 } }))
```

**Mutations:**
```typescript
useMutation(orpc.repos.create.mutationOptions({
  onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.repos.key() })
}))
```

### State Management

| Type | Tool |
|------|------|
| Server data | React Query via oRPC |
| UI state | Zustand |
| Auth | `useSession()` |
| Theme | `useTheme()` |

---

## Quick Reference

| Need to... | Location |
|------------|----------|
| Add API endpoint | `packages/shared/contracts/` + `apps/web/src/server/routers/` |
| Add DB query | `packages/services/db/` |
| Add background job | `packages/queue/` (type) + `apps/worker/` (processor) |
| Add React component | `apps/web/src/components/` |
| Add shared type | `packages/shared/types/` |
