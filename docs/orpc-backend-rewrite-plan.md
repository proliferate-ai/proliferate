# oRPC Backend Rewrite Plan

This document is the implementation handoff for moving product API ownership out of `apps/web` and into a new `apps/backend` service on the v1 rewrite branch.

## Goal

Move all product oRPC server ownership out of `apps/web` and into `apps/backend`, while keeping `apps/web` responsible only for:

- UI
- Better Auth route mounting
- Better Auth client/plugin calls
- oRPC client calls to backend

The end state is:

- `apps/web` does not execute product oRPC handlers locally
- `apps/backend` owns the oRPC server
- shared oRPC contracts live in a package
- `packages/services` is trimmed to the minimal v1 surface we actually still need

## Current Reality

This branch is already in a partial rewrite state:

- `apps/gateway` is deleted
- `packages/shared` is deleted
- most old `packages/services` domains are deleted
- `apps/web/src/server/routers/*` still exists, but many files point at already-deleted services/contracts
- auth/org code still assumes some old better-auth and role semantics

Do not try to preserve the deleted legacy product surface.

## Architecture Decision

### Keep in `apps/web`

- `/Users/pablo/proliferate/apps/web/src/app/api/auth/[...all]/route.ts`
- Better Auth browser client
- invite page UI and any truly Next-specific auth UX
- oRPC client only

### Move to `apps/backend`

- all product oRPC server logic
- auth/session resolution for backend requests
- org/auth read procedures
- later: repos, sessions, secrets, runtime ingress, devtools ingress

### Shared package

- oRPC contract package with schemas + contract routers

## New Package/App Layout

```text
/Users/pablo/proliferate/apps/
├── web/
└── backend/

/Users/pablo/proliferate/packages/
├── db/
├── logger/
├── services/
├── auth-core/
└── orpc-contract/
```

## Target Ownership

### `packages/auth-core`

Purpose:

- one shared Better Auth instance/config
- used by `apps/web` to mount `/api/auth/*`
- used by `apps/backend` to resolve sessions from raw request headers

Files:

```text
/Users/pablo/proliferate/packages/auth-core/src/
└── index.ts
```

Required behavior:

- no Next-specific imports
- use `better-auth`
- support organization + apiKey plugins
- personal org bootstrap for new users
- session create hook should stamp `activeOrganizationId`

Important:

- restore `owner` to the org role enum in DB; the auth/org flow still assumes an owner-like creator role
- do not reintroduce `isPersonal`

### `packages/orpc-contract`

Purpose:

- shared input/output schemas
- contract-first router definitions
- shared `AppRouter` type for the web client and backend implementation

Files:

```text
/Users/pablo/proliferate/packages/orpc-contract/src/
├── index.ts
├── app-router.ts
├── schemas/
│   ├── auth.ts
│   └── orgs.ts
└── routers/
    ├── auth.ts
    └── orgs.ts
```

Use `@orpc/contract` and `oc`.

Rules:

- schemas only describe shapes
- router files only define contract procedures using those schemas
- no DB logic
- no service imports
- no env access

### `packages/services`

Purpose:

- minimal business logic for the v1 auth/org slice only

Keep:

- `/Users/pablo/proliferate/packages/services/src/db/client.ts`
- `/Users/pablo/proliferate/packages/services/src/db/crypto.ts`
- `/Users/pablo/proliferate/packages/services/src/db/serialize.ts`
- `/Users/pablo/proliferate/packages/services/src/logger.ts`
- `/Users/pablo/proliferate/packages/services/src/users/*`
- `/Users/pablo/proliferate/packages/services/src/orgs/*`

Delete or ignore:

- any remaining exports/imports for deleted domains
- old billing/onboarding/configuration/automation/session service surfaces

Required `orgs` service surface:

- `listOrgs(userId)`
- `getOrg(orgId, userId)`
- `getUserRole(userId, orgId)`
- `getUserOrgIds(userId)`
- `getFirstOrgIdForUser(userId)`
- `getBasicInvitationInfo(invitationId)`
- `listMembers(orgId, userId)`
- `listInvitations(orgId, userId)`
- `getMembersAndInvitations(orgId, userId)`
- `deletePersonalOrg(userId)`
- `isMember(userId, orgId)`
- `getMember(memberId, orgId)`

Do not restore:

