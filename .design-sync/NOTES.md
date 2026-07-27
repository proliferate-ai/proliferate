# design-sync notes

## Shape

- **Shape is `package`**, not `storybook`. Verified 2026-07-27: no
  `.storybook/` directory and zero `*.stories.*` files anywhere outside
  `node_modules`. Storybook (the tool) is not used in this repo.
- **But there IS a Storybook-equivalent**: the in-app *playground*, and
  specifically its component-library spec sheet. Do not treat the
  package shape here as "no usage examples exist" — see below.

## The playground library registry (preview-authoring source)

`apps/packages/product-client/src/components/playground/library/` is a
CI-enforced registry of every sanctioned component, and it is the right
source for authored previews:

- `types.tsx` — `LibraryEntry { name, subpath, render: () => ReactNode }`
  and `LibraryTier { id, title, entries }`.
- Tiers: `primitives.tsx` (34), `patterns.tsx` (22), `icons.tsx` (4),
  `product-patterns.tsx` (11) — **72 entries total**, composed by
  `index.tsx` as `LIBRARY_TIERS`.
- `subpath` is the exact `package.json` `exports` key of the owning
  package, and `library-registry.test.ts` fails CI if a sanctioned export
  drifts out of sync with the registry. So the registry is a reliable,
  complete, *current* index of the design system's public surface — and
  each entry's `render()` is a real, working usage example.
- Rendered by `PlaygroundLibrary.tsx` at route `/playground/library`
  under the real theme (`ProductLifecycleRoot`), with a working
  light/dark toggle via `useColorMode`.

## Scope: two packages, not one

The sanctioned surface spans **both**:

- `@proliferate/ui` (`apps/packages/ui`) — primitives + patterns,
  ~53 exports, Radix-based, React 19, `tailwind-merge`.
- `@proliferate/product-ui` (`apps/packages/product-ui`) — the
  product-patterns tier.

Tokens/styles live in `@proliferate/design` (`apps/packages/design`),
consumed by both as `workspace:*`.

`config.json` currently pins `pkg` to `apps/packages/ui` only. Decide
whether the sync covers `product-ui` as well before the first real build.

## Build prerequisites

- pnpm (`pnpm-lock.yaml`) + Node v22.22.2 (`.nvmrc`), both available.
- Faithful install: `pnpm i --frozen-lockfile` from the repo root.
- `node_modules` is NOT installed in a fresh session, and
  `apps/packages/ui/dist` is NOT checked in — `@proliferate/ui` builds
  with plain `tsc -p tsconfig.json`, so a build is required before
  conversion.

## Blocked

- 2026-07-27: `DesignSync` returned an authorization error in this
  remote (claude.ai/code) session — `/design-login` needs an interactive
  terminal. Resolve via Claude Design's "Send to Claude Code Web", or run
  the sync from a local interactive terminal. No project was created, so
  `config.json` has no `projectId` yet.
