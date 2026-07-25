import { create } from "zustand"
import type {
  AuthClientState,
  AuthClientStatus,
} from "@/lib/domain/auth/auth-state-mapping"

export type AuthStatus = AuthClientStatus

// Authority fields (authority/authGeneration/credentialRevision) are owned by
// the desktop auth coordinator; nothing else may advance or reset them.
export interface AuthState extends AuthClientState {
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "bootstrapping",
  session: null,
  user: null,
  error: null,
  authority: null,
  authGeneration: 0,
  credentialRevision: 0,

  clearError: () => {
    set({ error: null })
  },
}))