- domain suggestions
- action modes
- billing
- onboarding
- admin
- automations
- workers

If the UI still references them, delete or rewrite the UI instead of resurrecting old product domains.

### `apps/backend`

Purpose:

- the real product backend
- owns the oRPC server implementation

Files:

```text
/Users/pablo/proliferate/apps/backend/src/
├── index.ts
├── auth/
│   └── session.ts
└── orpc/
    ├── contract.ts
    ├── handler.ts
    ├── middleware.ts
    ├── router.ts
    └── routers/
        ├── auth.ts
        └── orgs.ts
```

Key rule:

- backend reads real request headers directly
- backend must not use Next `headers()` or `cookies()`

### `apps/web`

Purpose after this pass:

- UI
- Better Auth mounting
- Better Auth browser hooks
- oRPC client only

Files to keep:

- `/Users/pablo/proliferate/apps/web/src/app/api/auth/[...all]/route.ts`
- `/Users/pablo/proliferate/apps/web/src/lib/auth/client/index.ts`
- `/Users/pablo/proliferate/apps/web/src/lib/auth/server/*` only if they become thin wrappers over `packages/auth-core`
- `/Users/pablo/proliferate/apps/web/src/lib/infra/orpc.ts`

Files to delete:

- `/Users/pablo/proliferate/apps/web/src/app/api/rpc/[[...rest]]/route.ts`
- `/Users/pablo/proliferate/apps/web/src/server/routers/*`

## Contract-First Pattern

### Contract package

Example shape:

```ts
// /Users/pablo/proliferate/packages/orpc-contract/src/schemas/auth.ts
import { z } from "zod";

export const AuthProvidersSchema = z.object({
	providers: z.object({
		google: z.boolean(),
		github: z.boolean(),
		email: z.boolean(),
	}),
});
```

```ts
// /Users/pablo/proliferate/packages/orpc-contract/src/routers/auth.ts
import { oc } from "@orpc/contract";
import { z } from "zod";
import { AuthProvidersSchema } from "../schemas/auth";

export const authContract = {
	providers: oc.input(z.object({}).optional()).output(AuthProvidersSchema),
};
```

```ts
// /Users/pablo/proliferate/packages/orpc-contract/src/app-router.ts
import { authContract } from "./routers/auth";
import { orgsContract } from "./routers/orgs";

export const appContract = {
	auth: authContract,
	orgs: orgsContract,
};

export type AppRouter = typeof appContract;
```

### Backend implementation

Use `implement(appContract)` from `@orpc/server`.

Example shape:

```ts
// /Users/pablo/proliferate/apps/backend/src/orpc/contract.ts
import { implement } from "@orpc/server";
import { appContract } from "@proliferate/orpc-contract";

export interface BaseContext {
	request: Request;
}

export const orpc = implement(appContract).$context<BaseContext>();
```

```ts
// /Users/pablo/proliferate/apps/backend/src/orpc/routers/auth.ts
import { orpc } from "../contract";

export const authRouter = {
	providers: orpc.auth.providers.handler(async () => ({
		providers: {
			google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
			github: Boolean(process.env.GITHUB_OAUTH_APP_ID && process.env.GITHUB_OAUTH_APP_SECRET),
			email: true,
		},
	})),
};
```

## Middleware End-to-End

### Problem

Current web middleware relies on Next-specific helpers:

- `headers()`
- `cookies()`

That cannot be used in `apps/backend`.

### Solution

Backend middleware receives the real `Request` and reads `request.headers` directly.

Required backend auth helpers:

```ts
// /Users/pablo/proliferate/apps/backend/src/auth/session.ts
export async function getSessionFromHeaders(headers: Headers) {}
export async function requireAuthFromHeaders(headers: Headers) {}
```

Required backend middleware layers:

- `publicProcedure`
- `protectedProcedure`
- `orgProcedure`

Do not implement:

- `adminProcedure`
- impersonation
- super-admin logic

Those are out of scope for this rewrite pass.

### Middleware flow

```text
browser -> /api/rpc/* -> backend
backend handler -> oRPC context { request }
middleware -> read request.headers
auth helper -> resolve session
middleware -> attach user/session/org to context
route handler -> call services
```

## Frontend oRPC Client

`apps/web` should keep the client helper, but it must stop importing router types from local web server code.

Replace:

```ts
import type { AppRouter } from "@/server/routers";
```

With:

