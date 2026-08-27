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
  // The one content line of the collapsed Models section (Settings - Harness
  // Models States handoff, all eight states): count/title in foreground,
  // provenance suffix muted.
  allModelsSeedSuffix: "shipped catalog, not probed yet",
  allModelsRefresh: "Refresh",
  allModelsRefreshing: "Refreshing…",
  allModelsEmpty: "No models detected yet.",
  // State 1 — initial HTTP loading, no payload yet.
  allModelsLoading: "Loading models…",
  // State 2 — state=detecting|refreshing AND probePhase=running: an active
  // first observation or re-probe. Never paired with a count.
  allModelsChecking: "Checking available models…",
  // State 3 — state=detecting AND probePhase=idle (or unknown): a harness
  // that legitimately sits unobserved forever because it isn't probed
  // unattended (the Cursor regression fixture). Refresh stays enabled; this
  // replaces the old indefinite "Probing…" + disabled Refresh bug.
  allModelsIdleUnobservedTitle: "Models haven't been detected yet",
  // The trailing "Refresh checks now." names a control that only exists on
  // the local surface (cloud has no manual-refresh route) — E-R5: never
  // instruct the user to press a control the section doesn't render.
  allModelsIdleUnobservedSuffix: (displayName: string, canManuallyRefresh: boolean) =>
    canManuallyRefresh
      ? `${displayName} reports models after its first launch. Refresh checks now.`
      : `${displayName} reports models after its first launch.`,
  // State 5 — state=observed_empty: a settled, honest zero.
  allModelsObservedEmptySuffix: (displayName: string, ago: string) =>
    `${displayName} reported none · ${HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(ago)}`,
  // The composed observation (model-catalog.md "The picker is the
  // observation"): the only freshness display is the probedAt age plus the
  // lastAttempt outcome — age alone never blocks anything, and there is no
  // staleness state.
  allModelsRefreshFailedBadge: "last refresh failed",
  // State 6 — state=last_good_after_failure: the prior observation stays
  // rendered, undimmed, with exactly one refresh-failed line appended.
  allModelsLastGoodAfterFailureSuffix: (ago: string) =>
    `${HARNESS_PANE_COPY.allModelsRefreshFailedBadge} · ${HARNESS_PANE_COPY.allModelsFreshRefreshedAgo(ago)}`,
  // State 7 — state=failed_without_observation: no count line exists to
  // fake; an explicit failure with its enabled cure (ruling 5).
  allModelsFailedWithoutObservationTitle: "Couldn't check models",
  allModelsProbeFailureReason: (displayName: string) => `${displayName} didn't answer the probe.`,
  /**
   * E-R37: the same failure, seen from a surface that cannot dispatch a probe.
   * It names Retry because Retry is the control actually rendered, and it says
   * "checks for" rather than "refreshes" because the button re-reads the stored
   * result; the probe itself is re-run by whichever runtime owns the engine.
   */
  allModelsProbeFailureRecheckSuffix: (displayName: string) =>
    `${displayName} didn't answer the probe. Retry checks for a newer result.`,
  // State 8 — the launch-options request itself failed (no payload). Never
  // rendered as a raw state string.
  allModelsTransportErrorTitle: "Models couldn't be loaded",
  allModelsTransportErrorReason: "The runtime didn't respond.",
  // E-R17 — no payload because the local runtime is still coming up, so the
  // read has no URL to call. Nothing was asked and nothing failed, and the
  // connect retry cures it with no user action: say that, never state 8.
  allModelsRuntimeConnectingTitle: "Connecting to the local runtime",
  allModelsRuntimeConnectingSuffix: "Models load as soon as it's ready.",
  // E-R18 — no payload because the account has no cloud workspace, so the
  // target-scoped read has no target and never runs. Permanent until a
  // workspace exists, and cloud renders no Refresh to cure it — so this is
  // neither a spinner nor a failure.
  allModelsCloudNoWorkspaceTitle: "No cloud workspace yet",
  allModelsCloudNoWorkspaceSuffix: (displayName: string) =>
    `${displayName} models are listed once a cloud workspace exists.`,
  // E-R22/E-R33 — `pollUntilHealthy` gave up. Creating or selecting a session
  // re-runs the whole bootstrap, so this is not the dead end an earlier round
  // claimed, but nothing in this pane retries it. Retry restarts the runtime
  // through the host bridge, which is a control this section does render, so
  // E-R5 (never name a button that isn't here) is satisfied by naming it.
  allModelsRuntimeFailedTitle: "The local runtime didn't start",
  allModelsRuntimeFailedSuffix: "Retry restarts the local runtime.",
  // E-R34 — there is no local runtime on this host at all (Web has no desktop
  // bridge, so `connectionState` never leaves its initial "connecting"). A
  // terminal fact, not a connection in progress: never spin for it.
  allModelsLocalUnavailableTitle: "Local models aren't available here",
  allModelsLocalUnavailableSuffix: "The local runtime is part of the Proliferate desktop app.",
  // E-R23 — query-core parked the request because the browser is offline.
  // Nothing is in flight and nothing failed; the network returning resumes it.
  allModelsOfflineTitle: "You're offline",
  allModelsOfflineSuffix: "Models load when the connection is back.",
  // E-R28 — the same offline gate parks the refresh MUTATION, which query-core
  // reports as `pending` with no timeout. The models already on screen are not
  // waiting on anything, so this says what is actually parked: the refresh.
  allModelsRefreshOfflineSuffix: "The refresh runs when the connection is back.",
  // E-R24 — a structured 404 from the cloud read: the target exists and the
  // server answered, it just has nothing ingested yet. The ordinary first-run
  // screen for a workspace that has never run an agent, not a failure.
  allModelsCloudNotObservedSuffix: (displayName: string) =>
    `${displayName} reports models after its first run in this workspace.`,
  // A genuine cloud transport failure, kept apart from the local runtime's:
  // "the runtime didn't respond" names the wrong hop for a cloud API call.
  // E-R30 — reserved for the case where nothing came back at all. A non-2xx
  // response IS a response, so claiming silence for it asserts a cause that
  // was never established.
  allModelsCloudUnreachableReason: "Proliferate Cloud didn't respond.",
  // E-R30 — the server answered with an error the pane has no specific arm
  // for. All that is established is that the read failed at the cloud hop.
  allModelsCloudErrorReason: "Proliferate Cloud returned an error.",
  // The enabled-but-never-started read. Unreachable in query-core today, but
  // enumerated with a cure that works rather than folded into another arm.
  allModelsNotReadYetTitle: "Models haven't been read yet",
  allModelsNotReadYetSuffix: "Retry to check now.",
  allModelsRetry: "Retry",
  allModelsSeedDescription:
    "Showing shipped catalog models — not yet verified by a probe.",
  // Diagnostics-only provenance (attestation + install identity) — never a gate.
  allModelsProvenance: (line: string) => `Observed by ${line}`,
  allModelsModes: (modes: readonly string[]) => `Modes: ${modes.join(", ")}`,
  // `ago` is the repo's one relative-age string, `formatRelativeTime`
  // ("2m ago", "3h ago", "3d ago", "now") — already carries its own "ago"
  // (or none, for "now"), so this is a plain prefix, not a template that
  // needs its own special-casing.
  allModelsFreshRefreshedAgo: (ago: string) => `refreshed ${ago}`,
  getApiKey: "Get an API key",
  // PRO-206 — external links from the curated provider doc/console overlay.
  providerConsoleLink: "Get an API key",
  providerDocsLink: "Docs",
  // Method card labels.
  methodGateway: "Proliferate gateway",
  methodGatewayDescription: "Use managed model access.",
  methodApiKey: "API key",
  methodApiKeyDescription: "Use a saved provider key.",
  methodSeat: "Claude.ai login",
  methodSeatDescription: "Run on a Claude subscription.",
  methodCli: "CLI login",
  methodCliDescription: "Use the harness's own session.",
  // The `native` method row's own fact (agent_auth §2): the runtime detected a
  // working login on this machine. A fact about the method, not a reason the
  // card cannot be picked.
  methodCliDetected: "Login detected on this machine",
  // Seats v1 (the Claude.ai logins section, single-seat subset).
  seatAddLogin: "Add a Claude.ai login",
  seatAddLoginStarting: "Opening…",
  seatSheetTitle: "Add a Claude.ai login",
  seatSheetDescription:
    "Sign in with your Claude.ai account in the browser. The seat is captured automatically — no token to paste.",
  seatEmailLabel: "Account email",
  seatEmailPlaceholder: "you@example.com",
  seatPlanLabel: "Plan (optional)",
  seatPlanPlaceholder: "e.g. Max 20x",
  seatSheetStart: "Start sign-in",
  seatSheetCancel: "Cancel",
  seatWaitingForSignIn: "Waiting for sign-in…",
  seatCapturing: "Capturing the seat…",
  seatUploading: "Saving the seat…",
  seatAddedToast: (title: string) => `Added ${title}.`,
  seatMintFailed:
    "The sign-in did not produce a seat. Close the terminal and try again.",
  seatUploadFailed: "Could not save the seat — re-run the sign-in.",
  seatEmptyList: "No Claude.ai logins yet.",
  seatRemove: "Remove",
  seatRemoveError: "Could not remove the seat.",
  // Seats rotation (slice 2 — rotation & refusals): the serving-now/next-up
  // tags, the all-cooling line, and the rotate switch. The tags render the
  // runtime's status verbatim (servingSeatId/nextSeatId — the frontend
  // derives nothing); `time` is the localized reset via formatSeatResetTime.
  seatServingNowTag: "Serving now",
  seatNextUpTag: "Next up",
  // True in BOTH no-serve cases: every login cooling under rotation, or the
  // rotate-off pinned login cooling (where other logins may be fresh but the
  // pin means none will serve).
  seatCoolingLine: (time: string) =>
    `No login can serve right now — the next reset is at ${time}.`,
  seatRotateLabel: "Rotate between logins",
  seatRotateDescription: "Off pins the serving login. Usage limits still apply.",
  seatRotateUpdateError: "Could not update login rotation.",
  // §1 — the exit to the vendor tool's own documentation.
  docsLink: "Docs",
  probeModelCount: (count: number) =>
    count === 1 ? "1 model" : `${count} models`,
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
  // The status document's remaining badge words (agent_auth §2). No document at
  // all reads "Waiting for status" — neutral, and it gates nothing.
  authBadgeWaitingStatus: "Waiting for status",
  authBadgeNotVerified: "Not verified",
  // The dims-never-extinguishes marker for a stale document with NOTHING
  // observed: there is no age to state, only that a re-probe is running.
  // Never a spinner.
  authBadgeRechecking: "re-checking",
  // Founder-ruled 2026-08-27 (backoff display): a stale document WITH an
  // observation states the observation's age and that the runtime is retrying.
  // This wording class WINS over the §4-cell-4 countdown — no countdown, no
  // next-attempt field, no timer.
  authStaleLastChecked: (age: string) => `last checked ${age} ago — retrying`,
  authEvidenceVerifiedAgo: (age: string) => `verified ${age} ago`,
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
