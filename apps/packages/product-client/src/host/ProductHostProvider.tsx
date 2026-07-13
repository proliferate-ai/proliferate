import { createContext, useContext, type ReactNode } from "react";

import type { ProductHost } from "./product-host";

const ProductHostContext = createContext<ProductHost | null>(null);

export interface ProductHostProviderProps {
  host: ProductHost;
  children: ReactNode;
}

/**
 * The single provider for the one host contract. It supplies the host object
 * verbatim — it does not mutate, clone, or reconstruct it — so consumers of
 * {@link useProductHost} receive the exact object the host passed in.
 * ProductHost is an immutable reactive snapshot: the host replaces this value
 * when auth, Cloud client, or deployment state changes.
 *
 * There is deliberately one context, not a context per capability.
 */
export function ProductHostProvider({
  host,
  children,
}: ProductHostProviderProps) {
  return (
    <ProductHostContext.Provider value={host}>
      {children}
    </ProductHostContext.Provider>
  );
}

/**
 * Read the current {@link ProductHost}. Throws when called outside a
 * {@link ProductHostProvider} so a missing provider fails loudly rather than
 * returning a silently-null host.
 */
export function useProductHost(): ProductHost {
  const host = useContext(ProductHostContext);
  if (host === null) {
    throw new Error(
      "useProductHost must be used within a ProductHostProvider. " +
        "Mount the host's ProductHostProvider above any ProductClient code.",
    );
  }
  return host;
}
