export const HARNESS_PANE_COPY = {
  surfaceCloud: "Cloud",
  surfaceLocal: "Local",
  authenticationTitle: "Authentication",
  signInTitle: "Authentication",
  gatewayLabel: "Proliferate gateway",
  apiKeysTitle: "API keys",
  envVarPlaceholder: "ENV_VAR_NAME",
  addVariable: "Add variable",
  addApiKey: "Add API key",
  addProvider: "Add provider",
  // Shared "Add API key" modal (agent context).
  addApiKeyModalTitle: "Add API key",
  addApiKeyModalDescription:
    "Save a secret to your vault and wire it into this harness in one step.",
  addApiKeyEnvVarLabel: "Environment variable",
  addApiKeyEnvVarHelp: "The variable this key is exposed as, e.g. ANTHROPIC_API_KEY.",
  addApiKeySubmit: "Add key",
  addApiKeyError: "Could not add the API key.",
  removeVariable: "Remove variable",
  runLogin: "Run login",
  runLoginOpening: "Opening...",
  harnessSettingsTitle: "Harness settings",
  harnessSettingsPlaceholderLabel: "Harness-specific settings",
  harnessSettingsPlaceholderDescription:
    "Options unique to this harness will appear here.",
  // Section title for the inline all-models panel.
  tabAllModels: "All Models",
  allModelsRefresh: "Refresh",
  allModelsRefreshing: "Refreshing...",
  allModelsEmpty: "No models in the catalog for this surface yet.",
  allModelsLoading: "Loading model catalog...",
  // Shown while an empty catalog auto-probes the runtime for models.
  allModelsProbing: "Probing…",
  // Runtime-resolved gateway models (contract §5): freshness reads "seed" (the
  // catalog's fallback list, no probe yet) or "probed <time>" (a live probe).
  allModelsFreshnessSeed: "seed",
  allModelsFreshnessProbed: (time: string) => `probed ${time}`,
  getApiKey: "Get an API key",
  recommendedBadge: "Recommended",
  // Method card labels.
  methodGateway: "Proliferate gateway",
  methodApiKey: "API key",
  methodCli: "CLI login",
  // Detail section titles.
  detailsGateway: "Gateway",
  detailsApiKey: "API keys",
  detailsCli: "CLI login",
  // CLI detail status.
  cliNotAuthenticated: "CLI not authenticated",
  cliAuthenticated: "Authenticated",
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
  catalogRefreshRuntimeUnavailable: (displayName: string) =>
    `Local runtime unavailable — could not read ${displayName} models.`,
  catalogOverrideError: (displayName: string) =>
    `Could not update the ${displayName} model catalog.`,
  readyToast: (displayName: string) => `${displayName} is ready.`,
} as const;
