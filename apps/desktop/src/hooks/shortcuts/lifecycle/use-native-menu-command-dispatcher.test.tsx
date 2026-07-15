// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProductCommand } from "@proliferate/product-client/host/desktop-bridge";

import { SHORTCUT_REVEAL_RESET_EVENT } from "@/hooks/shortcuts/lifecycle/use-shortcut-reveal-state";
import {
  clearShortcutHandlerRegistryForTests,
  registerShortcutHandler,
} from "@/lib/domain/shortcuts/registry";

import { useNativeMenuCommandDispatcher } from "./use-native-menu-command-dispatcher";

function makeSubscription() {
  let listener: ((command: ProductCommand) => void) | null = null;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((next: (command: ProductCommand) => void) => {
    listener = next;
    return unsubscribe;
  });

  return {
    emit(command: ProductCommand) {
      listener?.(command);
    },
    subscribe,
    unsubscribe,
  };
}

beforeEach(() => {
  clearShortcutHandlerRegistryForTests();
});

afterEach(() => {
  cleanup();
  clearShortcutHandlerRegistryForTests();
  vi.restoreAllMocks();
});

describe("useNativeMenuCommandDispatcher", () => {
  it("dispatches valid native commands once and resets reveal state when consumed", () => {
    const subscription = makeSubscription();
    const handler = vi.fn(() => true);
    const onRevealReset = vi.fn();
    registerShortcutHandler("app.open-settings", handler);
    window.addEventListener(SHORTCUT_REVEAL_RESET_EVENT, onRevealReset);

    renderHook(() => useNativeMenuCommandDispatcher(subscription.subscribe));
    subscription.emit("app.open-settings");

    expect(subscription.subscribe).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ source: "menu" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(onRevealReset).toHaveBeenCalledTimes(1);

    window.removeEventListener(SHORTCUT_REVEAL_RESET_EVENT, onRevealReset);
  });

  it("ignores invalid commands and does not reset reveal state when unconsumed", () => {
    const subscription = makeSubscription();
    const handler = vi.fn(() => false);
    const onRevealReset = vi.fn();
    registerShortcutHandler("app.open-settings", handler);
    window.addEventListener(SHORTCUT_REVEAL_RESET_EVENT, onRevealReset);

    renderHook(() => useNativeMenuCommandDispatcher(subscription.subscribe));
    subscription.emit("not-a-shortcut");
    subscription.emit("app.open-settings");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(onRevealReset).not.toHaveBeenCalled();

    window.removeEventListener(SHORTCUT_REVEAL_RESET_EVENT, onRevealReset);
  });

  it("synchronously unsubscribes on unmount", () => {
    const subscription = makeSubscription();
    const { unmount } = renderHook(() =>
      useNativeMenuCommandDispatcher(subscription.subscribe));

    unmount();

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
