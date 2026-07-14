import { lazy, Suspense } from "react";
import type { ComponentType, ReactElement } from "react";

// QUALIFICATION-ONLY build canary. It is not the product and must not be treated
// as one. It exists solely to prove that ProductClient's toolchain can compile
// and ship the public-shell / lazy-authenticated split, the package-private
// `#product/*` import mechanism, and every representative resource shape from
// both host builds. It is deleted when the mechanical move creates the real
// `src/ProductClient.tsx` entry.
//
// The prop shape mirrors the approved `ProductClientProps` recorded in
// specs/codebase/features/web-desktop-product-client-entry-contract.md. It is
// typed locally here on purpose: this PR must not import a placeholder product
// nor pre-create the reserved real types.

type CanaryRoutesProps = Record<string, never>;
export type CanaryRoutesComponent = ComponentType<CanaryRoutesProps>;

export interface ProductClientBuildCanaryProps {
  RoutesComponent: CanaryRoutesComponent;
}

// The authenticated root is internal and lazily loaded through the compiled
// `#product/*` import. Proving this here proves the exact split the real
// ProductClient entry will use so host login/callback entrypoints never eagerly
// pull authenticated-only chunks (editor/terminal/etc.).
const AuthenticatedProductClientBuildCanary = lazy(
  () => import("#product/qualification/AuthenticatedProductClientBuildCanary"),
);

export function ProductClientBuildCanary({
  RoutesComponent,
}: ProductClientBuildCanaryProps): ReactElement {
  return (
    <div data-testid="product-client-build-canary">
      {/* Host-supplied routes component (Desktop/Web pass their Sentry-
          instrumented InstrumentedRoutes; the browser fixture passes plain
          React Router Routes). ProductClient never imports Sentry. */}
      <RoutesComponent />
      <Suspense
        fallback={<div data-testid="authenticated-product-client-build-canary-fallback" />}
      >
        <AuthenticatedProductClientBuildCanary />
      </Suspense>
    </div>
  );
}
