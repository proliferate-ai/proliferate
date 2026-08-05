import type { CloudOwnerSelection } from "@proliferate/cloud-sdk";
import { useLlmBalance } from "@proliferate/cloud-sdk-react";

export function useLlmBalanceAccess(
  owner: CloudOwnerSelection | undefined,
  enabled: boolean,
) {
  return useLlmBalance(owner, enabled);
}
