import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import { AgentChip, AgentChipVerb } from "#product/components/workspace/delegated-work/AgentChip";
import { DelegatedAgentHoverCard } from "#product/components/workspace/shell/tabs/DelegatedAgentHoverCard";
import {
  parseSubagentLaunchResult,
  resolveSubagentLaunchDisplay,
  isSubagentWorkComplete,
} from "#product/domain/chats/subagents/subagent-launch";
import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import type { DelegatedAgentIdentity } from "#product/lib/domain/delegated-work/model";
import { useTranscriptOpenSession } from "./TranscriptContexts";

/**
 * A spawn run — the locked language of the Spawn Receipts canvas page.
 *
 * The run is a horizontal chip run sitting between the prose, with ONE quiet
 * trailing verb for the whole run. There is no pre-state: a chip pops in as its
 * subagent comes up, and the verb only appears once the run is fully up. A
 * settled run keeps its chips forever — only the verb changes.
 */
export function SubagentCreationGroupBlock({
  itemIds,
  transcript,
}: {
  itemIds: readonly string[];
  transcript: TranscriptState;
}) {
  const openSession = useTranscriptOpenSession();
  // This block receives compact product-MCP creation receipts. Native
  // subagent calls render through TranscriptAgentGroupBlock instead.
  const items = itemIds
    .map((itemId) => transcript.itemsById[itemId])
    .filter((item): item is ToolCallItem => item?.kind === "tool_call");
  const chips = items.map(toSpawnChip);
  // A chip that has not come up yet renders nothing at all — the run grows as
  // the subagents appear rather than reserving slots for them.
  const liveChips = chips.filter((chip) => chip.live);

  if (liveChips.length === 0) {
    return null;
  }

  const verb = spawnRunVerb(chips);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-message" data-subagent-spawn-run>
      {liveChips.map((chip) => {
        const childSessionId = chip.childSessionId;
        const open = childSessionId && openSession
          ? () => openSession(childSessionId, "linked-child")
          : undefined;
        return (
          <DelegatedAgentHoverCard
            key={chip.key}
            agent={{
              identity: chip.identity,
              kind: "subagent",
              originLabel: "Subagent",
              statusCategory: chip.failed
                ? "failed"
                : chip.settled
                  ? "finished"
                  : "running",
              statusLabel: chip.failed
                ? "Did not start"
                : chip.settled
                  ? "Done"
                  : "Working",
              parentTitle: null,
              hoverTitle: chip.hoverTitle,
            }}
            // The structured result the parent agent received. ADR §4 keeps it
            // out of the transcript flow — the hover is where a literal body is
            // readable, which is the same rule agent messages follow.
            message={chip.summary}
            cardAriaLabel={`Open ${chip.identity.displayName}`}
            onCardClick={open}
            className="chip-enter min-w-0"
          >
            <AgentChip
              identity={chip.identity}
              dimmed={chip.failed}
              title={chip.hoverTitle}
              onOpen={open}
            />
          </DelegatedAgentHoverCard>
        );
      })}
      {verb && <AgentChipVerb>{verb}</AgentChipVerb>}
    </div>
  );
}

export interface SpawnChip {
  key: string;
  identity: DelegatedAgentIdentity;
  childSessionId: string | null;
  /** The subagent has come up — its creation receipt landed. */
  live: boolean;
  /** The subagent's own work has settled (not just the creation call). */
  settled: boolean;
  failed: boolean;
  hoverTitle: string;
  /**
   * The subagent's own result summary, as the parent agent received it. The
   * one place it is readable now that the expandable "done" row is gone.
   */
  summary: string | null;
}

function toSpawnChip(item: ToolCallItem): SpawnChip {
  const launchDisplay = resolveSubagentLaunchDisplay(item);
  const launchResult = parseSubagentLaunchResult(item);
  const failed = item.status === "failed";
  const identity = buildDelegatedAgentIdentity({
    id: item.toolCallId ?? item.itemId,
    title: launchDisplay.title,
    sessionId: launchResult?.childSessionId ?? null,
    sessionLinkId: launchResult?.sessionLinkId ?? item.toolCallId ?? item.itemId,
  });
  return {
    key: item.itemId,
    identity,
    childSessionId: launchResult?.childSessionId ?? null,
    live: item.status !== "in_progress",
    settled: isSubagentWorkComplete(item),
    failed,
    hoverTitle: failed
      ? `${identity.displayName} — did not start`
      : identity.displayName,
    summary: readCompletionSummary(item),
  };
}

/**
 * The clean summary from the structured result, never the raw
 * `tool_result_text` parts — those can carry internal orchestration metadata.
 */
function readCompletionSummary(item: ToolCallItem): string | null {
  const rawOutput = typeof item.rawOutput === "object" && item.rawOutput !== null
    ? item.rawOutput as Record<string, unknown>
    : null;
  const summary = rawOutput?.summary;
  if (typeof summary !== "string") {
    return null;
  }
  const trimmed = summary.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * One verb for the whole run. It stays silent until every chip is up, so a
 * half-spawned run never claims the run started; after that only the verb
 * moves, never the chips.
 */
export function spawnRunVerb(chips: readonly SpawnChip[]): string | null {
  if (chips.length === 0 || chips.some((chip) => !chip.live)) {
    return null;
  }
  const started = chips.filter((chip) => !chip.failed);
  if (started.length === 0) {
    return "didn't start";
  }
  return started.every((chip) => chip.settled) ? "finished" : "started working";
}
