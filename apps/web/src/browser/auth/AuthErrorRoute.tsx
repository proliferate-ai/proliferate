import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useWebSession } from "../cloud/WebCloudRoot";
import { mapFailureCallbackIssue } from "./web-auth-transport";

/**
 * The narrow `/auth/error` host route. The OAuth server redirects here with
 * a stable `?code=` when a callback fails before it ever reaches
 * `/auth/callback` (e.g. `web_beta_email_not_allowed`).
 * This route decodes that code into the normalized {@link ProductAuthIssue},
 * publishes it as the anonymous issue, and enters ProductClient — the shared
 * auth-error presentation renders from the host state. It recreates no Web auth
 * copy and no auth gate of its own.
 */
export function AuthErrorRoute() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { publishIssue } = useWebSession();
  const publishedRef = useRef(false);

  useEffect(() => {
    if (publishedRef.current) {
      return;
    }
    publishedRef.current = true;
    const code = searchParams.get("code") ?? "provider_error";
    publishIssue(mapFailureCallbackIssue(code));
    navigate("/", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
