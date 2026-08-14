import {
  resolveLaunchIntentScope,
  type ChatLaunchIntent,
} from "#product/lib/domain/chat/launch/launch-intent";
import { launchIntentOwnsShell } from "#product/lib/domain/chat/surface/chat-surface";

/**
 * Client-owned launch intents, keyed by intent id. Mirrors the pending-workspace
 * registry: a second Home submit adds an intent instead of replacing the first,
 * so two launches can be in flight at once and each one's mutators still find
 * their own record (PRO-230).
 */
export interface ChatLaunchIntentRegistry {
  intentsById: Record<string, ChatLaunchIntent>;
  intentOrder: string[];
}

export const EMPTY_CHAT_LAUNCH_INTENT_REGISTRY: ChatLaunchIntentRegistry = {
  intentsById: {},
  intentOrder: [],
};

const EMPTY_CHAT_LAUNCH_INTENTS: readonly ChatLaunchIntent[] = [];

export function upsertLaunchIntent(
  registry: ChatLaunchIntentRegistry,
  intent: ChatLaunchIntent,
): ChatLaunchIntentRegistry {
  const existing = registry.intentsById[intent.id] ?? null;
  if (existing === intent) {
    return registry;
  }
  return {
    intentsById: {
      ...registry.intentsById,
      [intent.id]: intent,
    },
    intentOrder: existing
      ? registry.intentOrder
      : [...registry.intentOrder, intent.id],
  };
}

export function patchLaunchIntent(
  registry: ChatLaunchIntentRegistry,
  intentId: string,
  patch: Partial<ChatLaunchIntent>,
): ChatLaunchIntentRegistry {
  const existing = registry.intentsById[intentId] ?? null;
  if (!existing) {
    return registry;
  }
  return {
    intentsById: {
      ...registry.intentsById,
      [intentId]: { ...existing, ...patch, id: intentId },
    },
    intentOrder: registry.intentOrder,
  };
}

export function removeLaunchIntent(
  registry: ChatLaunchIntentRegistry,
  intentId: string,
): ChatLaunchIntentRegistry {
  if (!registry.intentsById[intentId]) {
    return registry;
  }
  const { [intentId]: _removed, ...intentsById } = registry.intentsById;
  return {
    intentsById,
    intentOrder: registry.intentOrder.filter((id) => id !== intentId),
  };
}

export function launchIntent(
  registry: ChatLaunchIntentRegistry,
  intentId: string | null | undefined,
): ChatLaunchIntent | null {
  if (!intentId) {
    return null;
  }
  return registry.intentsById[intentId] ?? null;
}

export function launchIntents(
  registry: ChatLaunchIntentRegistry,
): readonly ChatLaunchIntent[] {
  if (registry.intentOrder.length === 0) {
    return EMPTY_CHAT_LAUNCH_INTENTS;
  }
  const intents: ChatLaunchIntent[] = [];
  for (const intentId of registry.intentOrder) {
    const intent = registry.intentsById[intentId];
    if (intent) {
      intents.push(intent);
    }
  }
  return intents;
}

/**
 * The intent a pending-workspace attempt belongs to. Dismissing an attempt has
 * to end its launch too, and the attempt id is the only association the two
 * ledgers share.
 */
export function launchIntentForAttempt(
  registry: ChatLaunchIntentRegistry,
  attemptId: string | null | undefined,
): ChatLaunchIntent | null {
  if (!attemptId) {
    return null;
  }
  for (const intentId of registry.intentOrder) {
    const intent = registry.intentsById[intentId];
    if (intent?.attemptId === attemptId) {
      return intent;
    }
  }
  return null;
}

/**
 * Which intent, if any, a given shell shows. Scope ownership decides it: a
 * scoped intent only matches its own pending-workspace key or workspace id, and
 * an unscoped intent (the cowork pre-mint gap, or the momentary window between
 * `begin` and the attempt existing) only matches a shell with nothing selected.
 * Among several unscoped candidates the most recent one wins — it is the launch
 * the user just submitted.
 */
export function resolveLaunchIntentForShell(
  registry: ChatLaunchIntentRegistry,
  shell: { shellLogicalWorkspaceId: string | null; shellWorkspaceId: string | null },
): ChatLaunchIntent | null {
  let scopedMatch: ChatLaunchIntent | null = null;
  let unscopedMatch: ChatLaunchIntent | null = null;
  for (const intentId of registry.intentOrder) {
    const intent = registry.intentsById[intentId];
    if (!intent) {
      continue;
    }
    const scope = resolveLaunchIntentScope(intent);
    if (!launchIntentOwnsShell({
      scope,
      shellLogicalWorkspaceId: shell.shellLogicalWorkspaceId,
      shellWorkspaceId: shell.shellWorkspaceId,
    })) {
      continue;
    }
    if (scope.pendingUiKey === null && scope.workspaceId === null) {
      if (!unscopedMatch || intent.createdAt >= unscopedMatch.createdAt) {
        unscopedMatch = intent;
      }
      continue;
    }
    if (!scopedMatch || intent.createdAt >= scopedMatch.createdAt) {
      scopedMatch = intent;
    }
  }
  return scopedMatch ?? unscopedMatch;
}
