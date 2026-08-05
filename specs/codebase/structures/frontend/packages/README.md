# Frontend Packages

Scope: `apps/packages/{design,product-domain,product-client}/**`

**Packages are the shared product tier, not a second frontend taxonomy.** Most
are 1-1 with an app-local layer. `product-client` is the deliberate exception:
it is the connected Desktop/Web application shared by two thin hosts.

| Package | = the shared tier of |
|---|---|
| `design` | app `styles/` + tokens |
| `product-domain` | `lib/domain` |
| `product-client` | the shared Desktop/Web product (primitives + components + pages + hooks + stores + providers) |

## The two governing rules

Everything else derives from these:

1. **Future-facing.** When adding new code, consider whether multiple apps will need it. Move it to a package **only when ≥2 apps need the same thing.** A package is never the default home.
2. **Platform — Mobile is DOM-free.** Mobile may import **only `product-domain` + `design/react-native`** (+ SDK packages). It must **never** import ProductClient or its DOM primitives.

ProductClient owns shared Desktop/Web components alongside routes, stores,
hooks, and Cloud/AnyHarness wiring, while raw host implementation such as Tauri,
browser auth transport, and vendor bootstrap stays in the thin hosts.

## Package map

| Package | Shared tier of | Owns | May import | Must NOT import |
|---|---|---|---|---|
| `design` | styles/tokens | shared tokens, DOM CSS, RN-safe token values | token/build tooling | product concepts, app code, SDK clients, hooks, stores |
| `product-domain` | `lib/domain` | pure shared product rules, vocab, validation, projections, view models, planners | generated/SDK **contract types**, pure utils | React, DOM, RN components, SDK clients, query clients, stores, app code, raw access |
| `product-client` | shared Desktop/Web product | canonical DOM primitives, shared product presentation, routes, pages, layered access/workflow/domain hooks and logic, stores, providers, Cloud/gateway/AnyHarness orchestration, and the typed host boundary | `product-domain`, `design`, Cloud/AnyHarness SDKs, React/router/query | Desktop/Web app internals, `@tauri-apps/**`, raw `invoke`, host auth transport, vendor telemetry implementations, RN, primitives outside `src/primitives/**` |

## Shape

```text
apps/packages/
  design/src/        tokens.ts · css/{product.css,desktop.css} · react-native.ts
  product-domain/src/<domain>/
  product-client/src/
    ProductClient.tsx
    primitives/
      *.tsx              # root DOM primitives
      patterns/          # generic primitive compositions
      icons/             # concrete glyph modules; no aggregate barrel
      utils/ · overlays/ # DOM-safe primitive infrastructure
    app/ · pages/ · components/ · hooks/ · stores/ · providers/ · lib/
    host/                # ProductHost, DesktopBridge, ProductHostProvider
```

## Dependency direction

```text
desktop/web -> product-client -> design
                           \----> product-domain
                           \----> Cloud/AnyHarness SDKs

product-client/primitives -> design + React/DOM-safe libraries
```

Mobile: `design/react-native` + `product-domain` + SDK only. **Never**
`product-client`.

## Per package

### `design`
The shared tier of app `styles/` + tokens. Owns serializable design values and generated CSS — tokens, DOM CSS, React Native-safe token values.

```text
design/src/tokens.ts · css/{product.css,desktop.css} · react-native.ts · dist/theme.css
```

Must not hold product copy, product status colors, route concepts, or component behavior. Imports token source + build tooling only — never React, app code, SDK clients, stores, providers, query clients, or product concepts.

### ProductClient `primitives/**`

The **single DOM primitive system** for the shared Desktop/Web product. It is a
nested lower layer inside ProductClient, not a second package.

```text
product-client/src/primitives/*.tsx
product-client/src/primitives/{patterns,icons,utils,overlays,__tests__}/**
```

**Hard invariant: no DOM primitive component may be defined outside `apps/packages/product-client/src/primitives/**`.** A primitive is any generic reusable control/shell/low-level building block — *including a differently-named wrapper* around a raw DOM control.

Primitives that belong here: `Button`/`IconButton`, `Input`/`Textarea`/`Label`/`Select`, `Checkbox`/`Switch`/radio, `Tabs`/segmented controls, `Menu`/`Popover`/`Tooltip`, `Dialog`/modal shells, badges/pills/separators/scroll-areas/layout shells.

#### Root files — the base tier

