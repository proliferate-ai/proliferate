export const agentAuthenticationCopy = {
  pageTitle: "Agent Authentication",
  pageDescription:
    "How each agent harness reaches its model provider in local, personal cloud, and shared cloud work.",
  scopeOverviewTitle: "How cloud auth is chosen",
  personalCloudScopeTitle: "Personal cloud",
  personalCloudScopeDescription:
    "Uses the credential you sync for each harness below. Local auth stays local until you explicitly sync a cloud copy.",
  sharedCloudScopeTitle: "Shared cloud",
  sharedCloudScopeDescription:
    "Uses the admin-selected Shared Sandbox credential for each harness.",
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
  teamUseMemberDescription:
    "Team-wide work is configured in Shared Sandbox.",
  teamUseAdminDescription:
    "Choose which team you are configuring for Shared Sandbox defaults.",
  teamDefaultsTitle: "Shared cloud defaults",
  teamDefaultsDescription:
    "The org shared sandbox uses one selected credential per harness. Admins can select managed credits, org BYOK, or synced credentials available to the team.",
  gatewayCredentialsTitle: "Organization gateway credentials",
  gatewayCredentialsDescription:
    "Add BYOK credentials owned by the organization. They become selectable shared cloud defaults and are routed through the gateway.",
  teamSyncOverviewTitle: "Member-shared credentials",
  teamSyncOverviewDescription:
    "Synced credentials visible to this organization.",
} as const;
