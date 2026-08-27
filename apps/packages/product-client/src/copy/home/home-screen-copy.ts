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
  authSetupDescription: "Connecting your agents to managed model access.",
  authSetupInstalling: "Installing",
  authSetupPreparing: "Preparing",
  authSetupNeedsInstall: "Not installed",
  authSetupWaitingStatus: "Waiting for status",
  authSetupInstallAction: "Install",
  // The dims-never-extinguishes line: a stale document keeps its last
  // observation on the badge and says a re-probe is running.
  authSetupRechecking: "Re-checking…",
  authSetupOpenAgents: "Open agent settings",
} as const;
