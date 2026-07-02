export type ScenarioKey =
  | "clean"
  | "todos-short"
  | "todos-mid"
  | "todos-long"
  | "todo-strip-with-approval"
  | "execute-approval"
  | "edit-approval"
  | "interaction-motion"
  | "interaction-marker-permission"
  | "interaction-marker-question"
  | "claude-plan-short"
  | "claude-plan-long"
  | "plan-streaming-upgrade"
  | "mode-transition"
  | "carry-out-plan"
  | "pending-prompts-single"
  | "pending-prompts-multi"
  | "pending-prompts-editing"
  | "pending-prompts-with-approval"
  | "composer-long-input"
  | "slash-command-search"
  | "slash-command-empty"
  | "workspace-arrival-created"
  | "cloud-first-runtime"
  | "cloud-provisioning"
  | "cloud-applying-files"
  | "cloud-blocked"
  | "cloud-error"
  | "cloud-reconnecting"
  | "cloud-reconnect-error"
  | "user-input-single-option"
  | "user-input-single-freeform"
  | "user-input-option-plus-other"
  | "user-input-secret"
  | "user-input-multi-question"
  | "mcp-elicitation-boolean"
  | "mcp-elicitation-enum"
  | "mcp-elicitation-multi-select"
  | "mcp-elicitation-mixed-required"
  | "mcp-elicitation-url"
  | "mcp-elicitation-validation-error"
  | "mcp-elicitation-cancel-decline"
  | "status-background"
  | "status-live-stream"
  | "status-hook-running"
  | "status-hook-completed"
  | "status-hook-blocked"
  | "status-deprecation"
  | "status-assistant-handoff"
  | "grok-retry-status"
  | "grok-blocked-warning"
  | "grok-no-response-warning"
  | "opencode-mcp-approval-options"
  | "opencode-tool-before-approval"
  | "tool-bash-running"
  | "tool-bash-completed"
  | "tool-bash-failed"
  | "tool-read-preview"
  | "tool-file-change-running"
  | "tool-file-change-failed"
  | "tool-file-change-diff"
  | "tool-reasoning"
  | "tool-cowork-artifact"
  | "tool-generic-result"
  | "tool-subagent-task"
  | "tool-subagent-creation-single"
  | "tool-subagent-creations"
  | "subagent-parent-send-card"
  | "end-turn-multi-file-diff"
  | "git-diff-panel"
  | "subagents-composer-single"
  | "subagents-composer-few"
  | "subagents-composer-many"
  | "subagents-queued-wake"
  | "subagents-queued-wake-with-approval"
  | "subagent-wake-card"
  | "goal-active-short"
  | "goal-active-long"
  | "goal-active-pause-disabled"
  | "goal-paused"
  | "goal-editing"
  | "goal-composing"
  | "goal-met-sticky"
  | "goal-blocked-sticky"
  | "goal-failed-budget"
  | "goal-empty"
  | "loading-states";

interface Scenario {
  label: string;
}

