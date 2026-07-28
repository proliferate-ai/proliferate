import type { ReactNode } from "react";
import { ProliferateLivingMark, RedirectCallbackScreen } from "@proliferate/ui";

/**
 * The screen is `min-h-screen` — it owns a whole browser tab in the product.
 * `className="h-full min-h-0"` wins the same twMerge min-height group, so the
 * cell can show it inside a window-sized frame instead of overflowing.
 */
function WindowFrame({ children, height = 560 }: { children: ReactNode; height?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border" style={{ height }}>
      {children}
    </div>
  );
}

/** The success landing after a GitHub OAuth round trip. */
export const SignInComplete = () => (
  <WindowFrame>
    <RedirectCallbackScreen
      className="h-full min-h-0"
      tone="success"
      statusLabel="Signed in"
      brandMark={<ProliferateLivingMark complete />}
      brandLabel="Proliferate"
      title="You're signed in"
      description="Your GitHub account is connected to proliferate.dev. You can close this tab and go back to the app."
      detail="Signed in as pablosfsanchez · GitHub"
      primaryAction={{ label: "Open Proliferate" }}
      secondaryAction={{ label: "Close tab" }}
    />
  </WindowFrame>
);

/** The failure branch: destructive chip, an explanation, and a way forward. */
export const CallbackFailed = () => (
  <WindowFrame>
    <RedirectCallbackScreen
      className="h-full min-h-0"
      tone="error"
      statusLabel="Sign-in failed"
      brandMark={<ProliferateLivingMark complete />}
      brandLabel="Proliferate"
      title="We couldn't finish signing you in"
      description="The authorization code had already been used. This usually means the callback URL was opened twice."
      detail="Error: invalid_grant (request 8c1f0b2e)"
      primaryAction={{ label: "Try again" }}
      secondaryAction={{ label: "Contact support" }}
    />
  </WindowFrame>
);

/** In flight, before the control plane has answered: neutral chip, no actions. */
export const Exchanging = () => (
  <WindowFrame>
    <RedirectCallbackScreen
      className="h-full min-h-0"
      tone="neutral"
      statusLabel="Completing sign-in"
      brandMark={<ProliferateLivingMark />}
      brandLabel="Proliferate"
      title="Finishing up"
      description="Exchanging your authorization code with the control plane. This tab will update on its own."
    />
  </WindowFrame>
);

/**
 * `variant="handoff"` is the desktop hand-off layout: the living mark leads,
 * there is no status chip, and a single full-width action closes it out.
 */
export const DesktopHandoff = () => (
  <WindowFrame>
    <RedirectCallbackScreen
      className="h-full min-h-0"
      variant="handoff"
      statusLabel="Opening the desktop app"
      title="Open Proliferate on this Mac"
      description="We handed your session to the desktop app. If nothing happened, open it manually and we'll pick up where you left off."
      detail="You can close this tab once the app is open."
      primaryAction={{ label: "Open the desktop app" }}
    />
  </WindowFrame>
);
