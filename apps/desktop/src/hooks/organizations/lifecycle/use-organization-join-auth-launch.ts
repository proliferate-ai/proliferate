import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { writePendingOrganizationJoinTarget } from "@/lib/access/browser/organization-join-target";
import { canFallbackToStandardInviteSignIn } from "@/lib/domain/organizations/join-auth";

function organizationJoinTargetFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get("joinOrganizationId");
}

// Owns invite-route auth launch before the authenticated Settings tree mounts.
export function useOrganizationJoinAuthLaunch() {
  const location = useLocation();
  const { auth } = useProductHost();
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
    writePendingOrganizationJoinTarget(joinOrganizationId);
  }, [joinOrganizationId]);

  useEffect(() => {
    if (
      !joinOrganizationId
      || authStatus !== "anonymous"
      || startedForOrganizationRef.current === joinOrganizationId
    ) {
      return;
    }

    startedForOrganizationRef.current = joinOrganizationId;
    void auth.startLogin({
      kind: "sso",
      organizationId: joinOrganizationId,
      prompt: "select_account",
    }).catch(async (error: unknown) => {
      if (!canFallbackToStandardInviteSignIn(error)) {
        return;
      }

      try {
        await auth.startLogin({ kind: "github" });
      } catch {
        // AuthShell remains visible and lets the user retry manually.
      }
    });
  }, [auth, authStatus, joinOrganizationId]);
}
