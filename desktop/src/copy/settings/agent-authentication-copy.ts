export const agentAuthenticationCopy = {
  pageTitle: "Agent Authentication",
  pageDescription:
    "How each harness reaches its model provider. Proliferate detects credentials already on this Mac and lets you choose which to sync to cloud sandboxes.",
  myCredentialsTitle: "My credentials",
  myCredentialsDescription:
    "Sync the credentials already active on this Mac. Personal cloud uses these by default, and you can explicitly allow a team to use synced credentials in shared cloud.",
  localAuthTitle: "Local auth",
  cloudCredentialsTitle: "Cloud copy",
  noCloudCredentials: "No cloud credential has been synced for this harness yet.",
  teamUseTitle: "Team use",
  teamUseMemberDescription:
    "Choose the team that share actions apply to. Admins still choose which shared cloud default uses the credential.",
  teamUseAdminDescription:
    "Choose the team for credential sharing and shared cloud defaults.",
  teamDefaultsTitle: "Team defaults",
  teamDefaultsDescription:
    "Org-wide credentials used by shared cloud when a workspace has not selected a user-specific credential. Admins can use managed credits, org BYOK, or member credentials with explicit owner consent.",
  gatewayCredentialsTitle: "Gateway credentials",
  gatewayCredentialsDescription:
    "Advanced BYOK credentials are stored in Cloud and routed through the gateway. Provider secrets are not written into hosted sandboxes.",
  teamSyncOverviewTitle: "Team sync overview",
  teamSyncOverviewDescription:
    "Credentials team members have synced to the cloud. Shared cloud can use only credentials with owner consent.",
} as const;
