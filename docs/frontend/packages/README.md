# Frontend Packages

Status: authoritative for shared frontend package ownership.

## Scope

- `apps/packages/design/**`
- `apps/packages/ui/**`
- `apps/packages/product-domain/**`
- `apps/packages/product-ui/**`
- `apps/packages/product-surfaces/**`

Use app-local code first. Put code in a package only when shared ownership
makes Desktop/Web/Mobile easier to keep in sync.

## Package Map

| Package | Owns | May Import | Must Not Import |
| --- | --- | --- | --- |
| `design` | Shared tokens, DOM CSS, React Native-safe token values. | Token/build tooling. | Product concepts, app code, SDK clients, hooks, stores. |
| `ui` | Canonical Desktop/Web DOM primitives and layout components. | `design`, React, DOM-safe libraries. | Product concepts, app code, SDK clients, hooks, stores, Tauri, React Native. |
| `product-domain` | Pure shared product rules, vocabulary, validation, projections, and view models. | Generated/SDK contract types, pure utilities. | React, DOM, React Native components, SDK clients, query clients, stores, app code, raw access. |
| `product-ui` | Shared Desktop/Web product presentation by domain and surface. Props in, callbacks out. | `design`, `ui`, `product-domain`, React, DOM-safe rendering libraries. | SDK clients, access helpers, query hooks, stores, routes, Tauri, AnyHarness runtime wiring, React Native, custom primitive redefinitions. |
| `product-surfaces` | Shared connected Desktop/Web Cloud surfaces with SDK/query wiring and product UI composition. | Cloud SDK React hooks, `product-domain`, `product-ui`, `ui`, `design`. | Desktop/Web app internals, Tauri, AnyHarness runtime wiring, app stores, app routes, React Native, custom primitive redefinitions. |

## Package Shape

```text
apps/packages/
  design/
    src/
      tokens.ts
      css/
        dom.css
        desktop.css
      react-native.ts

  ui/
    src/
      layout/
      primitives/

  product-domain/
    src/
      <domain>/

  product-ui/
    src/
      <domain>/
        <surface>/

  product-surfaces/
    src/
      <domain>/
        <surface>/
```

## Dependency Direction

```text
apps
  -> product-surfaces
  -> product-ui
  -> ui
  -> design

apps
  -> product-domain
product-surfaces -> product-domain
product-ui -> product-domain
```

Mobile may import `design/react-native`, `product-domain`, and SDK packages.
Mobile must not import DOM packages: `ui`, `product-ui`, or
`product-surfaces`.

## DOM UI Contract

`apps/packages/ui/**` is the single DOM primitive system for Desktop, Web,
`product-ui`, and `product-surfaces`.

Hard invariant: no DOM primitive component may be defined outside
`apps/packages/ui/**`.

A primitive component is any generic reusable control, shell, or low-level UI
building block, including a wrapper around a raw DOM control. This applies even
when the component has a different name but still behaves like a local button,
input, dialog, menu, tab, tooltip, badge, or layout primitive.

Primitives that belong in `ui`:

- `Button`, `IconButton`, button groups
- `Input`, `Textarea`, `Label`, `Select`
- `Checkbox`, `Switch`, radio controls
- `Tabs`, segmented controls
- `Menu`, `Popover`, `Tooltip`
- `Dialog`, modal shells, confirmation dialogs
- badges, pills, separators, scroll areas, layout shells

Rules:

- Do not define primitive components in `apps/desktop/src/**`,
  `apps/web/src/**`, `apps/packages/product-ui/**`, or
  `apps/packages/product-surfaces/**`.
- Do not define a second button/input/dialog/menu/select/tabs primitive with a
  different name.
- Do not restyle raw DOM controls at callsites to mimic a primitive.
- Do not render raw `<button>`, `<input>`, `<label>`, `<select>`, or
  `<textarea>` outside `apps/packages/ui/**`.
- If the primitive needs a new size, tone, density, icon position, loading
  state, destructive state, or layout mode, add that API to `ui` first.
- Callsite classes may handle layout and spacing. The primitive owns color,
  border, radius, typography, focus, hover, disabled, and loading behavior.
- `product-ui` composes `ui` primitives with product view models.
- `product-surfaces` composes Cloud SDK React hooks, `product-ui`, and `ui`
  primitives. It does not create its own primitive layer.
