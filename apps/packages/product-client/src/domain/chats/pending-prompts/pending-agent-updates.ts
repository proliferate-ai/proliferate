import { buildDelegatedAgentIdentity } from "#product/lib/domain/delegated-work/identity";
import type { DelegatedAgentIdentity } from "#product/lib/domain/delegated-work/model";
import type { PendingPromptQueueRow } from "#product/domain/chats/pending-prompts/pending-prompt-queue";

/**
 * The queued-updates model behind the composer's one quiet agent row.
 *
 * ADR §4 locks what this may say: you see THAT updates are pending, never WHAT
 * they say. So this collapses every agent-queued entry into one glyph per
 * source agent plus a count — no bodies, no previews, no per-entry rows, and
 * no edit or delete. The human's own queued messages are not agent-sourced and
 * never reach here; they keep their full row.
 */

export interface PendingAgentUpdateGroup {
  key: string;
  identity: DelegatedAgentIdentity;
  /** Where clicking the glyph goes. Null when nothing resolved a session. */
  sessionId: string | null;
  count: number;
  /** "Audit retry schema · 2 queued updates — click to open" */
  hoverLabel: string;
}

export interface PendingAgentUpdates {
  groups: PendingAgentUpdateGroup[];
  totalCount: number;
  /** "5 updates" */
  countLabel: string;
}

export function groupPendingAgentUpdates(input: {
  rows: readonly PendingPromptQueueRow[];
  /** Delegation links the composer already holds, for link-scoped pointers. */
  sessionIdByLinkId?: Readonly<Record<string, string>>;
}): PendingAgentUpdates | null {
  const byKey = new Map<string, { sessionId: string | null; label: string | null; count: number }>();
  for (const row of input.rows) {
    const source = row.agentSource;
    if (!source) {
      continue;
    }
    const sessionId = source.sessionId
      ?? (source.sessionLinkId ? input.sessionIdByLinkId?.[source.sessionLinkId] ?? null : null);
    // Group on the most stable handle available: a link outlives a pointer, and
    // a session id is the only handle a peer ever has.
    const key = source.sessionLinkId ?? sessionId ?? source.label ?? "agent";
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.sessionId = existing.sessionId ?? sessionId;
      existing.label = existing.label ?? source.label;
      continue;
    }
    byKey.set(key, { sessionId, label: source.label, count: 1 });
  }

  if (byKey.size === 0) {
    return null;
  }

  const groups = [...byKey.entries()].map(([key, value]) => {
    const identity = buildDelegatedAgentIdentity({
      id: key,
      title: value.label,
      sessionId: value.sessionId,
      sessionLinkId: key === value.sessionId ? null : key,
    });
    return {
      key,
      identity,
      sessionId: value.sessionId,
      count: value.count,
      hoverLabel: `${identity.title} · ${formatQueuedLabel(value.count)}${
        value.sessionId ? " — click to open" : ""
      }`,
    } satisfies PendingAgentUpdateGroup;
  });
  const totalCount = groups.reduce((total, group) => total + group.count, 0);

  return {
    groups,
    totalCount,
    countLabel: `${totalCount} ${totalCount === 1 ? "update" : "updates"}`,
  };
}

function formatQueuedLabel(count: number): string {
  return `${count} queued update${count === 1 ? "" : "s"}`;
}
