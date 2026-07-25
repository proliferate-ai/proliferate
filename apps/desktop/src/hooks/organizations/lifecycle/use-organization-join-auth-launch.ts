import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useProductAuthActions } from "@/hooks/auth/workflows/use-product-auth-actions";
import { writePendingOrganizationJoinTarget } from "@/lib/workflows/organizations/organization-join-target-persistence";
import { canFallbackToStandardInviteSignIn } from "@/lib/domain/organizations/join-auth";
import { useProductStorageContext } from "@/hooks/app/facade/use-product-storage-context";

function organizationJoinTargetFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get("joinOrganizationId");
}

// Owns invite-route auth launch before the authenticated Settings tree mounts.
export function useOrganizationJoinAuthLaunch() {
  const location = useLocation();
  const { auth } = useProductHost();
  const persistence = useProductStorageContext();
  const { startLogin } = useProductAuthActions();
  const authStatus = auth.state.status;
  const startedForOrganizationRef = useRef<string | null>(null);
  const joinOrganizationId = useMemo(
    () => organizationJoinTargetFromSearch(location.search),
    [location.search],
  );

  useEffect(() => {
    if (!joinOrganizationId) {
      return;
    }
    void writePendingOrganizationJoinTarget(persistence, joinOrganizationId);
  }, [joinOrganizationId, persistence]);

  useEffect(() => {
    if (
      !joinOrganizationId
      || authStatus !== "anonymous"
      || startedForOrganizationRef.current === joinOrganizationId
    ) {
      return;
    }

    startedForOrganizationRef.current = joinOrganizationId;
    void startLogin({
      kind: "sso",
      organizationId: joinOrganizationId,
      prompt: "select_account",
    }).catch(async (error: unknown) => {
      if (!canFallbackToStandardInviteSignIn(error)) {
        return;
      }

      try {
        await startLogin({ kind: "github" });
      } catch {
        // AuthShell remains visible and lets the user retry manually.
      }
    });
  }, [authStatus, joinOrganizationId, startLogin]);
}
