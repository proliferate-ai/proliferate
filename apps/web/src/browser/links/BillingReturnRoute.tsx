import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  buildDesktopDeepLink,
  decodeWebBillingReturn,
  emitWebInboundEntry,
} from "./web-product-links";

/**
 * The narrow `/settings/cloud` host route: the Stripe checkout/portal return
 * decoder. With `returnSurface=desktop` it hands the return back to a running
 * Desktop app through a `proliferate://settings/cloud` deep link (stripping the
 * `returnSurface` marker) and offers the manual retry / open-in-browser
 * fallback. Otherwise it emits the normalized `billing-return` entry and
 * navigates to shared billing settings. It owns no billing product UI.
 */
export function BillingReturnRoute() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) {
      return;
    }
    handledRef.current = true;

    if (searchParams.get("returnSurface") === "desktop") {
      const forwarded = new URLSearchParams(searchParams);
      forwarded.delete("returnSurface");
      const search = forwarded.toString();
      const link = buildDesktopDeepLink(
        "settings",
        `/cloud${search ? `?${search}` : ""}`,
      );
      setDeepLink(link);
      window.location.replace(link);
      return;
    }

    const entry = decodeWebBillingReturn(new URL(window.location.href));
    emitWebInboundEntry(entry);
    navigate("/settings/billing", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!deepLink) {
    return null;
  }

  const browserFallback = (() => {
    const forwarded = new URLSearchParams(searchParams);
    forwarded.delete("returnSurface");
    const search = forwarded.toString();
    return `/settings/billing${search ? `?${search}` : ""}`;
  })();

  return (
    <div
      data-testid="web-billing-desktop-handoff"
      style={{
        display: "flex",
        minHeight: "100vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
      }}
    >
      <p>If Proliferate didn't open, retry the handoff or continue in your browser.</p>
      {/* The host route owns no product UI; the retry is a plain anchor to the
          same Desktop deep link (equivalent to re-triggering the handoff). */}
      <a href={deepLink}>Open Proliferate</a>
      <a href={browserFallback}>Open billing in browser</a>
    </div>
  );
}
