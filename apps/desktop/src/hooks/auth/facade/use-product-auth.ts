import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import type {
  AuthState,
  ProductAuthUser,
} from "@proliferate/product-client/host/product-host";

/**
 * Product-side readers for the normalized auth state published by the mounted
 * ProductHost. Product code reads identity through these instead of the Desktop
 * auth store; the host owns transport and replaces its snapshot only when an
 * approved reactive input changes.
 *
 * `loading` is the shared spelling of the former Desktop `bootstrapping` status.
 */
export function useProductAuthState(): AuthState {
  return useProductHost().auth.state;
}

/** Normalized auth status: `loading` | `anonymous` | `authenticated`. */
export function useProductAuthStatus(): AuthState["status"] {
  return useProductHost().auth.state.status;
}

/**
 * The authenticated user id, or `null` while loading/anonymous or during the
 * cached-session degraded path where the user record is not present.
 */
export function useProductAuthUserId(): string | null {
  const state = useProductHost().auth.state;
  return state.status === "authenticated" ? (state.user?.id ?? null) : null;
}

/**
 * The authenticated, normalized user, or `null` while loading/anonymous or in
 * the cached-session degraded path.
 */
export function useProductAuthUser(): ProductAuthUser | null {
  const state = useProductHost().auth.state;
  return state.status === "authenticated" ? state.user : null;
}
