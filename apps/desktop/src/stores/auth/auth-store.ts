import { create } from "zustand"
import type { ProductAuthIssue } from "@proliferate/product-client/host/product-host"
import type { AuthUser } from "@/lib/domain/auth/auth-user"
import type { StoredAuthSession } from "@/lib/domain/auth/stored-auth-session"

export type AuthStatus = "bootstrapping" | "anonymous" | "authenticated"

export interface AuthState {
  status: AuthStatus
  session: StoredAuthSession | null
  user: AuthUser | null
  error: string | null
  // Normalized anonymous failure reason the host publishes as ProductAuthIssue.
  issue: ProductAuthIssue | null
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "bootstrapping",
  session: null,
  user: null,
  error: null,
  issue: null,

  clearError: () => {
    set({ error: null })
  },
}))
