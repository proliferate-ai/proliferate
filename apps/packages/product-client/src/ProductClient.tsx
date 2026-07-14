import type { ComponentType, ReactElement } from "react"
import type { RoutesProps } from "react-router-dom"

import { App } from "#product/App"
import { ProductLifecycleRoot } from "#product/providers/ProductLifecycleRoot"
import { ProductProviderRoot } from "#product/providers/ProductProviderRoot"

// Shared product styles (xterm + @proliferate/design product CSS). The
// surface-specific desktop stylesheet is imported by the host entry, not here.
import "#product/index.css"

// The single host-infrastructure prop: the host's routes container. Desktop and
// Web pass their Sentry-instrumented `InstrumentedRoutes`; the qualification
// browser host passes plain React Router `Routes`. `RoutesComponent` carries the
// host's Sentry instrumentation so ProductClient never imports Sentry. It is not
// stored in `ProductHost` and does not define product routes.
export type ProductRoutesComponent = ComponentType<RoutesProps>

export interface ProductClientProps {
  RoutesComponent: ProductRoutesComponent
}

/**
 * The only public product entry.
 *
 * ProductClient owns the product provider root, the product lifecycle root
 * (including the single `AppErrorBoundary`), and the product route/UI tree. It
 * is a lightweight public/auth shell: the authenticated product root is internal
 * and lazy-loaded (see `App`), so host login/callback entrypoints do not eagerly
 * load editor/terminal or other authenticated-only chunks.
 *
 * It reads the single ProductHost, Query cache, and Cloud client mounted by the
 * host provider envelope above it (BrowserRouter -> QueryClientProvider ->
 * CloudClientProvider -> ProductHostProvider); it constructs none of them.
 */
export function ProductClient({ RoutesComponent }: ProductClientProps): ReactElement {
  return (
    <ProductProviderRoot>
      <ProductLifecycleRoot>
        <App RoutesComponent={RoutesComponent} />
      </ProductLifecycleRoot>
    </ProductProviderRoot>
  )
}
