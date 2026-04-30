import type { ShortcutDef, ShortcutMatch } from "@/config/shortcuts";

const NATIVE_KEY_NAMES: Record<string, string> = {
  ",": "Comma",
  ".": "Period",
  " ": "Space",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Escape: "Esc",
};

export function getShortcutNativeAccelerator(
  shortcut: Pick<ShortcutDef, "match" | "nonMacMatch">,
): string | null {
  if (
    shortcut.nonMacMatch
    && !areShortcutMatchesEquivalent(shortcut.match, shortcut.nonMacMatch)
  ) {
    return null;
  }

  return shortcutMatchToNativeAccelerator(shortcut.match);
}

function shortcutMatchToNativeAccelerator(match: ShortcutMatch): string | null {
  if (match.kind !== "fixed") {
    return null;
  }

  const key = toNativeKeyName(match.key);
  if (!key) {
    return null;
  }

  return [
    ...(match.meta ? ["CmdOrCtrl"] : []),
    ...(match.ctrl ? ["Ctrl"] : []),
    ...(match.alt ? ["Alt"] : []),
    ...(match.shift ? ["Shift"] : []),
    key,
  ].join("+");
}

function toNativeKeyName(key: string): string | null {
  if (NATIVE_KEY_NAMES[key]) {
    return NATIVE_KEY_NAMES[key];
  }

  if (key.length === 1) {
    return key.toUpperCase();
  }

  return /^[A-Za-z0-9]+$/.test(key) ? key : null;
}

function areShortcutMatchesEquivalent(
  left: ShortcutMatch,
  right: ShortcutMatch,
): boolean {
  return left.kind === right.kind
    && fixedShortcutKey(left) === fixedShortcutKey(right)
    && left.meta === right.meta
    && (left.ctrl ?? false) === (right.ctrl ?? false)
    && left.alt === right.alt
    && left.shift === right.shift;
}

function fixedShortcutKey(match: ShortcutMatch): string | null {
  return match.kind === "fixed" ? match.key : null;
}
