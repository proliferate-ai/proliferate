import { createContext, useContext, type ReactNode } from "react";
import type {
  ProductResolvedWorkspaceConnection,
} from "#product/lib/access/anyharness/resolve-workspace-connection";

export type ProductWorkspaceConnectionResolver = (
  workspaceId: string,
) => Promise<ProductResolvedWorkspaceConnection>;

const ProductWorkspaceConnectionContext = createContext<
  ProductWorkspaceConnectionResolver | null
>(null);

export function ProductWorkspaceConnectionProvider({
  resolveConnection,
  children,
}: {
  resolveConnection: ProductWorkspaceConnectionResolver;
  children: ReactNode;
}) {
  return (
    <ProductWorkspaceConnectionContext.Provider value={resolveConnection}>
      {children}
    </ProductWorkspaceConnectionContext.Provider>
  );
}

export function useProductWorkspaceConnectionResolver(): ProductWorkspaceConnectionResolver {
  const resolveConnection = useContext(ProductWorkspaceConnectionContext);
  if (!resolveConnection) {
    throw new Error(
      "useProductWorkspaceConnectionResolver must be used inside ProductWorkspaceConnectionProvider",
    );
  }
  return resolveConnection;
}
