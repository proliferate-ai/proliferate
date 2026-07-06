import { useAuthStore } from "@/stores/auth/auth-store";

export interface SupportAvailability {
  /** True only when a real Cloud session exists (uploads will succeed). */
  canSubmit: boolean;
  /**
   * Why support is unavailable, for menu/command `disabledReason`. Null when
   * available. Also null while auth is still bootstrapping — we don't want to
   * flash a "sign in" reason before the session has resolved.
   */
  disabledReason: string | null;
}

/**
 * Support reports always require a real Proliferate Cloud session to upload,
 * regardless of whether the app itself requires auth (dev builds run
 * `anonymous`). Gating the modal open on this makes the confusing
 * submit-then-"sign in, report queued" path unreachable: we never open the
 * modal unless the report can actually be sent.
 */
export function useSupportAvailability(): SupportAvailability {
  const status = useAuthStore((state) => state.status);

  if (status === "authenticated") {
    return { canSubmit: true, disabledReason: null };
  }
  if (status === "bootstrapping") {
    return { canSubmit: false, disabledReason: null };
  }
  return {
    canSubmit: false,
    disabledReason: "Sign in to Proliferate Cloud to send feedback.",
  };
}
