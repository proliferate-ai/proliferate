import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { decodeWebAuthCallback } from "./web-auth-transport";

/**
 * The narrow `/auth/callback` host route. It terminates the browser OAuth/SSO
 * redirect: it decodes the cold callback query into a normalized
 * {@link AuthCallback}, hands it to `host.auth.finishLogin` exactly once, and
 * then enters ProductClient. It owns no product UI or auth gate — a success
 * flips the host `AuthState` to `authenticated` and a failure flips it to
 * `anonymous` with the normalized issue, and the shared ProductClient auth
 * surface renders from that state.
 *
 * Exactly-once contract: the code exchange runs at most once per document. A
 * module-instance ref single-flights the effect so React Strict Mode's
 * mount/unmount/mount does not start a second exchange, and `completeWebAuthFlow`
 * itself consumes and clears the one pending PKCE record so any repeated call
 * (reload, back-button) fails visibly through the shared auth-error state rather
 * than silently re-exchanging. There is no persistence, replay, or retry queue.
 */
export function AuthCallbackRoute() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { auth } = useProductHost();
  const startedRef = useRef(false);

  useEffect(() => {
    // Single-flight across the document. The ref persists through Strict Mode's
    // mount/unmount/mount, so the exchange begins exactly once; we deliberately
    // do NOT cancel the in-flight navigation on the synthetic Strict Mode
    // unmount (the component is immediately remounted and stays mounted), so the
    // one exchange still resolves into the product.
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const callback = decodeWebAuthCallback(searchParams);
    void auth
      .finishLogin(callback)
      .catch(() => {
        // The transport already published the normalized issue; the shared
        // anonymous auth-error surface renders it after navigation.
      })
      .finally(() => {
        navigate("/", { replace: true });
      });
    // Intentionally run once per document: the callback query is fixed for this
    // cold load, and the ref plus `completeWebAuthFlow`'s single-use pending
    // record guarantee at most one exchange even under Strict Mode remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <CallbackProgress />;
}

function CallbackProgress() {
  return (
    <output
      aria-live="polite"
      data-testid="web-auth-callback-progress"
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      Completing sign-in…
    </output>
  );
}
