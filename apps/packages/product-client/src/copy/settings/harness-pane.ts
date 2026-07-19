export const HARNESS_PANE_COPY = {
  surfaceCloud: "Cloud",
  surfaceLocal: "Local",
  authenticationTitle: "Authentication",
  signInTitle: "Authentication",
  runtimeTitle: "Runtime",
  runtimeDescription: "Installation and readiness for the selected runtime.",
  runtimeChecking: "Checking",
  runtimeUnavailable: "Unavailable",
  runtimeNotReported: "Not reported",
  runtimeCheckingDescription: "Checking the selected runtime for this harness.",
  runtimeUnavailableDescription: "Could not read harness readiness from the selected runtime.",
  runtimeReadyDescription: (targetLabel: string) =>
    `Installed and available on ${targetLabel}.`,
  runtimeUnsupportedDescription: (targetLabel: string) =>
    `This harness is not supported on ${targetLabel}.`,
  runtimeStatusDescription: (statusLabel: string, targetLabel: string) =>
    `${statusLabel} on ${targetLabel}.`,
  runtimeNotReportedDescription: (targetLabel: string) =>
    `${targetLabel} has not reported this harness yet.`,
  surfaceDescription: (surface: "cloud" | "local", displayName: string) =>
    surface === "local"
      ? `Configure how ${displayName} runs and authenticates on this machine.`
      : `Configure how ${displayName} authenticates in managed Cloud workspaces.`,
  gatewayLabel: "Proliferate gateway",
  apiKeysTitle: "API keys",
  envVarPlaceholder: "ENV_VAR_NAME",
  addVariable: "Add variable",
  // "Add API key" adds a binding ROW (env var + key picker); it does NOT create
  // a secret. Creating a vault secret happens from the row's KeyPicker.
  addApiKey: "Add API key",
  addProvider: "Add provider",
  // KeyPicker "New API key…" option → shared ApiKeyCreatorModal, create-only
  // (title + value, no env-var field). The row already owns the env-var binding.
  newApiKeyOption: "New API key…",
  newApiKeyOptionDetail: "Save a new secret to your vault and wire it here.",
  newApiKeyModalTitle: "New API key",
  newApiKeyModalDescription: "Save a new secret to your vault.",
  newApiKeySubmit: "Save key",
  addApiKeyError: "Could not add the API key.",
  removeVariable: "Remove variable",
  runLogin: "Authenticate",
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
  methodGatewayDescription: "Use managed model access.",
  methodApiKey: "API key",
  methodApiKeyDescription: "Use a saved provider key.",
  methodCli: "CLI login",
  methodCliDescription: "Use the harness's own session.",
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
  cliAlwaysActive: "Native logins always apply alongside other sources.",
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
  installAction: "Install",
  retryInstallAction: "Retry install",
  installingAction: "Installing...",
  installError: (displayName: string) =>
    `Could not install ${displayName}.`,
  readyToast: (displayName: string) => `${displayName} is ready.`,
  updateStartedToast: (displayName: string, targetLabel: string) =>
    `Updating ${displayName} on ${targetLabel}.`,
} as const;
