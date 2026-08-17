import { isSubagentLaunchStatusVisibleInTranscript } from "#product/domain/chats/subagents/subagent-launch";
import type { SubagentExecutionState } from "#product/domain/chats/subagents/subagent-launch";

interface SubagentLaunchLedgerProps {
  executionState: SubagentExecutionState;
}

const CHAT_ACTION_TEXT_CLASS =
  "text-chat";

/**
 * The native subagent's muted status line in the transcript (Design Handoff
 * — MODIFIED `SubagentLaunchLedger`; Delivery Spec — Background Work Slice
 * 1, rung R4). The prompt disclosure this row used to gate on moved out of
 * the transcript entirely into `BackgroundSubagentView`'s "Initial prompt"
 * panel, so this component no longer takes a `prompt` prop.
 *
 * `Creating` / `Running in background` / `Completed in background` no
 * longer render here — the creation chip and the command row's own trailing
 * slot (`running · 4m 12s` / `exited 0 · 2m 45s`) already carry that state
 * (acceptance line: "the two muted transcript status lines no longer
 * render"). `formatLaunchStatus` itself is unchanged; only these call sites
 * are gone, via `isSubagentLaunchStatusVisibleInTranscript`.
 */
export function SubagentLaunchLedger({
  executionState,
}: SubagentLaunchLedgerProps) {
  if (!isSubagentLaunchStatusVisibleInTranscript(executionState)) {
    return null;
  }

  const status = formatLaunchStatus(executionState);
  return (
    <PlainSubagentActionRow
      label={status.label}
      tone={status.tone}
    />
  );
}

function PlainSubagentActionRow({
  label,
  tone = "normal",
}: {
  label: string;
  tone?: "normal" | "failed";
}) {
  return (
    <div
      title={label}
      className={`truncate ${CHAT_ACTION_TEXT_CLASS} ${
        tone === "failed" ? "text-destructive/80" : "text-muted-foreground/60"
      }`}
    >
      {label}
    </div>
  );
}

function formatLaunchStatus(
  executionState: SubagentExecutionState,
): { label: string; tone: "normal" | "failed" } {
  if (executionState === "failed") {
    return { label: "Launch failed", tone: "failed" };
  }

  if (executionState === "expired_background") {
    return { label: "Stopped updating", tone: "failed" };
  }

  if (executionState === "running") {
    return { label: "Creating", tone: "normal" };
  }

  if (executionState === "background") {
    return { label: "Running in background", tone: "normal" };
  }

  if (executionState === "completed_background") {
    return { label: "Completed in background", tone: "normal" };
  }

  return { label: "Started", tone: "normal" };
}
