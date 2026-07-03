export const HARNESS_PANE_COPY = {
  surfaceCloud: "Cloud",
  surfaceLocal: "Local",
  tabAuthentication: "Authentication",
  tabAllModels: "All Models",
  authenticationTitle: "Authentication",
  signInTitle: "Authentication",
  gatewayLabel: "Proliferate gateway",
  apiKeysTitle: "API keys",
  envVarPlaceholder: "ENV_VAR_NAME",
  addVariable: "Add variable",
  addProvider: "Add provider",
  removeVariable: "Remove variable",
  runLogin: "Run login",
  runLoginOpening: "Opening...",
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
  // Native == the implicit empty state (contract §7): zero enabled sources.
  nativeStateLocal: "No auth configured — the CLI's own login is used.",
  nativeStateCloud: "No auth configured — cloud runs stay disabled for this harness.",
  cursorNativeDescription: (displayName: string) =>
    `${displayName} authenticates with its own sign-in. There is nothing to configure here.`,
  signInDescription: (displayName: string) =>
    `Sign in to Proliferate Cloud to manage how ${displayName} authenticates to models.`,
  authenticationDescription: (displayName: string) =>
    `How ${displayName} authenticates to models on this surface.`,
  selectionUpdateError: (displayName: string) =>
    `Could not update ${displayName} authentication.`,
  catalogRefreshError: (displayName: string) =>
    `Could not refresh the ${displayName} model catalog.`,
  catalogOverrideError: (displayName: string) =>
    `Could not update the ${displayName} model catalog.`,
  readyToast: (displayName: string) => `${displayName} is ready.`,
} as const;
