import { SUBAGENT_COLOR_PALETTE } from "@/lib/domain/chat/subagent-braille-color";
import { uniqueIds } from "@/lib/domain/workspaces/tabs/visibility";

export const MANUAL_CHAT_GROUP_ID_PREFIX = "manual:";

export const MANUAL_CHAT_GROUP_COLOR_IDS = [
  "blue",
  "magenta",
  "highlight",
  "cyan",
  "link",
  "yellow",
] as const;

export type ManualChatGroupColorId = (typeof MANUAL_CHAT_GROUP_COLOR_IDS)[number];
export type ManualChatGroupId = `${typeof MANUAL_CHAT_GROUP_ID_PREFIX}${string}`;

export interface ManualChatGroup {
  id: ManualChatGroupId;
  label: string;
  colorId: ManualChatGroupColorId;
  sessionIds: string[];
}

export interface DisplayManualChatGroup extends ManualChatGroup {
  sessionIds: string[];
}

export function createManualChatGroupId(id: string): ManualChatGroupId {
  return `${MANUAL_CHAT_GROUP_ID_PREFIX}${id}` as ManualChatGroupId;
}

export function isManualChatGroupId(id: string): id is ManualChatGroupId {
  return id.startsWith(MANUAL_CHAT_GROUP_ID_PREFIX) && id.length > MANUAL_CHAT_GROUP_ID_PREFIX.length;
}

export function isManualChatGroupColorId(value: unknown): value is ManualChatGroupColorId {
  return typeof value === "string"
    && (MANUAL_CHAT_GROUP_COLOR_IDS as readonly string[]).includes(value);
}

export function resolveManualChatGroupColor(colorId: ManualChatGroupColorId): string {
  const index = MANUAL_CHAT_GROUP_COLOR_IDS.indexOf(colorId);
  return SUBAGENT_COLOR_PALETTE[index] ?? SUBAGENT_COLOR_PALETTE[0];
}

export function getRandomManualChatGroupColorId(): ManualChatGroupColorId {
  const index = Math.floor(Math.random() * MANUAL_CHAT_GROUP_COLOR_IDS.length);
  return MANUAL_CHAT_GROUP_COLOR_IDS[index] ?? MANUAL_CHAT_GROUP_COLOR_IDS[0];
}

export function sanitizeManualChatGroups(value: unknown): ManualChatGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenGroupIds = new Set<string>();
  const groups: ManualChatGroup[] = [];
  for (const entry of value) {
    const group = sanitizeManualChatGroup(entry);
    if (!group || seenGroupIds.has(group.id)) {
      continue;
    }
    seenGroupIds.add(group.id);
    groups.push(group);
  }
  return groups;
}

export function sanitizeManualChatGroupsByWorkspace(
  value: unknown,
): Record<string, ManualChatGroup[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const next: Record<string, ManualChatGroup[]> = {};
  for (const [workspaceId, groups] of Object.entries(value)) {
    if (!workspaceId) {
      continue;
    }
    const sanitized = sanitizeManualChatGroups(groups);
    if (sanitized.length > 0) {
      next[workspaceId] = sanitized;
    }
  }
  return next;
}

export function deriveManualChatGroupsForDisplay(args: {
  groups: readonly ManualChatGroup[];
  visibleSessionIds: readonly string[];
  childToParent: ReadonlyMap<string, string>;
  resolvedHierarchySessionIds: ReadonlySet<string>;
}): DisplayManualChatGroup[] {
  const visibleSet = new Set(args.visibleSessionIds);
  const visibleIndex = new Map(args.visibleSessionIds.map((id, index) => [id, index]));

  return args.groups
    .map((group) => {
      const sessionIds = group.sessionIds
        .filter((sessionId) =>
          visibleSet.has(sessionId)
          && args.resolvedHierarchySessionIds.has(sessionId)
          && !args.childToParent.has(sessionId)
        )
        .sort((left, right) =>
          (visibleIndex.get(left) ?? Number.MAX_SAFE_INTEGER)
          - (visibleIndex.get(right) ?? Number.MAX_SAFE_INTEGER)
        );
      return {
        ...group,
        sessionIds,
      };
    })
    .filter((group) => group.sessionIds.length >= 2);
}

