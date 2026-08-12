# Frontend Components

Components render UI. Hooks own React behavior, `lib/**` owns reusable logic,
and access layers own external systems.

This file owns the behavioral rules (what a component may do). The visual-vocabulary rules — the four jobs of UI code, the tier placement algorithm (primitives vs patterns vs domain patterns vs surfaces), area kits, the rule of two for promoting shapes into the library, and the UI-conformance review checklist — live in [DESIGN_SYSTEM.md § Component Library](../DESIGN_SYSTEM.md#component-library). Read that section before creating any component that renders something new.

## Ownership

- Components may render, call hooks, forward callbacks, and own local
  presentation state for their subtree.
- Components must not fetch, invalidate queries, construct clients, call raw
  Tauri/Cloud/AnyHarness helpers, coordinate multi-step workflows, or own
  reusable product rules.
- Product conditions reused across components belong in `lib/domain/**` or
  `apps/packages/product-client/src/domain/**` when shared with Mobile.
- A component callback that coordinates stores, queries, navigation, or remote
  mutations belongs in a workflow hook.

Red flags:

- raw Cloud, AnyHarness, MCP, or Tauri calls
- `queryClient.invalidateQueries` or direct query-key construction
- multiple store setters in one component callback
- repeated status-to-label/tone/icon maps
- non-trivial `useMemo` or `useEffect`
- async mutations, file parsing, product sorting/filtering, or multi-step state
  transitions

## Folder Shape

Organize app product components by domain, surface, then role:

```text
components/<domain>/<surface>/<role>/<Component>.tsx
```

Use fewer levels only when the domain is small. Domain answers "what product
area owns this?" Surface answers "where does this render?" Role answers "what
part of the surface is this?"

Rules:

- Top-level `components/<domain>/` folders are product areas, not UI shapes or
  transport boundaries.
- Avoid root buckets like `modals`, `panels`, `sidebar`, `topbar`, `shared`, or
  `common`.
- Single-file folders are usually noise unless the folder is the start of a
  cohesive surface or role.
- Pick one shape per parent. Do not mix many direct component files with nested
  role folders unless the direct files are surface entrypoints.
- When a flat component folder grows past roughly ten files, introduce
  surface/role folders before adding unrelated components.
- Component files use `PascalCase.tsx`.
- Do not put `.ts` files under `components/**`. Static metadata, copy, config,
  and pure presentation helpers belong in `config/**`, `copy/**`, or
  `lib/domain/**`.

## Shared UI

`apps/packages/product-client/src/primitives/**` is the only DOM primitive
layer.

Hard invariant: do not define DOM primitive components anywhere else.

A primitive component is any generic reusable control, shell, or low-level UI
building block: `Button`, `IconButton`, `Input`, `Textarea`, `Label`, `Select`,
`Checkbox`, `Switch`, `Tabs`, `Menu`, `Popover`, `Tooltip`, `Dialog`, `Modal`,
`Badge`, `Pill`, `Separator`, `ScrollArea`, layout shell, or a differently
named component that wraps/restyles the same raw DOM control.

New primitive definitions are forbidden in:

- `apps/desktop/src/**`
- `apps/web/src/**`
- `apps/packages/product-client/src/**` outside `primitives/**`

Primitive definitions outside
`apps/packages/product-client/src/primitives/**` violate this standard. Do
not add them, copy them, or create local variants beside them. Put the
primitive in ProductClient's primitives subtree, add the needed variant/prop
there, and update callsites to import it.

### `apps/packages/product-client/src/primitives`

- Owns base DOM controls and layout primitives: buttons, icon buttons, inputs,
  textareas, labels, selects, checkboxes, switches, tabs, menus, popovers,
  dialogs, tooltips, badges, separators, scroll areas, and layout shells.
- Must not import app code, SDK clients, stores, product hooks, access helpers,
  Tauri APIs, React Native, routes, or product concepts.
- May import `design`, React/DOM-safe libraries, and sibling owners that resolve
  inside the same primitives subtree. `patterns/**` may compose root primitives.
- Must expose variants/props for repeated visual treatments. Do not create a
  one-off restyled button/input/dialog at the callsite.
- Is the only place in DOM frontend code that should define the base visual
  contract for raw controls.

### ProductClient feature code, Desktop, and Web

- ProductClient feature code must use exact `#product/primitives/...` imports
  for base controls. Desktop and Web consume the public ProductClient surface
  and must not reach into internal primitive subpaths.
- Must not define or redefine primitive components, even with different names.
- Must not render raw `<button>`, `<input>`, `<label>`, `<select>`, or
  `<textarea>` outside ProductClient's primitives subtree.
- May pass layout/sizing classes when the primitive API allows it, but must not
  rebuild color, border, radius, typography, focus, disabled, or hover behavior
  at the callsite.
- If a needed primitive variant does not exist, add it to
  `apps/packages/product-client/src/primitives/**` and then consume it
  everywhere.

### `apps/packages/product-client`

- Owns shared Desktop/Web presentation and connected surfaces under its
  standard component, hook, and library roots.
- Components render and call ProductClient hooks; Cloud SDK React access
  belongs under `hooks/access/cloud/**`, never in components.
- Feature components may consume pure shared models through concrete
  `#product/domain/<file>` imports.
- Must use its nested `primitives/**` owner for base controls.
- Must not import Desktop/Web host internals, Tauri, or React Native.

### Mobile

- Renders native components under `apps/mobile/src/components/**`.
- May share concrete
  `@proliferate/product-client/internal/domain/<file>` view models and
  `apps/packages/design/src/react-native.ts` tokens.
- Must not import the ProductClient root, another internal subtree, or any DOM
  ProductClient component.

Within ProductClient, use concrete subpaths such as
`#product/primitives/Button` or
`#product/components/settings/panes/account/AccountSettingsPane`; do not add
barrels.