export const SCENARIOS: Record<ScenarioKey, Scenario> = {
  "clean": { label: "Clean" },
  "todos-short": { label: "Todos (3)" },
  "todos-mid": { label: "Todos (5)" },
  "todos-long": { label: "Todos (12)" },
  "todo-strip-with-approval": { label: "Todo strip + approval" },
  "execute-approval": { label: "Execute approval" },
  "edit-approval": { label: "Edit approval" },
  "interaction-motion": { label: "Interaction motion" },
  "interaction-marker-permission": { label: "Marker + permission" },
  "interaction-marker-question": { label: "Marker + question" },
  "claude-plan-short": { label: "Plan approval (short)" },
  "claude-plan-long": { label: "Plan approval (long)" },
  "plan-streaming-upgrade": { label: "Plan streaming upgrade" },
  "mode-transition": { label: "Mode transition" },
  "carry-out-plan": { label: "Carry-out receipt" },
  "pending-prompts-single": { label: "Queue (1 row)" },
  "pending-prompts-multi": { label: "Queue (3 rows)" },
  "pending-prompts-editing": { label: "Queue (editing row)" },
  "pending-prompts-with-approval": { label: "Queue + approval" },
  "composer-long-input": { label: "Composer long input" },
  "slash-command-search": { label: "Slash commands" },
  "slash-command-empty": { label: "Slash commands empty" },
  "workspace-arrival-created": { label: "Workspace arrival" },
  "cloud-first-runtime": { label: "Cloud first runtime" },
  "cloud-provisioning": { label: "Cloud provisioning" },
  "cloud-applying-files": { label: "Cloud applying files" },
  "cloud-blocked": { label: "Cloud blocked" },
  "cloud-error": { label: "Cloud error" },
  "cloud-reconnecting": { label: "Cloud reconnecting" },
  "cloud-reconnect-error": { label: "Cloud reconnect error" },
  "user-input-single-option": { label: "User input (option)" },
  "user-input-single-freeform": { label: "User input (text)" },
  "user-input-option-plus-other": { label: "User input (other)" },
  "user-input-secret": { label: "User input (secret)" },
  "user-input-multi-question": { label: "User input (multi)" },
  "mcp-elicitation-boolean": { label: "MCP form (boolean)" },
  "mcp-elicitation-enum": { label: "MCP form (enum)" },
  "mcp-elicitation-multi-select": { label: "MCP form (multi)" },
  "mcp-elicitation-mixed-required": { label: "MCP form (mixed)" },
  "mcp-elicitation-url": { label: "MCP URL reveal" },
  "mcp-elicitation-validation-error": { label: "MCP validation" },
  "mcp-elicitation-cancel-decline": { label: "MCP cancel/decline" },
  "status-background": { label: "Status background" },
  "status-live-stream": { label: "Live stream" },
  "status-hook-running": { label: "Hook running" },
  "status-hook-completed": { label: "Hook completed" },
  "status-hook-blocked": { label: "Hook blocked" },
  "status-deprecation": { label: "Deprecation notice" },
  "status-assistant-handoff": { label: "Prose handoff" },
  "grok-retry-status": { label: "Grok retry" },
  "grok-blocked-warning": { label: "Grok blocked" },
  "grok-no-response-warning": { label: "Grok no response" },
  "opencode-mcp-approval-options": { label: "OpenCode MCP approval" },
  "opencode-tool-before-approval": { label: "OpenCode pre-approval tool" },
  "tool-bash-running": { label: "Tool bash running" },
  "tool-bash-completed": { label: "Tool bash completed" },
  "tool-bash-failed": { label: "Tool bash failed" },
  "tool-read-preview": { label: "Tool read preview" },
  "tool-file-change-running": { label: "Tool file running" },
  "tool-file-change-failed": { label: "Tool file failed" },
  "tool-file-change-diff": { label: "Tool file diff" },
  "tool-reasoning": { label: "Tool reasoning" },
  "tool-cowork-artifact": { label: "Tool artifact" },
  "tool-generic-result": { label: "Tool generic result" },
  "tool-subagent-task": { label: "Tool subagent task" },
  "tool-subagent-creation-single": { label: "Tool subagent creation" },
  "tool-subagent-creations": { label: "Tool subagent creations" },
  "subagent-parent-send-card": { label: "Parent send receipt" },
  "end-turn-multi-file-diff": { label: "End-turn diff" },
  "git-diff-panel": { label: "Git diff panel" },
  "subagents-composer-single": { label: "Agents single" },
  "subagents-composer-few": { label: "Agents subagents (3)" },
  "subagents-composer-many": { label: "Agents subagents (10)" },
  "subagents-queued-wake": { label: "Subagent queued wake" },
  "subagents-queued-wake-with-approval": { label: "Subagents + wake + approval" },
  "subagent-wake-card": { label: "Subagent wake card" },
  "goal-active-short": { label: "Goal active (codex)" },
  "goal-active-long": { label: "Goal long objective" },
  "goal-active-pause-disabled": { label: "Goal active (claude)" },
  "goal-paused": { label: "Goal paused" },
  "goal-editing": { label: "Goal editing" },
  "goal-composing": { label: "Goal composing" },
  "goal-met-sticky": { label: "Goal met" },
  "goal-blocked-sticky": { label: "Goal blocked" },
  "goal-failed-budget": { label: "Goal failed (budget)" },
  "goal-empty": { label: "Goal empty" },
  "loading-states": { label: "Loading states" },
};

export const DEFAULT_SCENARIO: ScenarioKey = "clean";

export function resolveScenarioKey(raw: string | null): ScenarioKey {
  if (raw && raw in SCENARIOS) {
    return raw as ScenarioKey;
  }
  return DEFAULT_SCENARIO;
}

export type PlaygroundScenarioSelection =
  | {
      kind: "fixture";
      key: ScenarioKey;
      raw: string;
    }
  | {
      kind: "recording";
      recordingId: string;
      raw: string;
    };

export function resolvePlaygroundScenarioSelection(
  raw: string | null,
): PlaygroundScenarioSelection {
  if (raw && raw in SCENARIOS) {
    return {
      kind: "fixture",
      key: raw as ScenarioKey,
      raw,
    };
  }

  if (raw && raw.trim().endsWith(".json")) {
    return {
      kind: "recording",
      recordingId: raw.trim(),
      raw: raw.trim(),
    };
  }

  return {
    kind: "fixture",
    key: DEFAULT_SCENARIO,
    raw: DEFAULT_SCENARIO,
  };
}