- Mobile has a separate native component layer and does not import DOM
  primitives.
- Primitive definitions outside `apps/packages/ui/**` violate this standard.
  Do not add them or copy them; put them in `ui`.

## When To Share

- Put a rule in `product-domain` when the same product decision or view
  model is needed by more than one app.
- Put a component in `product-ui` when Desktop and Web should render the
  same product presentation and data/callback props are enough.
- Put a surface in `product-surfaces` when Desktop and Web should share the
  same connected Cloud CRUD surface, including SDK React hooks and mutation
  wiring.
- Keep code app-local when it depends on Tauri, local AnyHarness runtime
  selection, native mobile navigation/storage, browser route state, app-local
  stores, or one-off UI.

## Package Rules

- Use concrete export-map subpaths such as
  `@proliferate/ui/primitives/Button`; do not add barrels.
- Package code must not import app code through `@/` or relative paths into an
  app.
- Package code must not import app stores, app providers, app routes, Tauri
  wrappers, or local AnyHarness runtime wiring unless the package table above
  explicitly allows it.
- Do not add `shared`, `common`, `types`, or `utils` buckets.
- Name package files for the rule, primitive, component, or surface they own.
- Tests live with shared logic when the logic is meaningful or risky.
- If sharing requires many app-specific branches, keep the code app-local and
  extract only the pure `product-domain` rule.

## Responsibilities

### `design`

Owns serializable design values and generated CSS.

```text
apps/packages/design/src/tokens.ts
apps/packages/design/src/css/dom.css
apps/packages/design/src/css/desktop.css
apps/packages/design/src/react-native.ts
apps/packages/design/dist/theme.css
```

Do not put product copy, product status colors, route concepts, or component
behavior here.

May import token source files and build tooling. Must not import React, app
code, SDK clients, stores, providers, query clients, or product concepts.

### `ui`

Owns canonical DOM primitives.

```text
apps/packages/ui/src/primitives/**
apps/packages/ui/src/layout/**
```

Use this for reusable controls and layout helpers with no Proliferate product
concepts. This is where primitive variants are added; apps and product
packages consume those variants instead of redefining primitives locally.

May import `design`, React, and DOM-safe libraries. Must not import product
concepts, app code, SDK clients, hooks, stores, Tauri, or React Native.

### `product-domain`

Owns pure product rules and view models.

```text
apps/packages/product-domain/src/<domain>/**
```

This is the primary sharing point for Mobile. If Mobile and Web need the same
behavior, share the rule here and render it separately in native and DOM UI.

May import generated or SDK types only when they are contract shapes. Must not
import SDK clients, SDK React hooks, React, DOM components, React Native
components, app code, stores, query clients, or access helpers.

### `product-ui`

Owns Desktop/Web DOM product components.

```text
apps/packages/product-ui/src/<domain>/<surface>/<Component>.tsx
```

Use this for product-specific rows, cards, panes, chat pieces, settings
sections, account/billing views, and other shared Desktop/Web presentation.
It must compose `ui` primitives for controls and must not create local
primitive lookalikes.

May import `design`, `ui`, `product-domain`, React, and DOM-safe rendering
libraries. Must not import SDK clients, SDK React hooks, access helpers, app
stores, app providers, app routes, Tauri, local AnyHarness runtime wiring, or
React Native.

Components here are UI-only: data in, callbacks out. If the component needs
query/mutation state, client construction, route state, or app store state, it
does not belong in `product-ui`.

### `product-surfaces`

Owns fully connected Desktop/Web Cloud surfaces.

```text
apps/packages/product-surfaces/src/<domain>/<surface>/**
```

A surface may call shared Cloud SDK React hooks and render `product-ui`.
App-specific routing, shell placement, Tauri/AnyHarness access, app stores,
telemetry wiring, and native mobile UI stay outside. Base controls still come
from `ui`.

May import Cloud SDK React hooks, `product-domain`, `product-ui`, `ui`, and
`design`. Must not import Desktop/Web app internals, app stores, app providers,
app routes, Tauri, local AnyHarness runtime wiring, or React Native.

Use this for shared connected Cloud surfaces where duplicating SDK/query wiring
in Desktop and Web would make the product harder to keep consistent. Do not
put Desktop-only runtime access, local workspace logic, or app shell behavior
in `product-surfaces`; pass app-specific callbacks or adapters from the app.
