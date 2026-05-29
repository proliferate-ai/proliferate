import { Hand } from "lucide-react";
import { Button } from "@proliferate/ui/primitives/Button";

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

export function ClaimBanner({ view }: ClaimBannerProps) {
  if (view.kind === "hidden") {
    return null;
  }

  if (view.kind === "claimed_by_other") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Claimed by {view.claimantName}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{view.description}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-info/40 bg-info/10 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Hand size={15} />
          {view.title}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{view.description}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={view.onClaim}>
        {view.actionLabel}
      </Button>
    </div>
  );
}
