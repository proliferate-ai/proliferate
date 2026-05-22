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
    "Uses the admin-selected shared cloud default for each harness. A member's synced credential is eligible only after that member explicitly allows team use.",
  gatewayScopeTitle: "Gateway and BYOK",
  gatewayScopeDescription:
    "Org-owned provider credentials are routed through the gateway. Provider secrets are not written into hosted sandboxes.",
  myCredentialsTitle: "Personal cloud credentials",
  myCredentialsDescription:
    "Sync the credentials already active on this Mac. These cloud copies are used by your personal cloud sandbox and can optionally be made visible to team admins.",
  localAuthTitle: "Local auth",
  cloudCredentialsTitle: "Personal cloud copies",
  noCloudCredentials: "No cloud credential has been synced for this harness yet.",
  teamUseTitle: "Selected team",
  teamUseMemberDescription:
    "Choose which team your share actions apply to. Admins still choose whether shared cloud uses an allowed credential.",
  teamUseAdminDescription:
    "Choose which team you are configuring for member credential sharing and shared cloud defaults.",
  teamDefaultsTitle: "Shared cloud defaults",
  teamDefaultsDescription:
    "The org shared sandbox uses one selected credential per harness. Admins can select managed credits, org BYOK, or member synced credentials that were explicitly shared.",
  gatewayCredentialsTitle: "Organization gateway credentials",
  gatewayCredentialsDescription:
    "Add BYOK credentials owned by the organization. They become selectable shared cloud defaults and are routed through the gateway.",
  teamSyncOverviewTitle: "Member-shared credentials",
  teamSyncOverviewDescription:
    "Synced member credentials that are visible to this organization. Shared cloud can use only credentials with owner consent.",
} as const;
