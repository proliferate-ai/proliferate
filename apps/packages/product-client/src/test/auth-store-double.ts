import { create } from "zustand";
import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host";
import type { AuthUser } from "#product/lib/domain/auth/auth-user";
import type { StoredAuthSession } from "#product/lib/domain/auth/stored-auth-session";

/**
 * A package-local double of the retained Desktop `stores/auth/auth-store`
 * (WDU slice 04, ruling G7 / R5). The auth store is correctly host-`retain`
 * (host-only at runtime), so package tests cannot import it. This mirrors its
 * exact state shape so `setState`-driven tests keep steering auth state, then
 * bridge that snapshot into a ProductHost via `authStoreBridgedHost`. It carries
 * no host transport and asserts nothing beyond the store shape.
 */
export type AuthStatus = "bootstrapping" | "anonymous" | "authenticated";

export interface AuthState {
  status: AuthStatus;
  session: StoredAuthSession | null;
  user: AuthUser | null;
  error: string | null;
  issue: ProductAuthIssue | null;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "bootstrapping",
  session: null,
  user: null,
  error: null,
  issue: null,

  clearError: () => {
    set({ error: null });
  },
}));
