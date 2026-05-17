import { Hand } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";
import type { ClaimState } from "@proliferate/product-model/chats/model";

interface ClaimBannerProps {
  claimState: ClaimState;
}

export function ClaimBanner({ claimState }: ClaimBannerProps) {
  if (claimState.kind === "not_claimable" || claimState.kind === "claimed_by_me") {
    return null;
  }

  if (claimState.kind === "claimed_by_other") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Claimed by {claimState.claimantName}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            You can view this shared session, but desktop continuation belongs to the current claimant.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-info/40 bg-info/10 p-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Hand size={15} />
          Unclaimed shared session
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Claiming lets you continue this shared session from your desktop identity.
        </p>
      </div>
      <Button variant="secondary" size="sm">
        Claim
      </Button>
    </div>
  );
}
