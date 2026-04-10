import type { CloudAgentKind } from "@/lib/integrations/cloud/client";

export const CLOUD_CREDENTIAL_PROVIDER_ORDER: readonly CloudAgentKind[] = [
  "claude",
  "codex",
  "gemini",
];
