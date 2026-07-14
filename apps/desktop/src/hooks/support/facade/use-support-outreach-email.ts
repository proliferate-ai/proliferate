import { useCallback, useEffect, useRef, useState } from "react";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
import { getCurrentUser, updateCurrentUser } from "@proliferate/cloud-sdk/client/users";
import { useProductAuthUser } from "@/hooks/auth/facade/use-product-auth";

/**
 * Footer state for the support modals: which address support follow-up goes to,
 * and an inline editor that PATCHes the account-wide `outreach_email` override.
 *
 * The effective address is `outreach_email ?? account email` from
 * `GET /v1/users/me`. Saving an empty value clears the override (falls back to
 * the account email). Invalid emails surface the server's 422 as an inline
 * error rather than throwing.
 */
export interface SupportOutreachEmailState {
  /** The address updates are sent to: outreach override, else account email. */
  effectiveEmail: string | null;
  isEditing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  isSaving: boolean;
  error: string | null;
  beginEdit: () => void;
  cancelEdit: () => void;
  save: () => Promise<void>;
}

export function useSupportOutreachEmail(): SupportOutreachEmailState {
  // The signed-in identity's email, from the mounted ProductHost. This replaces
  // the former auth-store `session.email` read; the effective address is still
  // `outreach_email ?? account email` and the GET /users/me load below remains
  // the source of truth once it resolves.
  const sessionEmail = useProductAuthUser()?.email ?? null;
  const [accountEmail, setAccountEmail] = useState<string | null>(sessionEmail);
  const [outreachEmail, setOutreachEmail] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Load the persisted account-wide profile so the footer reflects the real
  // outreach override. Cloud may be unconfigured (dev bypass) — fall back to
  // the session email silently.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const user = await getCurrentUser();
        if (cancelled) {
          return;
        }
        setAccountEmail(user.email ?? sessionEmail);
        setOutreachEmail(user.outreach_email ?? null);
      } catch {
        // Keep the session email fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionEmail]);

  const effectiveEmail = outreachEmail ?? accountEmail;

  const beginEdit = useCallback(() => {
    setDraft(outreachEmail ?? "");
    setError(null);
    setIsEditing(true);
  }, [outreachEmail]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    const trimmed = draft.trim();
    try {
      const user = await updateCurrentUser({ outreach_email: trimmed.length > 0 ? trimmed : null });
      if (!mountedRef.current) {
        return;
      }
      setAccountEmail(user.email ?? accountEmail);
      setOutreachEmail(user.outreach_email ?? null);
      setIsEditing(false);
    } catch (caught) {
      if (!mountedRef.current) {
        return;
      }
      if (caught instanceof ProliferateClientError && caught.status === 422) {
        setError("Enter a valid email address.");
      } else {
        setError("Couldn't save. Please try again.");
      }
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [accountEmail, draft, isSaving]);

  return {
    effectiveEmail,
    isEditing,
    draft,
    setDraft,
    isSaving,
    error,
    beginEdit,
    cancelEdit,
    save,
  };
}
