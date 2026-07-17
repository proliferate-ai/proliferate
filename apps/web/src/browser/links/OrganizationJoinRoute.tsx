import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { startWebSsoFlow } from "../../lib/access/cloud/auth/web-auth-flow";
import { buildDesktopDeepLink } from "./web-product-links";

type JoinPhase = "resolving" | "desktop";

/**
 * The narrow `/join/:orgId` host route. It resolves the organization's SSO: when
 * the org has usable SSO, it starts Web SSO with the org's connection IDs (a
 * full-page redirect owned by the browser auth flow). When SSO is unavailable,
 * it preserves the existing Desktop handoff — a `proliferate://join/<orgId>`
 * deep link (`proliferate-local://` on loopback). It renders no product UI.
 */
export function OrganizationJoinRoute() {
  const { orgId } = useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<JoinPhase>("resolving");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const organizationId = orgId?.trim();
    if (!organizationId) {
      navigate("/", { replace: true });
      return;
    }

    let active = true;
    // `startWebSsoFlow` discovers the org's SSO connection and, when enabled,
    // redirects the page to the provider. Any failure (SSO disabled, discovery
    // unavailable) falls back to the Desktop handoff, matching legacy behavior.
    void startWebSsoFlow({ organizationId }).catch(() => {
      if (!active) {
        return;
      }
      setPhase("desktop");
      window.location.assign(
        buildDesktopDeepLink(`join/${encodeURIComponent(organizationId)}`),
      );
    });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <output
      aria-live="polite"
      data-testid="web-org-join-progress"
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {phase === "desktop" ? "Opening Proliferate…" : "Joining organization…"}
    </output>
  );
}
