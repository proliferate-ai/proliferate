import { Hand } from "#product/primitives/icons/product";
import { Button } from "#product/primitives/Button";
import { NoticeBanner } from "#product/primitives/patterns/NoticeBanner";

export type ClaimBannerView =
  | { kind: "hidden" }
  | {
      kind: "claimed_by_other";
      claimantName: string;
      description: string;
    }
  | {
      kind: "unclaimed";
      title: string;
      description: string;
      actionLabel: string;
      onClaim?: () => void;
    };

interface ClaimBannerProps {
  view: ClaimBannerView;
}

// The banner sits in the transcript column, which runs on the 14px chat scale
// rather than the 13px UI scale NoticeBanner defaults to.
const CHAT_SCALE = "text-chat";

export function ClaimBanner({ view }: ClaimBannerProps) {
  if (view.kind === "hidden") {
    return null;
  }

  if (view.kind === "claimed_by_other") {
    return (
      <NoticeBanner
        className={CHAT_SCALE}
        title={`Claimed by ${view.claimantName}`}
      >
        {view.description}
      </NoticeBanner>
    );
  }

  return (
    <NoticeBanner
      tone="info"
      className={CHAT_SCALE}
      icon={<Hand />}
      title={view.title}
      action={(
        <Button variant="secondary" size="sm" onClick={view.onClaim}>
          {view.actionLabel}
        </Button>
      )}
    >
      {view.description}
    </NoticeBanner>
  );
}
