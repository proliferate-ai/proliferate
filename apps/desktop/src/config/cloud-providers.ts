import type { CloudAgentKind } from "@/lib/access/cloud/client";

export const CLOUD_CREDENTIAL_PROVIDER_ORDER: readonly CloudAgentKind[] = [
  "claude",
  "codex",
  "gemini",
];
