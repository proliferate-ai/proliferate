import {
  deriveCanonicalPlan,
  type CanonicalPlan,
  AssistantProseItem,
  PlanItem,
  SessionLiveConfigSnapshot,
  ToolCallItem,
  TranscriptItem,
  TranscriptState,
} from "@anyharness/sdk";
import { expect } from "vitest";

import type { RuntimeHarness } from "../../harness/runtime-harness.js";

export const REQUIRED_AGENTS = ["claude", "codex", "gemini"] as const;
const DEFAULT_READY_AGENTS = ["claude", "codex", "gemini"] as const;

export const READY_AGENTS = getReadyAgents();
export const PLANNING_MODE_AGENTS = READY_AGENTS.filter(
  (agentKind): agentKind is "claude" | "gemini" => agentKind === "claude" || agentKind === "gemini",
);
export const AGENT_SETUP_TIMEOUT_MS = 600_000;
const DEFAULT_PLANNING_PROMPT_TIMEOUT_MS = process.env.CI ? 150_000 : 90_000;
const DEFAULT_PLANNING_TEST_TIMEOUT_MS = process.env.CI ? 240_000 : 180_000;
const DEFAULT_SESSION_PROMPT_TIMEOUT_MS = 120_000;
const DEFAULT_SESSION_TEST_TIMEOUT_MS = 180_000;
const CODEX_PLANNING_PROMPT_TIMEOUT_MS = process.env.CI ? 240_000 : 180_000;
const CODEX_PLANNING_TEST_TIMEOUT_MS = process.env.CI ? 360_000 : 300_000;
const CODEX_SESSION_PROMPT_TIMEOUT_MS = process.env.CI ? 240_000 : 180_000;
const CODEX_SESSION_TEST_TIMEOUT_MS = process.env.CI ? 300_000 : 240_000;
export const PLANNING_CASES = [
  {
    agentKind: "claude",
    usesPlanningMode: true,
    expectedPlanSource: "mode_switch",
    prompt:
      "Plan the implementation of a generic /health endpoint for a FastAPI app in exactly three concrete steps. Do not inspect the repository, read files, or use any tools other than your formal planning approval flow. Do not implement anything. When you are done planning, present the plan through your formal planning approval flow.",
  },
  {
    agentKind: "codex",
    usesPlanningMode: false,
    expectedPlanSource: "structured_plan",
    prompt:
      "Before doing anything else, create a concise 3-step implementation plan for adding a /health endpoint to a FastAPI app using your update_plan capability. Do not implement anything or use other tools.",
  },
  {
    agentKind: "gemini",
    usesPlanningMode: true,
    expectedPlanSource: "behavior_only",
    prompt:
      "Create a concise 3-step implementation plan for adding a /health endpoint to a FastAPI app. Stay in planning mode and use the runtime's structured planning mechanism if available.",
  },
] as const satisfies ReadonlyArray<{
  agentKind: string;
  usesPlanningMode: boolean;
  expectedPlanSource: "mode_switch" | "structured_plan" | "behavior_only";
  prompt: string;
}>;

export async function switchToPlanMode(
  harness: RuntimeHarness,
  sessionId: string,
  agentKind: string,
): Promise<void> {
  const liveConfig = await harness.client.sessions.getLiveConfig(sessionId);
  const modeControl = liveConfig.liveConfig?.normalizedControls.mode;
  const planValue = modeControl?.values.find((value) => value.value === "plan");

  expect(modeControl, `missing mode control for ${agentKind}`).toBeTruthy();
  expect(planValue, `missing plan mode for ${agentKind}`).toBeTruthy();

  await harness.client.sessions.setConfigOption(sessionId, {
    configId: modeControl!.rawConfigId,
    value: planValue!.value,
  });
}

export function getPlanningPromptTimeoutMs(agentKind: string): number {
  return agentKind === "codex"
    ? CODEX_PLANNING_PROMPT_TIMEOUT_MS
    : DEFAULT_PLANNING_PROMPT_TIMEOUT_MS;
}

export function getPlanningTestTimeoutMs(agentKind: string): number {
  return agentKind === "codex"
    ? CODEX_PLANNING_TEST_TIMEOUT_MS
    : DEFAULT_PLANNING_TEST_TIMEOUT_MS;
}

export function getSessionPromptTimeoutMs(agentKind: string): number {
  return agentKind === "codex"
    ? CODEX_SESSION_PROMPT_TIMEOUT_MS
    : DEFAULT_SESSION_PROMPT_TIMEOUT_MS;
}

export function getSessionTestTimeoutMs(agentKind: string): number {
  return agentKind === "codex"
    ? CODEX_SESSION_TEST_TIMEOUT_MS
    : DEFAULT_SESSION_TEST_TIMEOUT_MS;
}

