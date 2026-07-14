import {
  lazy,
  Suspense,
  type ComponentType,
  type ReactElement,
} from "react";
import { Route, type RoutesProps } from "react-router-dom";

import { useProductHost } from "../host/ProductHostProvider";
import "./product-client-canary.css";

export type ProductRoutesComponent = ComponentType<RoutesProps>;

export interface ProductClientBuildCanaryProps {
  RoutesComponent: ProductRoutesComponent;
}

const LazyAuthenticatedCanary = lazy(() =>
  import("#product/qualification/AuthenticatedProductClientBuildCanary").then((module) => ({
    default: module.AuthenticatedProductClientBuildCanary,
  })),
);

export function ProductClientBuildCanary({
  RoutesComponent,
}: ProductClientBuildCanaryProps): ReactElement {
  const host = useProductHost();
  return (
    <RoutesComponent>
      <Route
        path="*"
        element={(
          <main
            className="product-client-build-canary"
            data-product-client-canary="public-shell"
            data-product-client-surface={host.surface}
            data-product-client-has-desktop={host.desktop === null ? "false" : "true"}
          >
            <div className="product-client-build-canary__card">
              <h1>ProductClient build canary</h1>
              <p>Public shell compiled through ProductClient package exports.</p>
              <Suspense fallback={<p>Loading authenticated canary…</p>}>
                <LazyAuthenticatedCanary />
              </Suspense>
            </div>
          </main>
        )}
      />
    </RoutesComponent>
  );
}
