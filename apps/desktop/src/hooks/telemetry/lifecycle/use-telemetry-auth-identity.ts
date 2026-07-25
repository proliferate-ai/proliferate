import { useEffect, useRef } from "react";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useProductTelemetry } from "@/hooks/telemetry/facade/use-product-telemetry";

// Owns telemetry user identity and auth-status tags. Does not own auth state.
export function useTelemetryAuthIdentity() {
  const { auth } = useProductHost();
  const telemetry = useProductTelemetry();
  const authStatus = auth.state.status;
  const user = auth.state.status === "authenticated" ? auth.state.user : null;
  const previousIdentityKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const identityKey = authStatus === "authenticated" && user
      ? [
          authStatus,
          user.id,
          user.displayName ?? "",
          user.email ?? "",
          user.avatarUrl ?? "",
          user.githubLogin ?? "",
        ].join("\u0000")
      : `${authStatus}\u0000none`;
    if (previousIdentityKeyRef.current === identityKey) {
      return;
    }
    previousIdentityKeyRef.current = identityKey;

    if (authStatus === "authenticated" && user) {
      telemetry.setUser(user);
      telemetry.setTag("auth_status", "authenticated");
      return;
    }

    telemetry.setUser(null);
    telemetry.setTag("auth_status", authStatus);
  }, [authStatus, telemetry, user]);
}
