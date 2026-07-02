export const HARNESS_PANE_COPY = {
  tabAuthentication: "Authentication",
  tabAllModels: "All Models",
  authenticationTitle: "Authentication",
  signInTitle: "Authentication",
  gatewayLabel: "Proliferate gateway",
  apiKeyLabel: "API key",
  apiKeyDescription: "Use one of your own provider keys from the key pool.",
  nativeLabel: "Native",
  runLogin: "Run login",
  runLoginOpening: "Opening...",
  resetToDefault: "Reset to default",
  inheritedBadge: "Inherited from defaults",
  overrideBadge: "Override",
  clearOverride: "Use default",
  editsDeferredNote:
    "Not attached right now. Changes are saved and apply when this machine attaches.",
  inheritedSourceToast:
    "This source comes from your defaults. Change it there, or override it here.",
  harnessSettingsTitle: "Harness settings",
  harnessSettingsPlaceholderLabel: "Harness-specific settings",
  harnessSettingsPlaceholderDescription:
    "Options unique to this harness will appear here.",
  allModelsRefresh: "Refresh",
  allModelsRefreshing: "Refreshing...",
  allModelsEmpty: "No models in the catalog for this surface yet.",
  allModelsLoading: "Loading model catalog...",
  getApiKey: "Get an API key",
  recommendedBadge: "Recommended",
  signInDescription: (displayName: string) =>
    `Sign in to Proliferate Cloud to manage how ${displayName} authenticates to models.`,
  authenticationDescription: (displayName: string) =>
    `How ${displayName} authenticates to models on this surface.`,
  nativeDescription: (displayName: string) =>
    `Use ${displayName}'s own sign-in on this machine.`,
  openCodeDescription: (displayName: string) =>
    `${displayName} combines sources: the gateway and your own provider keys can be enabled together.`,
  routeUpdateError: (displayName: string) =>
    `Could not update the ${displayName} route.`,
  sourcesUpdateError: (displayName: string) =>
    `Could not update the ${displayName} sources.`,
  catalogRefreshError: (displayName: string) =>
    `Could not refresh the ${displayName} model catalog.`,
  catalogOverrideError: (displayName: string) =>
    `Could not update the ${displayName} model catalog.`,
  readyToast: (displayName: string) => `${displayName} is ready.`,
} as const;
