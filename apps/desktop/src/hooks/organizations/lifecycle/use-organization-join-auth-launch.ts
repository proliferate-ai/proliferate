import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useAuditedAuth } from "@/hooks/auth/facade/use-audited-auth";
import { writePendingOrganizationJoinTarget } from "@/lib/access/persistence/organization-join-target";
import { useProductStorageContext } from "@/hooks/persistence/facade/use-product-storage-context";
import { canFallbackToStandardInviteSignIn } from "@/lib/domain/organizations/join-auth";

function organizationJoinTargetFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get("joinOrganizationId");
}

// Owns invite-route auth launch before the authenticated Settings tree mounts.
export function useOrganizationJoinAuthLaunch() {
  const location = useLocation();
  const { auth } = useProductHost();
  const storage = useProductStorageContext();
  const authStatus = auth.state.status;
  const { startLogin } = useAuditedAuth();
  const startedForOrganizationRef = useRef<string | null>(null);
  const joinOrganizationId = useMemo(
    () => organizationJoinTargetFromSearch(location.search),
    [location.search],
  );

  useEffect(() => {
    if (!joinOrganizationId) {
      return;
    }
    void writePendingOrganizationJoinTarget(storage, joinOrganizationId);
  }, [joinOrganizationId, storage]);

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
