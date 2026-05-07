import { create } from "zustand"
import type { AuthUser } from "@/lib/domain/auth/auth-user"
import type { StoredAuthSession } from "@/platform/tauri/auth"

export type AuthStatus = "bootstrapping" | "anonymous" | "authenticated"

export interface AuthState {
  status: AuthStatus
  session: StoredAuthSession | null
  user: AuthUser | null
  error: string | null
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "bootstrapping",
  session: null,
  user: null,
  error: null,

  clearError: () => {
    set({ error: null })
  },
}))