export function normalizeManualChatGroupsForMutation(args: {
  groups: readonly ManualChatGroup[];
  liveSessionIds: readonly string[];
  childToParent: ReadonlyMap<string, string>;
  resolvedHierarchySessionIds: ReadonlySet<string>;
}): ManualChatGroup[] {
  const liveSet = new Set(args.liveSessionIds);
  const assignedSessionIds = new Set<string>();
  const next: ManualChatGroup[] = [];

  for (const group of args.groups) {
    const sessionIds = group.sessionIds.filter((sessionId) => {
      if (
        assignedSessionIds.has(sessionId)
        || !liveSet.has(sessionId)
        || !args.resolvedHierarchySessionIds.has(sessionId)
        || args.childToParent.has(sessionId)
      ) {
        return false;
      }
      assignedSessionIds.add(sessionId);
      return true;
    });

    if (sessionIds.length >= 2) {
      next.push({ ...group, sessionIds });
    }
  }

  return next;
}

export function upsertManualChatGroup(
  groups: readonly ManualChatGroup[],
  group: ManualChatGroup,
): ManualChatGroup[] {
  const nextGroup = sanitizeManualChatGroup(group);
  if (!nextGroup) {
    return groups.filter((candidate) => candidate.id !== group.id);
  }

  const movingSessionIds = new Set(nextGroup.sessionIds);
  const next = groups
    .filter((candidate) => candidate.id !== nextGroup.id)
    .map((candidate) => ({
      ...candidate,
      sessionIds: candidate.sessionIds.filter((sessionId) => !movingSessionIds.has(sessionId)),
    }))
    .filter((candidate) => candidate.sessionIds.length >= 2);

  return [...next, nextGroup];
}

export function updateManualChatGroup(
  groups: readonly ManualChatGroup[],
  groupId: string,
  updates: Partial<Pick<ManualChatGroup, "label" | "colorId">>,
): ManualChatGroup[] {
  return groups.map((group) => {
    if (group.id !== groupId) {
      return group;
    }
    return sanitizeManualChatGroup({
      ...group,
      ...updates,
    }) ?? group;
  });
}

export function deleteManualChatGroup(
  groups: readonly ManualChatGroup[],
  groupId: string,
): ManualChatGroup[] {
  return groups.filter((group) => group.id !== groupId);
}

export function removeSessionsFromManualChatGroups(
  groups: readonly ManualChatGroup[],
  sessionIds: readonly string[],
): ManualChatGroup[] {
  const removeSet = new Set(sessionIds);
  return groups
    .map((group) => ({
      ...group,
      sessionIds: group.sessionIds.filter((sessionId) => !removeSet.has(sessionId)),
    }))
    .filter((group) => group.sessionIds.length >= 2);
}

function sanitizeManualChatGroup(value: unknown): ManualChatGroup | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && isManualChatGroupId(record.id)
    ? record.id
    : null;
  if (!id) {
    return null;
  }

  const sessionIds = Array.isArray(record.sessionIds)
    ? uniqueIds(record.sessionIds.filter((sessionId): sessionId is string =>
      typeof sessionId === "string" && sessionId.trim().length > 0
    ))
    : [];
  if (sessionIds.length < 2) {
    return null;
  }

  const label = typeof record.label === "string" && record.label.trim().length > 0
    ? record.label.trim()
    : "Group";
  const colorId = isManualChatGroupColorId(record.colorId)
    ? record.colorId
    : MANUAL_CHAT_GROUP_COLOR_IDS[0];

  return {
    id,
    label,
    colorId,
    sessionIds,
  };
}
