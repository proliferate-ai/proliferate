import { Badge } from "@proliferate/ui/primitives/Badge";

import type { BillingPlanView } from "./billing-types";
import {
  formatHours,
  grantTypeLabel,
  secondsToHours,
  visibleGrantAllocations,
} from "./billing-presentation";

export function CreditGrantBreakdown({ plan }: { plan: BillingPlanView }) {
  const grants = visibleGrantAllocations(plan.grantAllocations);
  if (grants.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 border-t border-border-light pt-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">Credit usage</div>
          <p className="text-xs leading-5 text-muted-foreground">
            Consumed hours across free trial, included, refill, and Team period grants.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {formatHours(grants.reduce((total, grant) => total + secondsToHours(grant.consumedSeconds), 0))} used
        </div>
      </div>
      <div className="space-y-2">
        {grants.map((grant) => {
          const totalHours = secondsToHours(grant.totalSeconds);
          const consumedHours = secondsToHours(grant.consumedSeconds);
          const remainingHours = secondsToHours(grant.remainingSeconds);
          const percent = totalHours > 0
            ? Math.min(100, Math.max(0, (consumedHours / totalHours) * 100))
            : 0;
          return (
            <div key={`${grant.grantType}:${grant.totalSeconds}:${grant.active}`} className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {grantTypeLabel(grant.grantType)}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {formatHours(consumedHours)} / {formatHours(totalHours)}
                </span>
                {!grant.active ? <Badge tone="neutral">Inactive</Badge> : null}
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
                <div className="h-full rounded-full bg-foreground/70" style={{ width: `${percent}%` }} />
              </div>
              <div className="text-xs text-muted-foreground">
                {grant.active ? `${formatHours(remainingHours)} remaining` : "No longer active"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
