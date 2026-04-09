import type { PermissionOptionAction } from "@/lib/domain/chat/chat-input-helpers";

export interface PermissionPromptPresentation {
  kind: "default" | "mode_switch";
  title: string;
  description: string | null;
  currentModeLabel: string | null;
  targetModeLabel: string | null;
  showToolCallId: boolean;
  replaceComposer: boolean;
}

function humanizeModeId(modeId: string): string {
  return modeId
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseRequestedMode(toolCallId: string | null | undefined): string | null {
  if (!toolCallId) {
    return null;
  }

  const match = /^enter_([a-z0-9_-]+)_mode(?:-|$)/i.exec(toolCallId);
  return match?.[1] ?? null;
}

export function resolvePermissionPromptPresentation(args: {
  title: string;
  toolCallId?: string | null;
  currentModeLabel?: string | null;
}): PermissionPromptPresentation {
  const requestedModeId = parseRequestedMode(args.toolCallId);
  if (!requestedModeId) {
    return {
      kind: "default",
      title: args.title,
      description: args.currentModeLabel
        ? `Waiting for approval. Current mode: ${args.currentModeLabel}.`
        : "Waiting for approval.",
      currentModeLabel: args.currentModeLabel ?? null,
      targetModeLabel: null,
      showToolCallId: true,
      replaceComposer: false,
    };
  }

  const targetModeLabel = humanizeModeId(requestedModeId);
  return {
    kind: "mode_switch",
    title: `Switch to ${targetModeLabel} Mode?`,
    description: `${args.title} AnyHarness will apply the new live session mode when this turn unwinds.`,
    currentModeLabel: args.currentModeLabel ?? null,
    targetModeLabel,
    showToolCallId: false,
    replaceComposer: true,
  };
}

export function resolvePermissionActionLabel(
  action: PermissionOptionAction,
  presentation: PermissionPromptPresentation,
): string {
  if (presentation.kind !== "mode_switch") {
    return action.label;
  }

  if (action.kind === "allow_always") {
    return presentation.targetModeLabel
      ? `Always use ${presentation.targetModeLabel}`
      : "Always switch";
  }
  if (action.kind === "allow_once") {
    return presentation.targetModeLabel
      ? `Switch to ${presentation.targetModeLabel}`
      : "Switch now";
  }
  if (action.kind?.startsWith("reject")) {
    return presentation.currentModeLabel
      ? `Keep ${presentation.currentModeLabel}`
      : "Keep current mode";
  }

  return action.label;
}
