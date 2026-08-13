export interface TranscriptKeyboardEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface TranscriptTargetFacts {
  insideRoot: boolean;
  contextualActions: boolean;
  selectableInteractiveText: boolean;
  textEntry: boolean;
  terminalZone: boolean;
  browserZone: boolean;
  ignoredChrome: boolean;
  nativeInteractive: boolean;
  ariaInteractive: boolean;
}

export type TranscriptPointerOwnershipAction =
  | "set-owned"
  | "track-selection"
  | "clear-owned"
  | "ignore";
export type TranscriptPrimaryAAction = "select-root" | "clear-owned" | "ignore";
export type TranscriptSelectionClampEdge = "start" | "end";

export interface TranscriptSelectionChangeAction {
  clampEdge: TranscriptSelectionClampEdge | null;
  clearFullSelection: boolean;
}

export type TranscriptCopyAction = "copy-semantic" | "clear-owned" | "ignore";

export const EMPTY_TRANSCRIPT_TARGET_FACTS: TranscriptTargetFacts = {
  insideRoot: false,
  contextualActions: false,
  selectableInteractiveText: false,
  textEntry: false,
  terminalZone: false,
  browserZone: false,
  ignoredChrome: false,
  nativeInteractive: false,
  ariaInteractive: false,
};

export function isPrimarySelectAllEvent(
  event: TranscriptKeyboardEventLike,
  isApple: boolean,
): boolean {
  const primary = isApple
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return event.key.toLowerCase() === "a"
    && primary
    && !event.shiftKey
    && !event.altKey;
}

export function isBlockedTranscriptTarget(target: TranscriptTargetFacts): boolean {
  return target.textEntry
    || target.terminalZone
    || target.browserZone
    || target.ignoredChrome
    || target.nativeInteractive
    || target.ariaInteractive;
}

export function isValidTranscriptKeyboardTarget(
  eventTarget: TranscriptTargetFacts,
  activeTarget: TranscriptTargetFacts,
): boolean {
  return (eventTarget.insideRoot || activeTarget.insideRoot)
    && !isBlockedTranscriptTarget(eventTarget)
    && !isBlockedTranscriptTarget(activeTarget);
}

export function resolvePointerOwnership(
  target: TranscriptTargetFacts,
): TranscriptPointerOwnershipAction {
  if (target.contextualActions) {
    return "ignore";
  }
  if (
    target.insideRoot
    && target.selectableInteractiveText
    && !target.textEntry
    && !target.terminalZone
    && !target.ignoredChrome
  ) {
    return "track-selection";
  }
  return target.insideRoot && !isBlockedTranscriptTarget(target)
    ? "set-owned"
    : "clear-owned";
}

export function resolvePrimaryAAction({
  owned,
  commandOwnerActive = false,
  isSelectAll,
  defaultPrevented,
  eventTarget,
  activeTarget,
}: {
  owned: boolean;
  commandOwnerActive?: boolean;
  isSelectAll: boolean;
  defaultPrevented: boolean;
  eventTarget: TranscriptTargetFacts;
  activeTarget: TranscriptTargetFacts;
}): TranscriptPrimaryAAction {
  if (!isSelectAll || defaultPrevented) {
    return "ignore";
  }
  if (!owned && !commandOwnerActive) {
    return "ignore";
  }
  const validOwner = commandOwnerActive
    || eventTarget.insideRoot
    || activeTarget.insideRoot;
  return validOwner
    && !isBlockedTranscriptTarget(eventTarget)
    && !isBlockedTranscriptTarget(activeTarget)
    ? "select-root"
    : "clear-owned";
}

export function resolveSelectionChangeAction({
  owned,
  anchorInsideRoot,
  focusInsideRoot,
  exactRootSelection,
  direction,
}: {
  owned: boolean;
  anchorInsideRoot: boolean;
  focusInsideRoot: boolean;
  exactRootSelection: boolean;
  direction: "forward" | "backward";
}): TranscriptSelectionChangeAction {
  if (!owned) {
    return {
      clampEdge: null,
      clearFullSelection: !exactRootSelection,
    };
  }

  if (exactRootSelection) {
    return {
      clampEdge: null,
      clearFullSelection: false,
    };
  }

  if (anchorInsideRoot !== focusInsideRoot) {
    return {
      clampEdge: anchorInsideRoot
        ? direction === "forward" ? "end" : "start"
        : direction === "forward" ? "start" : "end",
      clearFullSelection: true,
    };
  }

  return {
    clampEdge: null,
    clearFullSelection: true,
  };
}

export function resolveCopyAction({
  fullRootSelected,
  eventTarget,
  activeTarget,
}: {
  fullRootSelected: boolean;
  eventTarget: TranscriptTargetFacts;
  activeTarget: TranscriptTargetFacts;
}): TranscriptCopyAction {
  if (!fullRootSelected) {
    return "ignore";
  }
  if (!isValidTranscriptKeyboardTarget(eventTarget, activeTarget)) {
    return "clear-owned";
  }
  return "copy-semantic";
}
