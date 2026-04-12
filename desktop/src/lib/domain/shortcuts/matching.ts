import type { ShortcutMatch } from "@/config/shortcuts";

export type ShortcutDigit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ShortcutMatchResult {
  digit?: ShortcutDigit;
}

type KeyboardShortcutEventLike = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function isApplePlatform(): boolean {
  const platform = globalThis.navigator?.platform ?? "";
  const userAgent = globalThis.navigator?.userAgent ?? "";
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(userAgent);
}

function matchesModifiers(
  event: KeyboardShortcutEventLike,
  match: ShortcutMatch,
): boolean {
  const requiresCtrl = match.ctrl ?? false;
  const isApple = isApplePlatform();
  const hasPrimaryModifier = isApple ? event.metaKey : event.ctrlKey;

  if (
    hasPrimaryModifier !== match.meta
    || event.shiftKey !== match.shift
    || event.altKey !== match.alt
  ) {
    return false;
  }

  if (!isApple) {
    return !requiresCtrl;
  }

  return event.ctrlKey === requiresCtrl;
}

function getShortcutDigitByKey(key: string): ShortcutDigit | null {
  if (!/^[1-9]$/.test(key)) {
    return null;
  }

  return Number.parseInt(key, 10) as ShortcutDigit;
}

function getShortcutDigitByCode(code: string): ShortcutDigit | null {
  const match = /^Digit([1-9])$/.exec(code);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10) as ShortcutDigit;
}

export function matchShortcut(
  match: ShortcutMatch,
  event: KeyboardShortcutEventLike,
): ShortcutMatchResult | null {
  if (!matchesModifiers(event, match)) {
    return null;
  }

  switch (match.kind) {
    case "fixed":
      return normalizeKey(event.key) === normalizeKey(match.key) ? {} : null;
    case "digit-key": {
      const digit = getShortcutDigitByKey(event.key);
      return digit ? { digit } : null;
    }
    case "digit-code": {
      const digit = getShortcutDigitByCode(event.code);
      return digit ? { digit } : null;
    }
  }
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }

  return element.tagName === "INPUT"
    || element.tagName === "TEXTAREA"
    || element.isContentEditable;
}
