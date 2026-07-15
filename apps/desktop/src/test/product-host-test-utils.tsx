import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";

import type { ProductHost } from "@proliferate/product-client/host/product-host";
import { ProductHostProvider } from "@proliferate/product-client/host/ProductHostProvider";

import {
  makeTestProductHost,
  type TestProductHostOptions,
} from "@/test/product-host-fixtures";

/**
 * Render helpers that mount a real {@link ProductHostProvider}. The pure host
 * builders live in `product-host-fixtures` (which imports no ProductHostProvider)
 * so tests that mock the provider can import them without a circular import.
 */

export {
  makeTestProductHost,
  authStoreBridgedHost,
  testAuthState,
  type TestProductHostOptions,
  type TestAuthStateOptions,
} from "@/test/product-host-fixtures";

/** Wrap `ui` in a ProductHostProvider carrying a test host. */
export function renderWithProductHost(
  ui: ReactElement,
  options?: TestProductHostOptions,
) {
  const host = makeTestProductHost(options);
  return {
    host,
    ...render(<ProductHostProvider host={host}>{ui}</ProductHostProvider>),
  };
}

/** A `renderHook`/`render` wrapper factory bound to one test host. */
export function productHostWrapper(host: ProductHost) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ProductHostProvider host={host}>{children}</ProductHostProvider>;
  };
}
