# Web App Rules

These rules apply to everything under `/Users/pablo/proliferate/apps/web`.
They refine the repo-root guidance for the `web` app specifically.

## Core Boundary

- `apps/web` is the UI app.
- It owns rendering, browser behavior, and Next-specific web concerns.
- It does **not** own product backend business logic.
- Product API transport belongs in `apps/backend`.
- `process.env` must not be read directly in normal app code.
- In `web`, `src/lib/config/**` is the only allowed place to read `process.env`.
- If a module needs env-derived values, import resolved config from `lib/config/**`.

## Folder Ownership

### `src/app/**`

- Route files like `page.tsx`, `layout.tsx`, `template.tsx`, and `loading.tsx` are orchestration and rendering only.
- They must stay thin.
- They must not contain:
	- inline helper functions
	- inline subcomponents
	- local static config blocks
	- transport code
	- business logic
- If a route file starts accumulating logic, extract it into the proper domain folder.

### `src/app/api/**`

- Web route handlers are reserved for Better Auth routes and truly web-specific handlers only.
- Product backend APIs do **not** live in `web`.
- oRPC and product transport belong in `apps/backend`.
- Do not add new product API surfaces here unless there is a clear web-only reason.

### `src/components/**`

- `components/**` contains reusable UI blocks.
- Files should be `.tsx`.
- Organize by domain folders, not a flat component pile.
- `use*` hooks must not live under `components/**` unless they are tiny presentational hooks used by one colocated component.
- No raw `fetch`, `EventSource`, or ad hoc transport code in components.
- Components should stay presentation-first.
- If a component starts doing orchestration, policy branching, or heavy data shaping, move that logic out.

### `src/components/ui/**`

- This is the only place where low-level UI primitives and visual variants should be defined.
- Outside `components/ui/**`, do not use raw:
	- `<button>`
	- `<input>`
	- `<label>`
	- `<select>`
	- `<textarea>`
- Use typed UI primitives like:
	- `Button`
	- `Input`
	- `Label`
	- `Select`
	- `Textarea`

### `src/hooks/**`

- Hooks are domain-organized.
- No flat root hook files.
- Hooks should usually be `.ts`.
- Use `.tsx` only if the hook truly returns JSX, which should be rare.
- Hooks consume `lib/infra/**` clients for transport.
- Do not hide raw transport wiring inside random hooks unless the hook is explicitly a thin wrapper over a dedicated infra client.

### `src/lib/**`

- `lib/**` is for web boundary glue only.
- Files should be `.ts`.
- Allowed content:
	- pure helpers
	- transforms
	- display mapping
	- auth helpers
	- low-level web client glue
	- non-React domain helpers that are still web-specific
- Organize by domain folders like:
	- `auth`
	- `display`
	- `infra`
	- `integrations`
	- `analytics`
- Avoid flat root utility files.
- Logic belongs in `packages/services`, not `apps/web/src/lib`, if:
	- it should be reused outside `web`
	- it performs business orchestration
	- it makes DB/business decisions

### `src/lib/infra/**`

- `lib/infra/**` is for low-level transport and client glue only.
- Keep it limited to:
	- HTTP clients
	- URL builders
	- auth header wiring
	- request/response normalization
	- low-level retry and timeout behavior
- Hooks and route-level orchestration consume these clients.
- Do not put business workflows here.

### `src/config/**`

- `config/**` is for static options, labels, and constants only.
- Organize by domain, for example:
	- `config/navigation.ts`
	- `config/onboarding.ts`
- No giant all-in-one config file.
- Static arrays and constants must not be defined in `.tsx` files.
- Extract them here instead.
- `src/config/**` must not read `process.env`.

### `src/lib/config/**`

- `lib/config/**` is the only place in `web` allowed to read `process.env`.
- Use it for runtime config resolution only.
- Leaf modules must import resolved config values from here.
- Do not add exceptions for convenience.
- Do not read env directly from:
	- components
	- hooks
	- route files
	- feature helpers

## Environment Rule

- Do **not** read `process.env` directly outside `src/lib/config/**`.
- This applies even to small one-off checks and defaults.
- Do not hide env reads in:
	- route files
	- hooks
	- components
	- feature helpers
	- transport clients
	- auth helpers
- If you need a value from the environment:
	1. add or update a centralized module in `src/lib/config/**`
	2. resolve the env value there
	3. import the resolved value everywhere else

### `src/stores/**`

- Stores are for client-only ephemeral UI state only.
- Valid examples:
	- panel toggles
	- step tracking
	- transient form state
- Server-fetched data does not belong in stores.
- Server state belongs in TanStack Query via hooks.
- Files should be `.ts`.
- One store per concern.
- No mega-stores combining unrelated state.
- If a store grows beyond roughly 50 lines or starts doing async work, move that logic into a hook.

## Imports

- Use direct imports only.
- Use concrete paths like:
	- `@/lib/<domain>/<file>`
	- `@/hooks/<domain>/<file>`
	- `@/components/<domain>/<file>`
- No `lib/index.ts` or `hooks/index.ts` barrels.
- No pass-through shim exports.
- Import from the actual source module or package directly.
- Reusable code must not import from `app/**`.

## Server vs Client

- Be explicit about server-only and client-only boundaries.

### Server-only modules

- Must start with:
```ts
import "server-only";
```
- Keep server concerns in server-safe modules such as:
	- server auth helpers
	- server integration helpers
	- server infra helpers

### Client-only behavior

- Lives in components and hooks.
- Repeated browser behavior should be centralized in shared hooks or helpers.

### Layout and page gates

- Centralize auth, onboarding, and billing redirects.
- Do not duplicate redirect logic across many layouts and pages.

## Styling and UI Discipline

- Outside `components/ui/**`, do not use raw Tailwind palette classes.
- Use semantic token classes such as:
	- `bg-background`
	- `text-foreground`
	- `border-border`
	- `bg-card`
	- `text-success`
	- `text-warning`
	- `text-info`
	- `text-destructive`
- If a new color is needed, add a semantic token instead of using raw palette classes.

### Button rules

- Canonical `Button` variants are:
	- `primary`
	- `contrast`
	- `secondary`
	- `outline`
	- `ghost`
	- `link`
	- `destructive`
- Do not use `default`, `dark`, `light`, or `stacked` on the base `Button`.
- `primary` is the default CTA intent.
- `contrast` is the high-contrast CTA variant.
- If a new visual treatment is needed, extend `components/ui/**` instead of stacking ad hoc classes at the callsite.

### Specialized controls

- Non-standard controls should get dedicated typed primitives in `components/ui/**`.
- Do not overload the base `Button` for pattern-specific controls.

### Layout-only overrides

- Layout classes like margin, padding, width, and height are fine at the callsite.
- Core visual language must come from the component variant, not ad hoc class stacks.

## Review Standards

- Delete dead code unless there is a clear short-term migration reason to keep it.
- Prefer extracting logic over letting route files and components swell.
- If a module starts violating its folder boundary, move the logic to the correct place instead of adding a one-off exception.
