export const HOME_SCREEN_LABELS = {
  addGitHubRepositoryTitle: "Add a GitHub repo",
  addGitHubRepositoryDescription: "Connect a repository to start working with agents.",
  configureDefaultHarnessesTitle: "Configure default harnesses",
  configureDefaultHarnessesDescription: "Pick the coding agents and models you want to use.",
  configureRepositoryTitle: "Configure your repo",
  configureRepositoryDescription: "Finish setting up this repo to start working.",
  // Ack-gated onboarding step (agent-auth.md): shown from first-run adoption's
  // gateway writes until the runtime acks the delivered auth state (or the
  // ~20s grace window passes and the step auto-advances).
  authSetupTitle: "Setting up your agents…",
  authSetupDescription: "Connecting your agents to managed model access.",
  modelProbeProbingTitle: "Processing your models…",
  modelProbeDoneDescription: "Check out which models you already have access to.",
  modelProbeNoneTitle: "Connect a provider to get started",
  modelProbeNoneDescription: "Add an agent provider to see your available models.",
} as const;
