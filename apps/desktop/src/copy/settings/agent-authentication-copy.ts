export const agentAuthenticationCopy = {
  pageTitle: "Agent Authentication",
  pageDescription:
    "How each agent harness reaches its model provider in local and personal cloud work.",
  scopeOverviewTitle: "How cloud auth is chosen",
  personalCloudScopeTitle: "Personal cloud",
  personalCloudScopeDescription:
    "Uses the credential you sync for each harness below. Local auth stays local until you explicitly sync a cloud copy.",
  gatewayScopeTitle: "Gateway and BYOK",
  gatewayScopeDescription:
    "Org-owned provider credentials are routed through the gateway. Provider secrets are not written into hosted sandboxes.",
  myCredentialsTitle: "Personal cloud credentials",
  myCredentialsDescription:
    "Sync the credentials already active on this Mac. These cloud copies are used by your personal cloud sandbox.",
  localAuthTitle: "Local auth",
  cloudCredentialsTitle: "Personal cloud copies",
  noCloudCredentials: "No cloud credential has been synced for this harness yet.",
  teamUseTitle: "Selected team",
  gatewayCredentialsTitle: "Organization gateway credentials",
  gatewayCredentialsDescription:
    "Add BYOK credentials owned by the organization. They are routed through the gateway.",
  teamSyncOverviewTitle: "Member-shared credentials",
  teamSyncOverviewDescription:
    "Synced credentials visible to this organization.",
} as const;
