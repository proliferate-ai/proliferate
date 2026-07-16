# ProductClient application-entry contract

This is the required application-entry shape for the mechanical extraction of
the Desktop product into `@proliferate/product-client`. The landed
qualification canary proves the signature, export subpath, provider envelope,
and build behavior before the real source move.

## Reserved source paths

```text
apps/packages/product-client/src/ProductClient.tsx
apps/packages/product-client/src/app/AuthenticatedProductClient.tsx
```

- `ProductClient.tsx` is the only public product entry.
- `AuthenticatedProductClient.tsx` is internal and lazy-loaded from
  `#product/app/AuthenticatedProductClient`.
- Neither file exists in the landed mechanics proof. The mechanical extraction
  creates both from the existing Desktop product.

## Public export subpath

The only public product entry is exported as
`@proliferate/product-client/ProductClient`:

```json
{
  "./ProductClient": {
    "types": "./dist/ProductClient.d.ts",
    "import": "./dist/ProductClient.js"
  }
}
```

The mechanical extraction emits `dist/ProductClient.{js,d.ts}` and adds this
export. Until then, the package carries a **temporary** public canary export
that stands in for it and is deleted when the real entry lands:

```json
{
  "./qualification/ProductClientBuildCanary": {
    "types": "./dist/qualification/ProductClientBuildCanary.d.ts",
    "import": "./dist/qualification/ProductClientBuildCanary.js"
  }
}
```

## Mount signature

```ts
export type ProductRoutesComponent = ComponentType<RoutesProps>

export interface ProductClientProps {
  RoutesComponent: ProductRoutesComponent
}

export function ProductClient({
  RoutesComponent,
}: ProductClientProps): ReactElement
```

- `ProductClient` receives exactly one host-infrastructure prop,
  `RoutesComponent`.
- Desktop and Web pass their existing Sentry-instrumented `InstrumentedRoutes`;
  the qualification browser host passes plain React Router `Routes`.
- `RoutesComponent` carries the host's Sentry instrumentation so ProductClient
  never imports Sentry. It is **not** stored in `ProductHost` and does **not**
  define product routes.
- ProductClient owns the product provider root, product route declarations, and
  product lifecycles beneath the envelope below.

## Provider envelope

```text
BrowserRouter
  -> QueryClientProvider
  -> CloudClientProvider
  -> ProductHostProvider
  -> ProductClient(RoutesComponent = host InstrumentedRoutes)
```

The browser qualification fixture passes `surface: "web"` and `desktop: null`;
any local/native lifecycle fails closed by not mounting.

## Package-private `#product/*` import mechanism

Moved modules resolve package-private imports through the compiled package:

```json
{
  "imports": {
    "#product/*": {
      "types": "./src/*",
      "default": "./dist/*.js"
    }
  }
}
```

- Runtime/host-build resolution (`default`) resolves `#product/*` to compiled
  `dist/*.js` and must **never** resolve back into `src`.
- In-package TypeScript resolves `#product/*` types to `src` via the `types`
  condition and a mirrored tsconfig `paths` entry
  (`"#product/*": ["./src/*"]`).
- Vitest resolves `#product/*` to `src` via a `resolve.alias` entry so tests run
  against source.
- Plain `tsc` does not rewrite the `#product/*` specifiers; it emits them
  verbatim, and Node/Vite resolve them through the package `imports` map at
  runtime/host-build time. This is what proves the compiled mechanism.

## Public-shell / lazy-authenticated split

`ProductClient` is a lightweight public/auth shell. The authenticated product
root is internal and lazy-loaded via `#product/app/AuthenticatedProductClient`,
so Web login and callback entrypoints do not eagerly load editor, terminal, or
other authenticated-only chunks. Connected repository/workspace action hosts
also mount inside that authenticated root; they must not be imported by the
public `App` shell. The mechanical move applies this exact shape to the real
Desktop product.

## Reserved-file rule

- `src/ProductClient.tsx` and `src/app/AuthenticatedProductClient.tsx` are
  reserved names owned by the mechanical move.
- The landed mechanics proof does not create them, export `./ProductClient`,
  or import Desktop source into the package.

## Landed qualification canary

The contract is qualified — without moving the product — by:

```text
apps/packages/product-client/src/qualification/
  ProductClientBuildCanary.tsx              # public/auth shell; props mirror ProductClientProps
  AuthenticatedProductClientBuildCanary.tsx # lazy-loaded via #product/qualification/...
  canary-lazy-chunk.tsx                     # additional on-demand chunk
  assets/**                                 # png, svg (url + ?raw), json (?raw + normal), mp3
apps/packages/product-client/src/assets.d.ts  # ambient resource/CSS/font declarations
apps/packages/product-client/scripts/copy-qualification-assets.mjs  # tsc-only asset copy into dist
```

The canary's prop shape is typed locally (`ProductClientBuildCanaryProps`); it is
a stand-in for `ProductClientProps` and is deleted with the rest of the canary
when the real entry lands. Because plain `tsc` cannot transform `?raw`,
asset-URL, CSS, or font imports, the ambient declarations keep the canary's
declaration-level build passing while the Vite host builds resolve and emit the
real resource URLs; the post-build copy script mirrors the resource inputs into
`dist/qualification/assets/**` for dist consumers.