```ts
import type { AppRouter } from "@proliferate/orpc-contract";
```

Client shape:

```ts
// /Users/pablo/proliferate/apps/web/src/lib/infra/orpc.ts
import type { AppRouter } from "@proliferate/orpc-contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

const getBaseUrl = () => {
	if (typeof window !== "undefined") {
		return process.env.NEXT_PUBLIC_BACKEND_URL ?? window.location.origin;
	}

	return process.env.NEXT_PUBLIC_BACKEND_URL ?? "";
};

const client = createORPCClient<AppRouter>(
	new RPCLink({
		url: `${getBaseUrl()}/api/rpc`,
		fetch: (request, init) =>
			fetch(request, {
				...init,
				credentials: "include",
			}),
	}),
);

export const orpc = createTanstackQueryUtils(client);
```

This means:

- the browser API stays typed
- the backend owns the server implementation
- `apps/web` no longer executes product backend handlers locally

## Delete vs Restore Rules

### Restore only

- auth-core
- minimal org/user services
- minimal auth/org contracts

### Do not restore

- old `packages/shared`
- old onboarding service
- old billing service
- old automations/workers/triggers stack
- old gateway/session runtime stack
- old action/admin surfaces

If a file still depends on one of those, delete it or rewrite it for the new v1 model.

## Workstreams for Parallel Agents

### Workstream A: Auth Core

Owner:

- one agent

Scope:

- `packages/auth-core`
- `apps/web/src/app/api/auth/[...all]/route.ts`
- `apps/web/src/lib/auth/client/index.ts`
- `apps/web/src/lib/auth/server/index.ts`
- `apps/web/src/lib/auth/server/session.ts`
- `apps/web/src/lib/auth/super-admin.ts` cleanup if still referenced
- DB role enum fix + drizzle regen

Acceptance:

- Better Auth routes still mount from web
- auth helpers no longer depend on deleted packages
- schema and hooks agree on roles

### Workstream B: Services Trim

Owner:

- one agent

Scope:

- `packages/services/package.json`
- `packages/services/src/index.ts`
- `packages/services/src/orgs/*`
- `packages/services/src/users/*`

Acceptance:

- package only exports minimal v1 auth/org service surface
- no imports from deleted packages

### Workstream C: oRPC Contract Package

Owner:

- one agent

Scope:

- `packages/orpc-contract/*`

Acceptance:

- contract package exports `appContract` and `AppRouter`
- auth/org schemas live there

### Workstream D: Backend App

Owner:

- one agent

Scope:

- `apps/backend/*`

Acceptance:

- backend has auth/session helper
- backend has oRPC handler
- backend implements auth/org contract

### Workstream E: Web Cutover

Owner:

- one agent

Scope:

- `apps/web/src/lib/infra/orpc.ts`
- delete `/Users/pablo/proliferate/apps/web/src/app/api/rpc/[[...rest]]/route.ts`
- delete `/Users/pablo/proliferate/apps/web/src/server/routers/*`
- remove imports that point at local web routers

Acceptance:

- web points at backend for oRPC
- no product oRPC server ownership remains in web

## Recommended Order

1. Fix auth role enum + restore `packages/auth-core`
2. Trim `packages/services`
3. Add `packages/orpc-contract`
4. Add `apps/backend`
5. Repoint web oRPC client
6. Delete old web oRPC route + router tree
7. Run targeted typechecks

## Required Spec Update

When this work lands, update:

- `/Users/pablo/proliferate/docs/specs/auth-orgs.md`

Spec changes needed:

- web no longer owns oRPC server routes
- better-auth remains mounted in web
- backend owns product oRPC server implementation
- Next request helpers are no longer the auth resolution primitive for product APIs

## Verification Checklist

Minimum commands after implementation:

```bash
pnpm -C /Users/pablo/proliferate/packages/db typecheck
pnpm -C /Users/pablo/proliferate/packages/auth-core typecheck
pnpm -C /Users/pablo/proliferate/packages/orpc-contract typecheck
pnpm -C /Users/pablo/proliferate/packages/services typecheck
pnpm -C /Users/pablo/proliferate/apps/backend typecheck
pnpm -C /Users/pablo/proliferate/apps/web typecheck
```

If `apps/web` still fails, the remaining failures should be dead references to deleted product domains. Delete those callsites instead of resurrecting the old architecture.
