export const agentAuthenticationCopy = {
  pageTitle: "Agent Authentication",
  pageDescription:
    "How each harness reaches its model provider. Proliferate detects credentials already on this Mac and lets you choose which to sync to cloud sandboxes.",
  adminHint:
    "Team-default credentials and the org-wide sync overview are only visible to admins.",
  syncRowTitle: "Sync to cloud",
  syncRowDescription:
    "What cloud agents use when running on your behalf. Synced credentials are checked on a recurring basis.",
  teamDefaultTitle: "Team default",
  teamDefaultDescription:
    "Org-wide credential used when a member has not synced their own. Hosted cloud uses managed credits first; BYOK stays gated by deployment capability.",
  detectedCredentialsTitle: "Detected credentials",
  noCredentials: "No credentials are available for this harness yet.",
  teamSyncOverviewTitle: "Team sync overview",
  teamSyncOverviewDescription:
    "Credentials team members have synced to the cloud. Shared cloud can use only credentials with owner consent.",
} as const;
