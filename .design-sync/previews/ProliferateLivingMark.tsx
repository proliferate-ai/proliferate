import { ProliferateLivingMark } from "@proliferate/ui";

/**
 * The pre-app brand mark. Its two states are the same geometry on different
 * CSS animations (`animate-brand-mark-breathe` while pending,
 * `animate-brand-mark-settle` once the session is known), so a still frame
 * catches the mark mid-breath rather than a different shape — the labels
 * below say which state each one is in.
 */
export const PendingAndSettled = () => (
  <div className="flex items-start gap-12 p-4">
    <div className="flex flex-col items-center gap-2">
      <ProliferateLivingMark />
      <span className="text-ui-sm text-muted-foreground">Pending (breathing)</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <ProliferateLivingMark complete />
      <span className="text-ui-sm text-muted-foreground">Complete (settled)</span>
    </div>
  </div>
);

/** Where it actually appears: the auth gate, above the sign-in copy. */
export const OnTheAuthGate = () => (
  <div className="flex w-full max-w-md flex-col items-start gap-5 p-4">
    <ProliferateLivingMark />
    <div className="flex flex-col gap-2">
      <h1 className="text-hero font-semibold text-foreground">Signing you in</h1>
      <p className="text-body text-muted-foreground">
        Checking your session with the control plane. This usually takes a second.
      </p>
    </div>
  </div>
);

/**
 * `className` lands on the icon, not the 48px box, so the mark keeps its
 * layout slot while its ink follows the surrounding tone.
 */
export const InkOverrides = () => (
  <div className="flex items-center gap-8 p-4">
    <div className="flex flex-col items-center gap-2">
      <ProliferateLivingMark complete />
      <span className="text-ui-sm text-muted-foreground">default</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <ProliferateLivingMark complete className="text-muted-foreground" />
      <span className="text-ui-sm text-muted-foreground">muted-foreground</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <ProliferateLivingMark complete className="text-primary" />
      <span className="text-ui-sm text-muted-foreground">primary</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <ProliferateLivingMark complete className="text-destructive" />
      <span className="text-ui-sm text-muted-foreground">destructive</span>
    </div>
  </div>
);
