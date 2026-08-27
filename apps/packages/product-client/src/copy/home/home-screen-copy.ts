export const HOME_SCREEN_LABELS = {
  addGitHubRepositoryTitle: "Add a GitHub repo",
  addGitHubRepositoryDescription: "Connect a repository to start working with agents.",
  configureDefaultHarnessesTitle: "Configure default harnesses",
  configureDefaultHarnessesDescription: "Pick the coding agents and models you want to use.",
  configureRepositoryTitle: "Configure your repo",
  configureRepositoryDescription: "Finish setting up this repo to start working.",
  // The state-bound onboarding card (agent_auth §4 cell 4): per-agent badges
  // bound to the real install state and the runtime's status document, never a
  // timer. These are the phase words the badge shows before (or instead of) a
  // status document naming the state itself.
  authSetupTitle: "Setting up your agents…",
  authSetupInstalling: "Installing",
  authSetupPreparing: "Preparing",
  authSetupNeedsInstall: "Not installed",
  authSetupWaitingStatus: "Waiting for status",
  authSetupInstallAction: "Install",
  // The next actions the DOCUMENT can honestly name. Anything the document
  // cannot attribute falls through to authSetupOpenAgents — the generic action
  // is the floor, never a stand-in for a cause we actually hold.
  //
  // `applied === null`: the document says no method is applied for this harness.
  authSetupChooseSourceAction: "Choose a source",
  // The `native` row's `offer: "mint_seat"` on a DETECTED login: the login
  // already on this machine can be captured as a portable seat.
  authSetupUseLoginAction: "Use your existing login",
  // The dims-never-extinguishes line and the evidence age are the DOCUMENT's own
  // words (HARNESS_PANE_COPY.authBadgeRechecking / authEvidenceVerifiedAgo), said
  // once and reused here rather than restated in Home's voice.
  authSetupOpenAgents: "Open agent settings",
} as const;