Root files hold Radix-backed base controls (`Dialog`, `AlertDialog`, `Popover`, `DropdownMenu`, `Sonner`, `Command`, plus the raw `checkbox-primitive`/`tooltip-primitive` pair) alongside low-level wrappers that compose them (`PopoverButton`, icon-button shells, and the `Checkbox`/`Tooltip` re-export shims). Every component is styled to the design contract via `design` tokens. `patterns/` holds compositions one level up (`ModalShell`, `ConfirmationDialog`, `CommandPalette`, and other multi-primitive assemblies).

- ProductClient code imports exact internal subpaths such as `#product/primitives/Dialog`; no barrels.
- `utils/class-names.ts` owns `cn()` and `utils/tw-merge.ts` owns the configured Tailwind merge wrapper.
- **New code imports the base primitive directly** when one exists for the need.

Two component families still ship a raw/wrapper pair under the same `primitives/` directory — `Checkbox` (`checkbox-primitive.tsx` + `Checkbox.tsx`) and `Tooltip` (`tooltip-primitive.tsx` + `Tooltip.tsx`) — because the wrapper's public name collided with the base primitive's. This overlap is **transitional, with the raw `-primitive` module as the survivor**: do not extend the wrapper further; add capability to the raw primitive and thin the wrapper.

Rules:
- Do **not** define primitives in `apps/desktop/src`, `apps/web/src`, or outside
  ProductClient's `src/primitives/**` subtree.
- Do **not** define a second button/input/dialog/menu/select/tabs primitive under another name, or restyle raw DOM controls at callsites to mimic one. *(Transitional exception: the `checkbox-primitive`/`tooltip-primitive` pairs above, resolving toward the raw module. No new pairs.)*
- Do **not** render raw `<button>`/`<input>`/`<label>`/`<select>`/`<textarea>` outside the primitives subtree.
- Need a new size/tone/density/icon-position/loading/destructive/layout mode? **Add the API to the owning primitive first.**
- Callsite classes may handle layout/spacing; the primitive owns color, border, radius, typography, focus, hover, disabled, and loading behavior.
- Mobile has a separate **native** component layer and does not import DOM primitives.

May import `design`, React, DOM-safe libraries, and files that resolve inside
`src/primitives/**`. Must not escape through relative, `#product/*`, or
internal ProductClient subpaths, or import product-domain, Cloud/AnyHarness
SDKs, React Query, hooks, stores, host/Tauri code, app aliases, or React Native.
Patterns may depend on sibling primitive owners inside the same logical
subtree.

### `product-domain`
The shared tier of `lib/domain` — same purity and shape (validation, vocabulary, projections, view models, **pure planners**), promoted for cross-app reuse.

```text
product-domain/src/<domain>/**
```

This is **Mobile's primary sharing point**: if Mobile and Web need the same behavior, share the rule here and render it separately in native and DOM UI. May import generated/SDK **contract types** only — never SDK clients, React, DOM/RN components, app code, stores, query clients, or access helpers. *Promote when:* ≥2 apps need the same decision or view model.

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

It owns shared Desktop/Web product presentation and may depend in the correct
direction on `product-domain`, `design`, and the Cloud/AnyHarness SDKs.
Connected surfaces use one ownership grid: components render, access hooks own
SDK React/query state, workflow hooks sequence actions, and `lib/domain` owns
pure projections.

Each thin host owns the infrastructure instances that mount the product: its
React root, router transport, Query client, Cloud-client construction/provider,
and `ProductHostProvider`. ProductClient owns product providers, routes, stores,
lifecycles, and Cloud/AnyHarness product composition. Its build and host builds
prove dynamic imports, generated inputs, CSS, fonts, assets, and both hosts.

It must **never** import either host (`apps/desktop/**`, `apps/web/**`), any
`@tauri-apps/**` package, raw Tauri `invoke`, or Desktop-relative `@/` aliases;
shared product code reaches native capability only through the optional
`host.desktop` bridge. Mobile stays outside `product-client` and DOM-free.

## Package rules

- Inside ProductClient, use concrete `#product/primitives/...` subpaths; **no barrels.**
- Package code must not import app code via `@/` or relative paths into an app, nor app stores/providers/routes/Tauri/AnyHarness wiring unless the map above allows it.
- Do not add generic `shared`/`common`/`types`/`utils` buckets outside the
  explicitly owned `primitives/utils/**` support tier. Name files for the
  rule, primitive, component, or surface they own.
- If sharing needs many app-specific branches, keep it app-local and extract only the pure `product-domain` rule.
- Tests live with shared logic when it's meaningful or risky.
