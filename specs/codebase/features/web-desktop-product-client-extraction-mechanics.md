# ProductClient Extraction Mechanics

Status: qualification artifact for the Web/Desktop client unification migration.

This PR proves the mechanics needed by the next source-move PR without moving
Desktop product source.

## Future application entry

The real shared product entry remains reserved for the mechanical move:

```text
apps/packages/product-client/src/ProductClient.tsx
  -> @proliferate/product-client/ProductClient
```

Its approved signature is:

```ts
export type ProductRoutesComponent = ComponentType<RoutesProps>;

export interface ProductClientProps {
  RoutesComponent: ProductRoutesComponent;
}

export function ProductClient({
  RoutesComponent,
}: ProductClientProps): ReactElement;
```

The real entry is not created in this mechanics PR. The temporary public
qualification export is:

```text
@proliferate/product-client/qualification/ProductClientBuildCanary
```

It proves the same host envelope, package export resolution, lazy authenticated
chunk shape, product CSS, generated JSON, raw text/SVG imports, and emitted
image/audio/font assets.

## Qualification builds

Two production canary builds import the compiled ProductClient package:

```text
apps/desktop/qualification/product-client
apps/packages/product-client/qualification/browser-host
```

Both mount:

```text
Router
  -> QueryClientProvider
  -> CloudClientProvider
  -> ProductHostProvider
  -> ProductClientBuildCanary(RoutesComponent)
```

The browser host passes `surface: "web"` and `desktop: null`. The Desktop
qualification host passes `surface: "desktop"` and imports Desktop CSS, but it
does not mount a local runtime or native lifecycle.

## Move ledger and codemod

The exact Desktop source ledger is generated and checked by:

```bash
node scripts/migrate-desktop-product-client.mjs ledger
node scripts/migrate-desktop-product-client.mjs check-ledger
node scripts/migrate-desktop-product-client.mjs prove-codemod
```

The checked-in ledger lives at:

```text
specs/codebase/features/web-desktop-product-client-move-ledger.json
```

The codemod rewrites only ledger-approved moved/split Desktop-local imports to
`#product/*`. The proof command runs against a disposable copy and verifies a
second pass is empty.

## Legacy Web bundle baseline

The provisional legacy Web bundle collector is:

```bash
node scripts/collect-web-bundle-baseline.mjs \
  --dist apps/web/dist \
  --out specs/codebase/features/web-desktop-product-client-web-baseline.json
```

The Web replacement PR reruns this on its exact base and records the binding
budget baseline before deleting the legacy Web product.
