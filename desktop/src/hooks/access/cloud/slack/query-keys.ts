export function slackRootKey() {
  return ["cloud", "slack"] as const;
}

export function slackBotConfigKey(organizationId: string | null) {
  return [...slackRootKey(), "bot-config", organizationId] as const;
}

export function slackChannelsKey(organizationId: string | null) {
  return [...slackRootKey(), "channels", organizationId] as const;
}

export function slackRepoRoutingProfilesKey(organizationId: string | null) {
  return [...slackRootKey(), "repo-routing-profiles", organizationId] as const;
}
