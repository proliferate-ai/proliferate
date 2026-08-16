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
  // §1 — the harness identity line. Who makes this tool, not what this page
  // does (the page's sections already say that).
  harnessIdentity: {
    claude: "Anthropic's coding agent.",
    codex: "OpenAI's coding agent.",
    opencode: "The open-source coding agent.",
    grok: "xAI's coding agent.",
    cursor: "Cursor's CLI coding agent.",
  } as Record<string, string>,
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
  addApiKeyError: "Could not add the API key.",
  removeVariable: "Remove variable",
  runLogin: "Authenticate",
  runLoginOpening: "Opening...",
  // Section title for the inline all-models panel.
  tabAllModels: "Models",
  // The one content line of the collapsed Models section (design-handoff v2):
  // count in foreground, provenance suffix muted.
  allModelsSeedSuffix: "shipped catalog, not probed yet",
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
  allModelsRefreshFailedBadge: "last refresh failed",
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
  // PRO-206 — external links from the curated provider doc/console overlay.
  providerConsoleLink: "Get an API key",
  providerDocsLink: "Docs",
  // Method card labels.
  methodGateway: "Proliferate gateway",
  methodGatewayDescription: "Use managed model access.",
  methodApiKey: "API key",
  methodApiKeyDescription: "Use a saved provider key.",
  methodCli: "CLI login",
  methodCliDescription: "Use the harness's own session.",
  // §1 — the exit to the vendor tool's own documentation.
  docsLink: "Docs",
  // Gateway enrollment in flight (header badge, warning tone).
  gatewayPending: "Not ready",
  probeModelCount: (count: number) =>
    count === 1 ? "1 model" : `${count} models`,
  // CLI session expiry (header badge, warning tone).
  cliExpired: "Credentials expired",
  signInDescription: (displayName: string) =>
    `Sign in to Proliferate Cloud to manage how ${displayName} authenticates to models.`,
  authenticationDescription: (displayName: string, surface: "cloud" | "local") =>
    surface === "local"
      ? `How ${displayName} authenticates to models on this machine.`
      : `How ${displayName} authenticates to models in Proliferate Cloud.`,
  // The merged header status badge (design-handoff v2): the state is said
  // exactly once, in the Authentication/Providers section header.
  authBadgeAuthenticated: "Authenticated",
  authBadgeNotConfigured: "Not configured",
  authBadgeNotAuthenticated: "Not authenticated",
  authBadgeEnrollmentFailed: "Enrollment failed",
  // API key detail — the three configuration paths.
  segmentPasteKey: "Paste key",
  segmentSavedKeys: "Saved keys",
  savedKeyUse: "Use",
  savedKeysEmpty: "No saved keys in your vault yet.",
  configVaultNote: "Stored in your vault; delivered to the harness at launch.",
  // OpenCode providers section.
  providersTitle: "Providers",
  providersDescription: "Keys you add are wired into OpenCode alongside its own logins.",
  providersConfigure: "Configure",
  providersCliNote: "OpenCode's own CLI logins always apply alongside these keys.",
  providersNone: "No providers configured",
  providersConfiguredCount: (count: number) =>
    count === 1 ? "1 configured" : `${count} configured`,
  providerPickerLoadError: "Could not load the provider picker. Try again.",
  // Providers modal (management surface).
  providersModalTitle: "Providers",
  providersModalDescription: "Wire your own keys into OpenCode.",
  providersModalConfigured: "configured",
  providersModalRemove: "Remove",
  providersModalViewAll: (count: number) => `View all providers (${count})`,
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
  // R2.0 (always-managed install): one-time notice when a managed copy lands
  // alongside a harness the user already had on PATH.
  managedNoticeTitle: "Proliferate now maintains its own managed copy",
  managedNoticeDescription: (displayName: string) =>
    `Your own ${displayName} install is untouched and never modified.`,
  managedNoticeDismiss: "Got it",
} as const;
