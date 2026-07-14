# Frontend Packages

Status: authoritative for shared frontend package ownership.

Scope: `apps/packages/{design,ui,product-domain,product-ui,product-surfaces,product-client}/**`

**Packages are the shared product tier, not a second frontend taxonomy.** Most
are 1-1 with an app-local layer. `product-client` is the deliberate exception:
it is the connected Desktop/Web application shared by two thin hosts.

| Package | = the shared tier of |
|---|---|
| `design` | app `styles/` + tokens |
| `product-domain` | `lib/domain` |
| `product-ui` | `components` |
| `product-surfaces` | `components` + `hooks/access` (a *connected* page) |
| `product-client` | the connected Desktop/Web app (pages + hooks + stores + providers) |
| `ui` | — *(no app-local analog: the **only** home for DOM primitives)* |

## The two governing rules

Everything else derives from these:

1. **Future-facing.** When adding new code, consider whether multiple apps will need it. Move it to a package **only when ≥2 apps need the same thing.** A package is never the default home.
2. **Platform — Mobile is DOM-free.** Mobile may import **only `product-domain` + `design/react-native`** (+ SDK packages). It must **never** import the DOM packages: `ui`, `product-ui`, `product-surfaces`, `product-client`.

Promotion into a lower-level shared package removes app internals. In
particular, **`components → product-ui` loses hooks** and becomes pure
presentation: props in, callbacks out. ProductClient is different: it owns the
shared routes, stores, hooks, and Cloud/AnyHarness wiring, but loses raw host
implementation such as Tauri, browser auth transport, and vendor bootstrap.

## Package map

| Package | Shared tier of | Owns | May import | Must NOT import |
|---|---|---|---|---|
| `design` | styles/tokens | shared tokens, DOM CSS, RN-safe token values | token/build tooling | product concepts, app code, SDK clients, hooks, stores |
| `ui` | — (primitives only) | canonical Desktop/Web DOM primitives + layout | `design`, React, DOM-safe libs | product concepts, app code, SDK clients, hooks, stores, Tauri, React Native |
| `product-domain` | `lib/domain` | pure shared product rules, vocab, validation, projections, view models, planners | generated/SDK **contract types**, pure utils | React, DOM, RN components, SDK clients, query clients, stores, app code, raw access |
| `product-ui` | `components` | shared Desktop/Web product presentation — **props in, callbacks out** | `design`, `ui`, `product-domain`, React, DOM-safe render libs | SDK clients, access helpers, query hooks, stores, routes, Tauri, AnyHarness wiring, RN, custom primitives |
| `product-surfaces` | `components` + `hooks/access` | shared **connected** Desktop/Web Cloud surfaces (SDK/query wiring + `product-ui` composition) | Cloud SDK React hooks, `product-domain`, `product-ui`, `ui`, `design` | Desktop/Web app internals, Tauri, AnyHarness wiring, app stores, app routes, RN, custom primitives |
| `product-client` | connected Desktop/Web app | shared product routes, pages, components, hooks, stores, providers, Cloud/gateway/AnyHarness orchestration, and the typed host boundary | `product-surfaces`, `product-ui`, `product-domain`, `ui`, `design`, Cloud/AnyHarness SDKs, React/router/query | Desktop/Web app internals, `@tauri-apps/**`, raw `invoke`, host auth transport, vendor telemetry implementations, RN |

## Shape

```text
apps/packages/
  design/src/        tokens.ts · css/{dom.css,product.css,desktop.css} · react-native.ts
  ui/src/            kit/ · primitives/ · layout/ · lib/
  product-domain/src/<domain>/
  product-ui/src/<domain>/<surface>/
  product-surfaces/src/<domain>/<surface>/
  product-client/src/
    ProductClient.tsx
    app/ · pages/ · components/ · hooks/ · stores/ · providers/ · lib/
    host/                # ProductHost, DesktopBridge, ProductHostProvider
```

## Dependency direction

