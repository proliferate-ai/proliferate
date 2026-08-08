import type { ToolCallItem, TranscriptState } from "@anyharness/sdk";
import { AgentChip, AgentChipVerb } from "#product/components/workspace/delegated-work/AgentChip";
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
    <div className="min-w-0 text-message leading-8" data-subagent-spawn-run>
      {liveChips.map((chip) => {
        const childSessionId = chip.childSessionId;
        return (
          <span key={chip.key} className="chip-enter me-1.5 inline-block align-middle">
            <AgentChip
              identity={chip.identity}
              dimmed={chip.failed}
              title={chip.hoverTitle}
              onOpen={childSessionId && openSession
                ? () => openSession(childSessionId, "linked-child")
                : undefined}
            />
          </span>
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
  };
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