export function hasReadyResponse(transcript: TranscriptState): boolean {
  return getAssistantTexts(transcript).some((text) =>
    /^["'`(\[]*READY[.!?)\]'`]*$/i.test(text),
  );
}

export function getToolCalls(transcript: TranscriptState): ToolCallItem[] {
  return getSortedItems(transcript).filter((item): item is ToolCallItem => item.kind === "tool_call");
}

export function hasGeminiPlanningBehavior(transcript: TranscriptState): boolean {
  return hasPlanFileWrite(transcript) || hasPlanLikeAssistantResponse(transcript);
}

export function findClaudeModeSwitchTool(transcript: TranscriptState): ToolCallItem | null {
  return getToolCalls(transcript).find((item) =>
    item.sourceAgentKind === "claude"
    && item.semanticKind === "mode_switch"
    && (item.title ?? "").trim().replace(/\s+/g, " ").toLowerCase() === "ready to code?"
  ) ?? null;
}

export function findClaudeExitPlanModeTool(transcript: TranscriptState): ToolCallItem | null {
  const item = findClaudeModeSwitchTool(transcript);
  if (!item) {
    return null;
  }

  return item.nativeToolName === "ExitPlanMode"
    && item.contentParts.some((part) => part.type === "tool_result_text" && part.text.trim().length > 0)
    ? item
    : null;
}

export function isPlanEnvelope(
  envelope: { event: { type: string; item?: { kind?: string } } },
): boolean {
  return (
    (envelope.event.type === "item_started" || envelope.event.type === "item_completed")
    && envelope.event.item?.kind === "plan"
  );
}

export function describeTranscript(transcript: TranscriptState): string {
  const canonicalPlan = deriveCanonicalPlan(transcript);
  const summary = getSortedItems(transcript).map((item) => {
    if (item.kind === "assistant_prose") {
      return `assistant:${JSON.stringify(item.text.trim())}`;
    }
    if (item.kind === "plan") {
      return `plan:${item.entries.map((entry) => `${entry.status}:${entry.content}`).join(" | ")}`;
    }
    if (item.kind === "tool_call") {
      return `tool:${item.title ?? item.toolKind}:${item.semanticKind}:${item.approvalState}`;
    }
    return item.kind;
  });
  if (transcript.pendingApproval) {
    summary.push(`pendingApproval:${transcript.pendingApproval.title}`);
  }
  if (canonicalPlan) {
    summary.push(`canonicalPlan:${describeCanonicalPlan(canonicalPlan)}`);
  }
  return summary.join("\n");
}

export function pickInvalidConfigId(
  liveConfig: SessionLiveConfigSnapshot | null | undefined,
  agentKind: string,
): string {
  expect(liveConfig, `missing live config for ${agentKind}`).toBeTruthy();
  const rawConfigId = liveConfig!.rawConfigOptions[0]?.id;
  if (rawConfigId) {
    return rawConfigId;
  }

  const normalizedControls = liveConfig!.normalizedControls;
  const candidateControls = [
    normalizedControls.mode,
    normalizedControls.collaborationMode,
    normalizedControls.model,
    normalizedControls.reasoning,
    normalizedControls.effort,
    normalizedControls.fastMode,
    ...(normalizedControls.extras ?? []),
  ].filter((control): control is NonNullable<typeof control> => Boolean(control?.settable));

  const fallbackConfigId = candidateControls[0]?.rawConfigId;
  expect(fallbackConfigId, `missing settable config controls for ${agentKind}`).toBeTruthy();
  return fallbackConfigId!;
}

function getReadyAgents(): string[] {
  const explicit = process.env.ANYHARNESS_TEST_READY_AGENT_KINDS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  return [...DEFAULT_READY_AGENTS];
}

function getAssistantTexts(transcript: TranscriptState): string[] {
  return getSortedItems(transcript)
    .filter((item): item is AssistantProseItem => item.kind === "assistant_prose")
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0);
}

export function hasPlanFileWrite(transcript: TranscriptState): boolean {
  return getToolCalls(transcript).some((item) =>
    item.contentParts.some((part) => {
      if (part.type !== "file_change") {
        return false;
      }

      const targets = [
        part.path,
        part.workspacePath ?? "",
        part.newPath ?? "",
        part.newWorkspacePath ?? "",
        item.title ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return targets.includes("plan") && targets.includes(".md");
    })
  );
}

function hasPlanLikeAssistantResponse(transcript: TranscriptState): boolean {
  return getAssistantTexts(transcript).some((text) => {
    const normalized = text.toLowerCase();
    return (
      normalized.includes("plan")
      && /(###\s*1\.|(?:^|\n)1\.)/.test(text)
      && /(###\s*2\.|(?:^|\n)2\.)/.test(text)
      && /(###\s*3\.|(?:^|\n)3\.)/.test(text)
    );
  });
}

function getSortedItems(transcript: TranscriptState): TranscriptItem[] {
  return Object.values(transcript.itemsById).sort((left, right) => left.startedSeq - right.startedSeq);
}

function describeCanonicalPlan(plan: CanonicalPlan): string {
  if (plan.entries.length > 0) {
    return `${plan.sourceKind}:${plan.entries.map((entry) => entry.content).join(" | ")}`;
  }

  return `${plan.sourceKind}:${JSON.stringify(plan.body ?? "")}`;
}