```text
desktop/web -> product-client -> product-surfaces -> product-ui -> ui -> design
                           \----> product-domain
                           \----> Cloud/AnyHarness SDKs
product-surfaces ----------------> product-domain
product-ui ----------------------> product-domain
```

Mobile: `design/react-native` + `product-domain` + SDK only. **Never**
`ui`/`product-ui`/`product-surfaces`/`product-client`.

## Per package

### `design`
The shared tier of app `styles/` + tokens. Owns serializable design values and generated CSS — tokens, DOM CSS, React Native-safe token values.

```text
design/src/tokens.ts · css/{dom.css,product.css,desktop.css} · react-native.ts · dist/theme.css
```

Must not hold product copy, product status colors, route concepts, or component behavior. Imports token source + build tooling only — never React, app code, SDK clients, stores, providers, query clients, or product concepts.

### `ui`
The **single DOM primitive system** for Desktop, Web, `product-client`,
`product-ui`, and `product-surfaces`. It has no app-local analog — this is the
*only* place primitives exist.

```text
ui/src/kit/** · ui/src/primitives/** · ui/src/layout/** · ui/src/lib/utils.ts
```

**Hard invariant: no DOM primitive component may be defined outside `apps/packages/ui/**`.** A primitive is any generic reusable control/shell/low-level building block — *including a differently-named wrapper* around a raw DOM control.

Primitives that belong here: `Button`/`IconButton`, `Input`/`Textarea`/`Label`/`Select`, `Checkbox`/`Switch`/radio, `Tabs`/segmented controls, `Menu`/`Popover`/`Tooltip`, `Dialog`/modal shells, badges/pills/separators/scroll-areas/layout shells.

#### `kit/` — the primitive tier going forward

`kit/` holds Radix-backed primitives (`Dialog`, `AlertDialog`, `Popover`, `Tooltip`, `DropdownMenu`, `ContextMenu`, `Checkbox`, `RadioGroup`, `Avatar`, `Separator`, `Skeleton`, `Table`, `Sonner`). The source is shadcn-derived and **we own it** — it is vendored, not a dependency — and every component is styled to the design contract via `design` tokens.

- Import via export-map subpaths: `@proliferate/ui/kit/Dialog` (the `./kit/<Component>` convention; no barrels, same as `primitives/`).
- `lib/utils.ts` exports `cn()` (tailwind-merge class joiner) at `@proliferate/ui/lib/utils`; kit components use it and callsites may too.
- **New code imports `kit/` directly** when a kit component exists for the need.

Relationship to `primitives/`: `primitives/` is the legacy tier. Its overlay components (`ModalShell`, `PopoverButton`, `Tooltip`, `ConfirmationDialog`) are thin wrappers that delegate to `kit/` and are being migrated. Four component families currently exist in both tiers — `Checkbox`, `Tooltip`, the Popover family, and the Dialog family. This overlap is **transitional, with `kit/` as the survivor**: do not extend the legacy twin; add capability to the kit component and thin the wrapper.

Rules:
- Do **not** define primitives in `apps/desktop/src`, `apps/web/src`,
  `product-client`, `product-ui`, or `product-surfaces`.
- Do **not** define a second button/input/dialog/menu/select/tabs primitive under another name, or restyle raw DOM controls at callsites to mimic one. *(Transitional exception: the four `kit/`↔`primitives/` pairs above, resolving toward `kit/`. No new pairs.)*
- Do **not** render raw `<button>`/`<input>`/`<label>`/`<select>`/`<textarea>` outside `ui`.
- Need a new size/tone/density/icon-position/loading/destructive/layout mode? **Add the API to `ui` first.**
- Callsite classes may handle layout/spacing; the primitive owns color, border, radius, typography, focus, hover, disabled, and loading behavior.
- Mobile has a separate **native** component layer and does not import DOM primitives.

May import `design`, React, DOM-safe libraries. Must not import product concepts, app code, SDK clients, hooks, stores, Tauri, or React Native.

### `product-domain`
The shared tier of `lib/domain` — same purity and shape (validation, vocabulary, projections, view models, **pure planners**), promoted for cross-app reuse.

