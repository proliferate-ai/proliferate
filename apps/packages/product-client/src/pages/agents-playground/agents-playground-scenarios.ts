export type AgentsPlaygroundScenarioId =
  | "ready-local"
  | "login-required"
  | "install-required"
  | "updating"
  | "runtime-error"
  | "unsupported"
  | "opencode-multi-source"
  | "cloud-signed-out"
  | "cloud-install-required"
  | "cloud-ready"
  | "api-keys-empty"
  | "api-keys-ready"
  | "api-keys-loading"
  | "api-keys-error";

export interface AgentsPlaygroundScenario {
  id: AgentsPlaygroundScenarioId;
  label: string;
  harnessKind: "claude" | "opencode";
  pane: "harness" | "api-keys";
  surface: "cloud" | "local";
}

export const AGENTS_PLAYGROUND_SCENARIOS: readonly AgentsPlaygroundScenario[] = [
  { id: "ready-local", label: "Ready", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "login-required", label: "Login required", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "install-required", label: "Install required", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "updating", label: "Updating", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "runtime-error", label: "Runtime error", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "unsupported", label: "Unsupported", harnessKind: "claude", pane: "harness", surface: "local" },
  { id: "opencode-multi-source", label: "Multiple auth", harnessKind: "opencode", pane: "harness", surface: "local" },
  { id: "cloud-signed-out", label: "Cloud signed out", harnessKind: "claude", pane: "harness", surface: "cloud" },
  { id: "cloud-install-required", label: "Cloud install required", harnessKind: "claude", pane: "harness", surface: "cloud" },
  { id: "cloud-ready", label: "Cloud ready", harnessKind: "claude", pane: "harness", surface: "cloud" },
  { id: "api-keys-empty", label: "Keys empty", harnessKind: "claude", pane: "api-keys", surface: "cloud" },
  { id: "api-keys-ready", label: "Keys ready", harnessKind: "claude", pane: "api-keys", surface: "cloud" },
  { id: "api-keys-loading", label: "Keys loading", harnessKind: "claude", pane: "api-keys", surface: "cloud" },
  { id: "api-keys-error", label: "Keys error", harnessKind: "claude", pane: "api-keys", surface: "cloud" },
];
