import type { DelegatedWorkStatusCategory } from "#product/lib/domain/delegated-work/model";
import { delegatedWorkSummaryPriority } from "#product/lib/domain/delegated-work/presentation";

export function compareDelegatedWorkStatus(
  left: DelegatedWorkStatusCategory,
  right: DelegatedWorkStatusCategory,
): number {
  return delegatedWorkSummaryPriority(left) - delegatedWorkSummaryPriority(right);
}