```text
product-domain/src/<domain>/**
```

This is **Mobile's primary sharing point**: if Mobile and Web need the same behavior, share the rule here and render it separately in native and DOM UI. May import generated/SDK **contract types** only — never SDK clients, React, DOM/RN components, app code, stores, query clients, or access helpers. *Promote when:* ≥2 apps need the same decision or view model.

### `product-ui`
The shared tier of app `components` — same product presentation, but **strictly presentational**: props in, callbacks out, **no hooks, SDK, stores, or routes** (those stay app-local). Desktop/Web only.

```text
product-ui/src/<domain>/<surface>/<Component>.tsx
```

Use for product-specific rows, cards, panes, chat pieces, settings sections, account/billing views, and other shared Desktop/Web presentation. **Composes `ui` primitives** and must not create local primitive lookalikes. May import `design`, `ui`, `product-domain`, React, DOM-safe render libs. If a component needs query/mutation state, client construction, route state, or app store state, it does not belong here. *Promote when:* Desktop and Web should render the same presentation and data/callback props are enough.

### `product-surfaces`
A **connected page**: the shared tier of `components` + `hooks/access`. It calls shared **Cloud SDK React hooks** and renders `product-ui`, with base controls from `ui`.

```text
product-surfaces/src/<domain>/<surface>/**
```

May import Cloud SDK React hooks, `product-domain`, `product-ui`, `ui`, `design`. Must not import Desktop/Web app internals, app routing/shell placement, Tauri/AnyHarness access, app stores, telemetry wiring, or React Native — app-specific behavior stays in the app and is passed in as callbacks/adapters. *Promote when:* Desktop and Web should share the same connected Cloud CRUD surface, including SDK React hooks and mutation wiring, and duplicating that wiring would make the product harder to keep consistent.

### `product-client`
The shared connected Desktop/Web application, per
[`../../../systems/product/clients/web-desktop-unification/README.md`](../../../systems/product/clients/web-desktop-unification/README.md).
Desktop is the baseline; Desktop and Web become thin hosts that each construct
one typed `ProductHost` and mount the same product through `ProductHostProvider`.
Like the other shared packages, it builds to `dist` and is consumed through
`dist` export-map subpaths.

```text
product-client/src/host/**   # ProductHost + DesktopBridge types, ProductHostProvider
```

Current state is the foundation only: the host contract, the Desktop bridge
contract, and the provider. It may depend in the correct direction on
`product-surfaces`, `product-ui`, `product-domain`, `ui`, `design`, and the
Cloud/AnyHarness SDKs.

Each thin host owns the infrastructure instances that mount the product: its
React root, router transport, Query client, Cloud-client construction/provider,
and `ProductHostProvider`. ProductClient owns product providers, routes, stores,
lifecycles, and Cloud/AnyHarness product composition. The current `tsc`/`dist`
foundation proves the host contract only; before application source moves, a
focused build canary must prove ProductClient dynamic imports, generated
inputs, CSS, fonts, assets, and both host builds.

It must **never** import either host (`apps/desktop/**`, `apps/web/**`), any
`@tauri-apps/**` package, raw Tauri `invoke`, or Desktop-relative `@/` aliases;
shared product code reaches native capability only through the optional
`host.desktop` bridge. `product-surfaces` remains a separate package during
this migration (`product-client` may consume it without absorbing it). Mobile
stays outside `product-client` and DOM-free.

## Package rules

- Use concrete export-map subpaths (`@proliferate/ui/kit/Dialog`, `@proliferate/ui/primitives/Button`); **no barrels.**
- Package code must not import app code via `@/` or relative paths into an app, nor app stores/providers/routes/Tauri/AnyHarness wiring unless the map above allows it.
- No `shared`/`common`/`types`/`utils` buckets. Name files for the rule/primitive/component/surface they own.
- If sharing needs many app-specific branches, keep it app-local and extract only the pure `product-domain` rule.
- Tests live with shared logic when it's meaningful or risky.
