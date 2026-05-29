import type { PlanEntry } from "@anyharness/sdk";

export const TODOS_SHORT: PlanEntry[] = [
  { content: "Read authoritative repo docs and MCP spec material", status: "completed" },
  { content: "Inspect current code paths for MCP tool injection", status: "in_progress" },
  { content: "Synthesize gap analysis and outline implementation work", status: "pending" },
];

export const TODOS_MID: PlanEntry[] = [
  { content: "Read foundation files: query keys, billing, credentials", status: "completed" },
  { content: "Read repo and branch file: use-cloud-repo-branches.ts", status: "completed" },
  { content: "Read workspace action flows", status: "in_progress" },
  { content: "Read workspace connection hooks", status: "pending" },
  { content: "Surface findings in a summary writeup", status: "pending" },
];

export const TODOS_LONG: PlanEntry[] = [
  { content: "Audit the existing plan panel implementation for dead branches", status: "completed" },
  { content: "Read the Codex HTML reference for todo tracker + plan approval", status: "completed" },
  { content: "Confirm toolKind is preserved on pending approval interactions", status: "completed" },
  { content: "Delete PlanBlock, InlinePermissionPrompt embeddedInComposer, merge booleans", status: "completed" },
  { content: "Create TodoTrackerPanel with fade mask and line-through", status: "in_progress" },
  { content: "Create ApprovalCard covering execute, edit, switch_mode variants", status: "pending" },
  { content: "Move presented plan bodies into first-class ProposedPlanCard items", status: "pending" },
  { content: "Intercept Claude ExitPlanMode in MessageList dispatch", status: "pending" },
  { content: "Update ChatView single-slot precedence (approval > todos > workspace > cloud)", status: "pending" },
  { content: "Add fade-mask CSS utility to index.css", status: "pending" },
  { content: "Rebase onto main and verify typecheck + tests pass", status: "pending" },
  { content: "Write a playground page so UI iteration doesn't require an LLM", status: "pending" },
];
