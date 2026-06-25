import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthActions } from "@/hooks/auth/workflows/use-auth-actions";
import {
  canFallbackToStandardInviteSignIn,
} from "@/lib/domain/organizations/join-auth";
import {
  clearPendingOrganizationJoinTarget,
  readPendingOrganizationJoinTarget,
  writePendingOrganizationJoinTarget,
} from "@/lib/access/browser/organization-join-target";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { useAuthStore } from "@/stores/auth/auth-store";

export function useOrganizationJoinInvitationFlow() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authStatus = useAuthStore((state) => state.status);
  const { signInWithGitHub, signInWithSso } = useAuthActions();
  const signInStartedRef = useRef(false);
  const joinOrganizationId = useMemo(
    () => searchParams.get("joinOrganizationId"),
    [searchParams],
  );
  const [transientJoinOrganizationId, setTransientJoinOrganizationId] = useState(
    () => joinOrganizationId ?? readPendingOrganizationJoinTarget(),
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!joinOrganizationId) {
      return;
    }
    writePendingOrganizationJoinTarget(joinOrganizationId);
    signInStartedRef.current = false;
    setTransientJoinOrganizationId(joinOrganizationId);
    navigate(buildSettingsHref({ section: "organization-members" }), { replace: true });
  }, [joinOrganizationId, navigate]);

  const clearJoinTarget = useCallback(() => {
    clearPendingOrganizationJoinTarget();
    setTransientJoinOrganizationId(null);
  }, []);

  useEffect(() => {
    if (
      !transientJoinOrganizationId
      || authStatus !== "authenticated"
    ) {
      return;
    }
    setStatusMessage("Review and accept the invitation below to join this organization.");
  }, [authStatus, transientJoinOrganizationId]);

  useEffect(() => {
    if (
      !transientJoinOrganizationId
      || authStatus !== "anonymous"
      || signInStartedRef.current
    ) {
      return;
    }
    signInStartedRef.current = true;
    setStatusMessage("Opening organization sign-in to accept this invitation.");
    void signInWithSso({
      organizationId: transientJoinOrganizationId,
      prompt: "select_account",
    })
      .catch(async (error: unknown) => {
        if (!canFallbackToStandardInviteSignIn(error)) {
          setStatusMessage(
            "Sign in could not start. Use Account settings to sign in, then reopen the invite link.",
          );
          return;
        }

        setStatusMessage("Opening sign-in to accept this invitation.");
        try {
          await signInWithGitHub();
        } catch {
          setStatusMessage(
            "Sign in could not start. Use Account settings to sign in, then reopen the invite link.",
          );
        }
      });
  }, [authStatus, signInWithGitHub, signInWithSso, transientJoinOrganizationId]);

  return {
    joinOrganizationId: transientJoinOrganizationId,
    clearJoinTarget,
    statusMessage,
    setStatusMessage,
    unauthenticatedJoin: Boolean(transientJoinOrganizationId && authStatus !== "authenticated"),
  };
}
