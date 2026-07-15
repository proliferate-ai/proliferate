import type { CloudAgentKind } from "@proliferate/cloud-sdk/types";

export const CLOUD_CREDENTIAL_PROVIDER_ORDER: readonly CloudAgentKind[] = [
  "claude",
  "codex",
];
