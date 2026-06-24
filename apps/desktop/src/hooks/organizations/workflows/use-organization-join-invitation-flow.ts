import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { OrganizationInvitationAcceptResponse } from "@proliferate/cloud-sdk/types";
import { useAuthActions } from "@/hooks/auth/workflows/use-auth-actions";
import {
  clearPendingOrganizationJoinTarget,
  readPendingOrganizationJoinTarget,
  writePendingOrganizationJoinTarget,
} from "@/lib/access/browser/organization-join-target";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { useAuthStore } from "@/stores/auth/auth-store";

interface UseOrganizationJoinInvitationFlowArgs {
  acceptInvitation: (organizationId: string) => Promise<OrganizationInvitationAcceptResponse>;
  setActiveOrganizationId: (organizationId: string | null) => void;
}

export function useOrganizationJoinInvitationFlow({
  acceptInvitation,
  setActiveOrganizationId,
}: UseOrganizationJoinInvitationFlowArgs) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const authStatus = useAuthStore((state) => state.status);
  const { signInWithGitHub } = useAuthActions();
  const joinAttemptedRef = useRef(false);
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
    joinAttemptedRef.current = false;
    signInStartedRef.current = false;
    setTransientJoinOrganizationId(joinOrganizationId);
    navigate(buildSettingsHref({ section: "organization-members" }), { replace: true });
  }, [joinOrganizationId, navigate]);

  useEffect(() => {
    if (
      !transientJoinOrganizationId
      || authStatus !== "authenticated"
      || joinAttemptedRef.current
    ) {
      return;
    }
    let cancelled = false;
    joinAttemptedRef.current = true;
    void acceptInvitation(transientJoinOrganizationId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        clearPendingOrganizationJoinTarget();
        setTransientJoinOrganizationId(null);
        setActiveOrganizationId(response.organization.id);
        setStatusMessage(`Joined ${response.organization.name}.`);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        clearPendingOrganizationJoinTarget();
        setTransientJoinOrganizationId(null);
        setStatusMessage("Invitation could not be accepted.");
      });
    return () => {
      cancelled = true;
    };
  }, [
    acceptInvitation,
    authStatus,
    setActiveOrganizationId,
    transientJoinOrganizationId,
  ]);

  useEffect(() => {
    if (
      !transientJoinOrganizationId
      || authStatus !== "anonymous"
      || signInStartedRef.current
    ) {
      return;
    }
    signInStartedRef.current = true;
    setStatusMessage("Opening sign-in to accept this invitation.");
    void signInWithGitHub()
      .catch(() => {
        setStatusMessage(
          "Sign in could not start. Use Account settings to sign in, then reopen the invite link.",
        );
      });
  }, [authStatus, signInWithGitHub, transientJoinOrganizationId]);

  return {
    statusMessage,
    setStatusMessage,
    unauthenticatedJoin: Boolean(transientJoinOrganizationId && authStatus !== "authenticated"),
  };
}
