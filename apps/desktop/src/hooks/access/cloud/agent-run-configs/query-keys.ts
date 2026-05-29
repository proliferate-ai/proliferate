import type {
  CloudAgentRunConfigDefaultOwnerSelection,
  ListCloudAgentRunConfigsOptions,
} from "@/lib/access/cloud/client";

export function agentRunConfigsRootKey() {
  return ["cloud", "agent-run-configs"] as const;
}

export function agentRunConfigsListKey(
  options: ListCloudAgentRunConfigsOptions = {},
) {
  return [
    ...agentRunConfigsRootKey(),
    "list",
    options.ownerScope ?? "all",
    options.organizationId ?? null,
    options.agentKind ?? "all",
    options.usableIn ?? "all",
    options.status ?? "active",
  ] as const;
}

export function agentRunConfigKey(configId: string | null) {
  return [...agentRunConfigsRootKey(), "detail", configId] as const;
}

export function agentRunConfigDefaultsKey(
  options: CloudAgentRunConfigDefaultOwnerSelection = {},
) {
  return [
    ...agentRunConfigsRootKey(),
    "defaults",
    options.ownerScope ?? "personal",
    options.organizationId ?? null,
  ] as const;
}
