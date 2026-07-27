export const HARNESS_PANE_COPY = {
  surfaceCloud: "Cloud",
  surfaceLocal: "Local",
  authenticationTitle: "Authentication",
  signInTitle: "Authentication",
  runtimeTitle: "Runtime",
  runtimeDescription: (surface: "cloud" | "local") =>
    surface === "local"
      ? "Installation and readiness on this machine."
      : "Installation and readiness in Proliferate Cloud.",
  runtimeChecking: "Checking",
  runtimeUnavailable: "Unavailable",
  runtimeNotReported: "Not reported",
  runtimeCheckingDescription: (surface: "cloud" | "local") =>
    surface === "local"
      ? "Checking this machine for this harness."
      : "Checking Proliferate Cloud for this harness.",
  runtimeUnavailableDescription: (surface: "cloud" | "local") =>
    surface === "local"
      ? "Could not read harness readiness from this machine."
      : "Could not read harness readiness from Proliferate Cloud.",
  runtimeReadyDescription: (surface: "cloud" | "local") =>
    surface === "local"
      ? "Installed and available on this machine."
      : "Installed and available in Proliferate Cloud.",
  runtimeUnsupportedDescription: (surface: "cloud" | "local") =>
    surface === "local"
      ? "This harness is not supported on this machine."
      : "This harness is not supported in Proliferate Cloud.",
  runtimeStatusDescription: (statusLabel: string, surface: "cloud" | "local") =>
    surface === "local"
      ? `${statusLabel} on this machine.`
      : `${statusLabel} in Proliferate Cloud.`,
  runtimeNotReportedDescription: (surface: "cloud" | "local") =>
    surface === "local"
      ? "This machine has not reported this harness yet."
      : "Proliferate Cloud has not reported this harness yet.",
  surfaceDescription: (surface: "cloud" | "local", displayName: string) =>
    surface === "local"
      ? `Configure how ${displayName} runs and authenticates on this machine.`
      : `Configure how ${displayName} runs and authenticates in Proliferate Cloud.`,
  installGateTitle: (displayName: string) => `Install ${displayName}`,
  installGateDescription: (surface: "cloud" | "local", displayName: string) =>
    surface === "local"
      ? `Install ${displayName} and its Proliferate adapter on this machine.`
      : `Install ${displayName} and its Proliferate adapter in Proliferate Cloud.`,
  installingGateTitle: (displayName: string) => `Installing ${displayName}`,
  installingGateDescription: (surface: "cloud" | "local") =>
    surface === "local"
      ? "Downloading and preparing the managed tools on this machine."
      : "Downloading and preparing the managed tools in Proliferate Cloud.",
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
  // Shown while an empty list has a probe in flight.
  allModelsProbing: "Probing…",
  // The composed observation (model-catalog.md "The picker is the
  // observation"): the only freshness display is the probedAt age plus the
  // lastAttempt outcome — age alone never blocks anything, and there is no
  // staleness state.
  allModelsRefreshingBadge: "refreshing…",
  allModelsRefreshFailedBadge: "last refresh failed",
  // Pre-first-observation seed: shipped catalog models, marked as unverified.
  allModelsUnverifiedBadge: "unverified",
  allModelsSeedDescription:
    "Showing shipped catalog models — not yet verified by a probe.",
  // Diagnostics-only provenance (attestation + install identity) — never a gate.
  allModelsProvenance: (line: string) => `Observed by ${line}`,
  allModelsModes: (modes: readonly string[]) => `Modes: ${modes.join(", ")}`,
  // `ago` is the raw duration from formatSnapshotAge ("5m", "2h", "3d", or the
  // literal "just now" — which must NOT get its own "ago" appended, hence the
  // special case rather than a blind template).
  allModelsFreshRefreshedAgo: (ago: string) =>
    ago === "just now" ? "refreshed just now" : `refreshed ${ago} ago`,
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
  // §1 — the exit to the vendor tool's own documentation.
  docsLink: "Docs",
  // §3 — the shared status section. One question ("am I authenticated"), one
  // answer shape, per method.
  statusTitle: "Status",
  gatewayAuthenticated: "Authenticated",
  gatewayPending: "Not ready",
  gatewayUnavailable: "Unavailable",
  gatewaySaved: "Gateway route selected",
  apiKeyAuthenticated: "Authenticated",
  // Saved-vs-live coexistence (§3): a key IS in the vault and wired to a
  // selection, but nothing is delivering it — "saved but failing", not either
  // fact alone.
  apiKeySavedNotActive: "Saved but not active",
  apiKeyNotConfigured: "Not configured",
  apiKeySaved: (count: number) => (count === 1 ? "1 key set" : `${count} keys set`),
  apiKeyRowHint: "Whether a saved key is wired into the enabled selection.",
  nativeRowHint: "The harness's own login session on this surface.",
  nativeRefreshChoice: "Refresh status",
  // §7 — probe status, on the same row component as §3.
  probeObserved: "Observed",
  probeNotYetRun: "Not probed yet",
  probeModelCount: (count: number) =>
    count === 1 ? "1 model" : `${count} models`,
  // CLI detail status.
  cliNotAuthenticated: "Not authenticated",
  cliExpired: "Credentials expired",
  cliAuthenticated: "Authenticated",
  cliUnknown: "Unknown",
  // Native == the implicit empty state (contract §7): zero enabled sources.
  // Same copy on both surfaces — the CLI's own login now runs identically
  // whether that CLI is the desktop process or the one inside the sandbox.
  nativeStateLocal: "No auth configured — the CLI's own login is used.",
  cliAlwaysActive: "Native logins always apply alongside other sources.",
  signInDescription: (displayName: string) =>
    `Sign in to Proliferate Cloud to manage how ${displayName} authenticates to models.`,
  authenticationDescription: (displayName: string) =>
    `How ${displayName} authenticates to models on this surface.`,
  selectionUpdateError: (displayName: string) =>
    `Could not update ${displayName} authentication.`,
  // Applied means acknowledged (agent-auth.md): shown from a selection write
  // until the surface's runtime confirms the delivered auth state.
  deliveryPending: "Applying…",
  // Restart offer (agent-auth.md "Running sessions are offered a restart",
  // Proof C6). Title and action labels are founder-settled copy — do not
  // reword them.
  restartModalTitle: "Restart running sessions on old auth?",
  restartModalConfirm: "yes, restart now",
  restartModalDecline: "no",
  restartModalDescription:
    "These sessions are still running on the previous authentication. "
    + "Restarting relaunches them on the new auth and keeps their transcripts.",
  catalogRefreshError: (displayName: string) =>
    `Could not refresh the ${displayName} model catalog.`,
  catalogOverrideError: (displayName: string) =>
    `Could not update the ${displayName} model catalog.`,
  installAction: (displayName: string) => `Install ${displayName}`,
  retryInstallAction: (displayName: string) => `Retry installing ${displayName}`,
  installingAction: (displayName: string) => `Installing ${displayName}…`,
  installError: (displayName: string) =>
    `Could not install ${displayName}.`,
  readyToast: (displayName: string) => `${displayName} is ready.`,
  updateStartedToast: (displayName: string, surface: "cloud" | "local") =>
    surface === "local"
      ? `Updating ${displayName} on this machine.`
      : `Updating ${displayName} in Proliferate Cloud.`,
} as const;
