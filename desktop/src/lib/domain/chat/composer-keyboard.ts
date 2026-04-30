import { isApplePlatform } from "@/lib/domain/shortcuts/matching";

export interface ComposerKeyboardEventLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  nativeEvent: {
    isComposing?: boolean;
  };
}

function isComposing(event: ComposerKeyboardEventLike): boolean {
  return event.nativeEvent.isComposing === true;
}

function isPlainModifierState(event: ComposerKeyboardEventLike): boolean {
  return !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
}

export function isRawComposerSubmitKey(event: ComposerKeyboardEventLike): boolean {
  return event.key === "Enter"
    && isPlainModifierState(event)
    && !isComposing(event);
}

export function isModifiedComposerSubmitKey(event: ComposerKeyboardEventLike): boolean {
  const isPrimaryModifier = isApplePlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;

  return event.key === "Enter"
    && isPrimaryModifier
    && !event.shiftKey
    && !event.altKey
    && !isComposing(event);
}

export function isComposerSubmitKey(event: ComposerKeyboardEventLike): boolean {
  return isRawComposerSubmitKey(event) || isModifiedComposerSubmitKey(event);
}

export function isComposerMentionSelectKey(event: ComposerKeyboardEventLike): boolean {
  if (isComposing(event) || !isPlainModifierState(event)) {
    return false;
  }

  return event.key === "Enter" || (event.key === "Tab" && !event.shiftKey);
}
