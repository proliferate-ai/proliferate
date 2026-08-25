import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { buildDesktopDeepLink } from "./web-product-links";

/**
 * The narrow `/join/:orgId` host route. It hands the join off to Desktop via a
 * `proliferate://join/<orgId>` deep link (`proliferate-local://` on loopback).
 * It renders no product UI.
 */
export function OrganizationJoinRoute() {
  const { orgId } = useParams();
  const navigate = useNavigate();
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

    window.location.assign(
      buildDesktopDeepLink(`join/${encodeURIComponent(organizationId)}`),
    );
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
      Opening Proliferate…
    </output>
  );
}
