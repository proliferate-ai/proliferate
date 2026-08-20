// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatLaunchControlActions } from "#product/hooks/chat/workflows/use-chat-launch-control-actions";
import { USER_PREFERENCE_DEFAULTS } from "#product/lib/domain/preferences/user/model";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

const setActiveSessionConfigOption = vi.fn<() => Promise<void>>();

vi.mock("#product/hooks/sessions/workflows/use-session-config-actions", () => ({
  useSessionConfigActions: () => ({ setActiveSessionConfigOption }),
}));

describe("useChatLaunchControlActions", () => {
  beforeEach(() => {
    setActiveSessionConfigOption.mockReset();
    useUserPreferencesStore.setState({
      ...USER_PREFERENCE_DEFAULTS,
      _hydrated: false,
      _persistedMetadata: {},
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("persists default launch controls under the raw target-observed id", () => {
    const { result } = renderHook(() =>
      useChatLaunchControlActions({ activeLaunchAgentKind: null }));

    act(() => {
      result.current("codex", "effort", "reasoning_effort", "xhigh");
    });

    const persisted = useUserPreferencesStore.getState()
      .defaultLiveSessionControlValuesByAgentKind;
    expect(persisted).toEqual({ codex: { reasoning_effort: "xhigh" } });
    // Negative control: the normalized key must never reach the persisted map
    // (the create seam exact-validates raw observed ids).
    expect(persisted.codex).not.toHaveProperty("effort");
  });

  it("falls back to persisting the raw id when the live update fails", async () => {
    setActiveSessionConfigOption.mockRejectedValueOnce(new Error("live update failed"));
    const { result } = renderHook(() =>
      useChatLaunchControlActions({ activeLaunchAgentKind: "codex" }));

    await act(async () => {
      result.current("codex", "fast_mode", "fast-mode", "on");
      await Promise.resolve();
    });

    expect(setActiveSessionConfigOption).toHaveBeenCalledWith(
      "fast-mode",
      "on",
      { controlKey: "fast_mode" },
    );
    const persisted = useUserPreferencesStore.getState()
      .defaultLiveSessionControlValuesByAgentKind;
    expect(persisted).toEqual({ codex: { "fast-mode": "on" } });
    expect(persisted.codex).not.toHaveProperty("fast_mode");
  });
});
