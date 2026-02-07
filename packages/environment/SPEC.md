# Environment Package Spec

## Purpose
Provide a single, shared source of truth for environment variables across all services and apps. This package defines schemas, validation, and typed accessors using @t3-oss/env-core.

## Goals
- One shared server runtime schema for all services.
- One shared public (NEXT_PUBLIC_*) schema for client and server use.
- Fail fast on missing required variables.
- Prevent accidental access to server-only variables from client code.
- Remove legacy/duplicate env names (no compatibility layer).

## Non-Goals
- Backwards compatibility with deprecated env names.
- Service-specific env modules outside this package.

## Exports
- `@proliferate/environment/server`
  - Validates server-only + public env vars.
  - Intended for server runtimes (web, gateway, worker, scripts).
- `@proliferate/environment/public`
  - Validates public env vars only (NEXT_PUBLIC_*).
  - Intended for client/runtime code.
- `@proliferate/environment/runtime`
  - Small runtime-only helpers (e.g. `nodeEnv`, `nextRuntime`).
  - No validation or schema enforcement.
- `@proliferate/environment`
  - Re-exports schemas and helper types for tooling.

## Usage
Server code:
```ts
import { env } from "@proliferate/environment/server";

const baseUrl = env.NEXT_PUBLIC_APP_URL;
```

Client code:
```ts
import { env } from "@proliferate/environment/public";

const apiUrl = env.NEXT_PUBLIC_API_URL;
```

Runtime helpers:
```ts
import { nodeEnv, nextRuntime } from "@proliferate/environment/runtime";

const isProd = nodeEnv === "production";
const isEdge = nextRuntime === "edge";
```

## Canonical Env Names
See https://docs.proliferate.com/self-hosting/environment (source: `~/documentation/self-hosting/environment.mdx`) for the full, up-to-date list of required vs optional variables.

## Notes
- Any variable that can be public must use NEXT_PUBLIC_ and should not have a non-public alias.
- Schemas live in this package and should be updated whenever env usage changes.
